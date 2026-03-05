# Fix: Allow Multiple Services at Same Time Slot

## 📅 Date: March 3, 2026

---

## ✅ What Was Fixed

**Problem**: Slot was locked across ALL services. If Customer A booked "Floor Cleaning" at 9:00 AM, Customer B couldn't book "Bathroom Cleaning" at 9:00 AM.

**Solution**: Updated the locking scope from `(slotId, bookingDate)` to `(slotId, bookingDate, serviceId)`. Now different services can be booked at the same time!

---

## 📁 Files Changed

### 1. `models/schema.js` (Lines 205-211)

**Before**:
```javascript
slotDatePendingUnique: uniqueIndex("payment_intents_slot_date_pending_unique")
  .on(table.slotId, table.bookingDate)  // ❌ Missing serviceId
  .where(sql`${table.status} = 'pending'`),
```

**After**:
```javascript
slotDateServicePendingUnique: uniqueIndex("payment_intents_slot_date_service_pending_unique")
  .on(table.slotId, table.bookingDate, table.serviceId)  // ✅ Added serviceId
  .where(sql`${table.status} = 'pending'`),
```

### 2. `controllers/payment.controller.js` (Lines 142-151)

**Pre-check Logic**:
```javascript
// BEFORE
.where(
  and(
    eq(paymentIntents.slotId, slotId),
    eq(paymentIntents.status, "pending")
  )
)

// AFTER
.where(
  and(
    eq(paymentIntents.slotId, slotId),
    eq(paymentIntents.serviceId, serviceId),  // ✅ Added
    eq(paymentIntents.status, "pending")
  )
)
```

### 3. `controllers/payment.controller.js` (Lines 1439-1467)

**Validation Logic**:
```javascript
// BEFORE
.where(
  and(
    eq(paymentIntents.slotId, paymentIntent.slotId),
    eq(paymentIntents.status, "pending"),
    sql`${paymentIntents.id} != ${paymentIntentId}`
  )
)

// AFTER
.where(
  and(
    eq(paymentIntents.slotId, paymentIntent.slotId),
    eq(paymentIntents.serviceId, paymentIntent.serviceId),  // ✅ Added
    eq(paymentIntents.status, "pending"),
    sql`${paymentIntents.id} != ${paymentIntentId}`
  )
)
```

---

## 📊 How It Works Now

### Scenario 1: Different Services, Same Time (NOW WORKS! ✅)

```
Customer A: Books Floor Cleaning (Service 10) at 9:00 AM
    ↓
Pre-check: Slot 381 + Service 10 + 2026-03-04 = No conflicts ✅
    ↓
Modal opens ✅

Customer B: Books Bathroom Cleaning (Service 11) at 9:00 AM
    ↓
Pre-check: Slot 381 + Service 11 + 2026-03-04 = No conflicts ✅
    ↓
Modal opens ✅

Result: BOTH can book! ✅
```

### Scenario 2: Same Service, Same Time (STILL PROTECTED ✅)

```
Customer A: Books Floor Cleaning (Service 10) at 9:00 AM
    ↓
Pre-check: Slot 381 + Service 10 + 2026-03-04 = No conflicts ✅
    ↓
Modal opens ✅

Customer C: Also tries Floor Cleaning (Service 10) at 9:00 AM
    ↓
Pre-check: Slot 381 + Service 10 + 2026-03-04 = FOUND! ⚠️
    ↓
Error: "Another customer is currently booking this slot..."
    ↓
NO modal opens ✅

Result: Only ONE can book same service! ✅
```

---

## 🧪 Test It Now

### Test 1: Different Services

1. **Browser A**: "Floor Cleaning" → 9:00 AM → "Book Now"
   - Expected: Modal opens ✅

2. **Browser B**: "Bathroom Cleaning" → 9:00 AM → "Book Now"
   - Expected: Modal opens ✅ (not blocked!)

3. **Backend Console**:
   ```
   Browser A: ✅ Payment intent created for Service 10
   Browser B: ✅ Payment intent created for Service 11
   ```

### Test 2: Same Service

1. **Browser A**: "Floor Cleaning" → 9:00 AM → "Book Now"
   - Expected: Modal opens ✅

2. **Browser C**: "Floor Cleaning" → 9:00 AM → "Book Now"
   - Expected: Toast error "Another customer is currently booking..." ✅
   - Expected: NO modal opens ✅

---

## 🔍 Backend Console Logs (Expected)

### Browser A (Floor Cleaning)
```
🔍 PRE-CHECK: Checking for existing pending payment intents...
✅ No existing pending payment intents found for slot 381
🔐 Creating payment intent to lock slot 381
✅ Payment intent 201 created, slot 381 locked for 1 minute
```

### Browser B (Bathroom Cleaning - Same Time)
```
🔍 PRE-CHECK: Checking for existing pending payment intents...
✅ No existing pending payment intents found for slot 381
🔐 Creating payment intent to lock slot 381
✅ Payment intent 202 created, slot 381 locked for 1 minute
```

### Browser C (Floor Cleaning - Same Service)
```
🔍 PRE-CHECK: Checking for existing pending payment intents...
⚠️ Found existing pending intent: {
  existingIntentId: 201,
  serviceId: 10,  // Same service!
  ...
}
❌ Slot 381 already locked for Service 10 on 2026-03-04
```

---

## ✅ What Changed

| Layer | Before | After |
|-------|--------|-------|
| **Database Index** | `slotId + bookingDate` | `slotId + bookingDate + serviceId` ✅ |
| **Pre-check** | Only checks slotId | Checks slotId + serviceId ✅ |
| **Validation** | Only checks slotId | Checks slotId + serviceId ✅ |
| **Lock Scope** | One slot = One booking | One slot + One service = One booking ✅ |

---

## 🎉 Summary

**Lock Scope Changed**:
- **Before**: `(slotId, bookingDate)` = Locks ALL services
- **After**: `(slotId, bookingDate, serviceId)` = Locks ONE service

**Result**:
- ✅ Different services can be booked at same time
- ✅ Same service is still protected (only one booking)
- ✅ Better for multi-service providers
- ✅ More flexible booking system

**Test it now** - try booking different services at the same time! 🚀
