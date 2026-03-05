# Plan: Fix Slot Locking for Multiple Services

## 📅 Date: March 3, 2026

---

## 🎯 Current Problem

**User's Issue**:
> "the slot is locking for all the services like see the business has more than one service like different service like my business is cleaning something i have two services first floor cleaning second bathroom cleaning then i don't want to lock slot for different service here now just slot is locked for a business"

**Translation**:
The slot lock is working across ALL services in a business. If someone books "Floor Cleaning" at 9 AM, nobody can book "Bathroom Cleaning" at 9 AM. This is wrong!

---

## 🔍 Current Behavior (WRONG)

**Scenario**:
- Business: "Cleaning Services"
- Service 1: Floor Cleaning (id: 10)
- Service 2: Bathroom Cleaning (id: 11)

**What Happens**:
```
Customer A: Books Floor Cleaning at 9:00 AM
    ↓
Slot 381 locked for 2026-03-05
    ↓
Customer B: Tries to book Bathroom Cleaning at 9:00 AM
    ↓
Backend: Checks slot 381 + date 2026-03-05
    ↓
Found: Pending payment intent (for Floor Cleaning!)
    ↓
Error: "Another customer is currently booking this slot..."
    ↓
Customer CANNOT book Bathroom Cleaning! ❌
```

---

## ✅ Expected Behavior

**What Should Happen**:
```
Customer A: Books Floor Cleaning (Service 10) at 9:00 AM
    ↓
Slot 381 + Service 10 locked for 2026-03-05
    ↓
Customer B: Books Bathroom Cleaning (Service 11) at 9:00 AM
    ↓
Backend: Checks slot 381 + Service 11 + date 2026-03-05
    ↓
No conflict! Different service ✅
    ↓
Customer B CAN book Bathroom Cleaning! ✅
```

---

## 🔍 Root Cause

**Current Unique Constraint** (Database Schema):

```javascript
// File: models/schema.js (Line 207)
slotDatePendingUnique: uniqueIndex("payment_intents_slot_date_pending_unique")
  .on(table.slotId, table.bookingDate)  // ❌ Missing serviceId!
  .where(sql`${table.status} = 'pending'`),
```

**Problem**:
- Constraint is on `(slotId, bookingDate)` only
- Doesn't include `serviceId`
- So **only ONE** pending intent per slot per date, regardless of service

**Current Lock**:
```
Slot 381 + 2026-03-05 = LOCKED (for ALL services)
```

**Required Lock**:
```
Slot 381 + Service 10 + 2026-03-05 = LOCKED (for Floor Cleaning only)
Slot 381 + Service 11 + 2026-03-05 = AVAILABLE (for Bathroom Cleaning)
```

---

## 📋 Implementation Plan

### Phase 1: Update Database Schema

**File**: `models/schema.js`

**Change**:
```javascript
// BEFORE
slotDatePendingUnique: uniqueIndex("payment_intents_slot_date_pending_unique")
  .on(table.slotId, table.bookingDate)
  .where(sql`${table.status} = 'pending'`),

// AFTER
slotDateServicePendingUnique: uniqueIndex("payment_intents_slot_date_service_pending_unique")
  .on(table.slotId, table.bookingDate, table.serviceId)  // ✅ Add serviceId!
  .where(sql`${table.status} = 'pending'`),
```

### Phase 2: Update Pre-Check Logic

**File**: `controllers/payment.controller.js`

**Change** (Line 142-151):
```javascript
// BEFORE
const [existingPendingIntent] = await db
  .select()
  .from(paymentIntents)
  .where(
    and(
      eq(paymentIntents.slotId, slotId),
      eq(paymentIntents.status, "pending")
    )
  )
  .limit(1);
```

**After**:
```javascript
// AFTER: Add serviceId to the check
const [existingPendingIntent] = await db
  .select()
  .from(paymentIntents)
  .where(
    and(
      eq(paymentIntents.slotId, slotId),
      eq(paymentIntents.serviceId, serviceId),  // ✅ Add this!
      eq(paymentIntents.status, "pending")
    )
  )
  .limit(1);
```

### Phase 3: Update Validation Logic

**File**: `controllers/payment.controller.js` (validatePaymentIntent function)

**Change** (Line 1418-1430):
```javascript
// BEFORE
const [otherPendingIntent] = await db
  .select()
  .from(paymentIntents)
  .where(
    and(
      eq(paymentIntents.slotId, paymentIntent.slotId),
      eq(paymentIntents.status, "pending"),
      sql`${paymentIntents.id} != ${paymentIntentId}`
    )
  )
  .limit(1);
```

**After**:
```javascript
// AFTER: Add serviceId to the check
const [otherPendingIntent] = await db
  .select()
  .from(paymentIntents)
  .where(
    and(
      eq(paymentIntents.slotId, paymentIntent.slotId),
      eq(paymentIntents.serviceId, paymentIntent.serviceId),  // ✅ Add this!
      eq(paymentIntents.status, "pending"),
      sql`${paymentIntents.id} != ${paymentIntentId}`
    )
  )
  .limit(1);
```

---

## 📁 Files to Change

1. **`models/schema.js`**
   - Update unique index to include `serviceId`
   - Generate migration
   - Push to database

2. **`controllers/payment.controller.js`**
   - Update pre-check logic (createPaymentOrder function)
   - Update validation logic (validatePaymentIntent function)

---

## 🎯 Expected Results After Fix

**Scenario 1: Different Services, Same Time**

```
Customer A: Books Floor Cleaning (Service 10) at 9:00 AM
    ↓
Lock: Slot 381 + Service 10 + 2026-03-05 ✅
    ↓
Customer B: Books Bathroom Cleaning (Service 11) at 9:00 AM
    ↓
Check: Slot 381 + Service 11 + 2026-03-05
    ↓
No conflict found ✅
    ↓
Customer B CAN book! ✅
```

**Scenario 2: Same Service, Same Time**

```
Customer A: Books Floor Cleaning (Service 10) at 9:00 AM
    ↓
Lock: Slot 381 + Service 10 + 2026-03-05 ✅
    ↓
Customer C: Also tries to book Floor Cleaning (Service 10) at 9:00 AM
    ↓
Check: Slot 381 + Service 10 + 2026-03-05
    ↓
Found existing intent! ❌
    ↓
Error: "Another customer is currently booking this slot..."
    ↓
Customer C CANNOT book! ✅ (Correct behavior)
```

---

## ⚠️ Migration Considerations

**Existing Data**:
- Old index: `payment_intents_slot_date_pending_unique` on (slotId, bookingDate)
- New index: `payment_intents_slot_date_service_pending_unique` on (slotId, bookingDate, serviceId)

**Migration Steps**:
1. Add new unique index with serviceId
2. Drop old unique index
3. Test with existing payment intents

**Note**: Existing "pending" intents will continue to work. The new index is more permissive, so it won't break existing data.

---

## 🧪 Testing Steps

### Test 1: Different Services, Same Time

1. **Browser A**: Floor Cleaning → 9:00 AM → "Book Now"
2. **Expected**: Modal opens ✅
3. **Browser B**: Bathroom Cleaning → 9:00 AM → "Book Now"
4. **Expected**: Modal opens ✅
5. **Result**: Both can book different services at same time! ✅

### Test 2: Same Service, Same Time

1. **Browser A**: Floor Cleaning → 9:00 AM → "Book Now"
2. **Expected**: Modal opens ✅
3. **Browser B**: Floor Cleaning → 9:00 AM → "Book Now"
4. **Expected**: Error toast, NO modal ✅
5. **Result**: Only one can book same service! ✅

### Test 3: Three Different Services

1. **Browser A**: Floor Cleaning → 9:00 AM
2. **Browser B**: Bathroom Cleaning → 9:00 AM
3. **Browser C**: Kitchen Cleaning → 9:00 AM
4. **Expected**: All three can book simultaneously! ✅

---

## ✅ Verification Checklist

After implementation, verify:

- [ ] Database migration applied successfully
- [ ] New unique index exists: `(slotId, bookingDate, serviceId)`
- [ ] Old index dropped
- [ ] Different services can be booked at same time
- [ ] Same service is still locked (only one booking)
- [ ] Pre-check logic includes serviceId
- [ ] Validation logic includes serviceId
- [ ] Backend logs show correct checks

---

## 🚀 Next Steps

1. **Review plan** and confirm approach
2. **Update database schema**
3. **Generate and push migration**
4. **Update pre-check logic**
5. **Update validation logic**
6. **Test scenarios**
7. **Deploy**

---

## 📊 Summary

**Current**:
- Lock: `(slotId, bookingDate)` = One slot, one time, ALL services

**After Fix**:
- Lock: `(slotId, bookingDate, serviceId)` = One slot, one time, ONE service

**Result**:
- Multiple services can be booked simultaneously
- Same service is still protected (only one booking)
- Better business logic for multi-service providers
