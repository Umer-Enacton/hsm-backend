# Fix: Payment Intent Deletion Issue

## 📅 Date: March 3, 2026

---

## 🐛 Problem

**Issue**: Users couldn't complete payment. When clicking "Pay Now", validation failed with:
```
❌ Payment intent not found. It may have been cancelled.
```

**Root Cause**: The `cancel-intent` endpoint was **DELETING** payment intents instead of just cancelling them. This caused:
1. Payment intent created ✅
2. Modal unmounts/cancels → Intent **DELETED** ❌
3. User clicks "Pay Now" → Validation looks for intent → **NOT FOUND** ❌

---

## 🔍 Why This Happened

Looking at the logs:
```
✅ Payment intent 173 created, slot 384 locked
🔓 Request to cancel payment intent 173 by user 9
✅ Released slot lock for payment intent 173 (DELETED!)
🔍 [VALIDATE] Checking payment intent 173 for user 9
❌ [VALIDATE] Payment intent 173 not found
```

**The Problem**:
- Payment intents were being **DELETED** from database
- Validation endpoint couldn't find them
- Users couldn't complete payment

**Why Deletion Was Wrong**:
1. Lost audit trail (can't see who cancelled what)
2. Validation endpoint can't check intent status
3. Can't provide user-friendly error messages
4. Breaks the payment flow

---

## ✅ Solution

### Changed `cancel-intent` to UPDATE Status Instead of DELETE

**Before** (Line 1161-1170):
```javascript
// Delete the intent (only if it belongs to this user and is pending)
const [deleted] = await db
  .delete(paymentIntents)
  .where(
    and(
      eq(paymentIntents.id, paymentIntentId),
      eq(paymentIntents.userId, userId),
      eq(paymentIntents.status, "pending")
    )
  )
  .returning();
```

**After**:
```javascript
// Update status to cancelled instead of deleting
// This preserves the record for validation/audit while releasing the slot lock
const [updated] = await db
  .update(paymentIntents)
  .set({
    status: "cancelled",
    failureReason: "User cancelled the payment session"
  })
  .where(
    and(
      eq(paymentIntents.id, paymentIntentId),
      eq(paymentIntents.userId, userId),
      eq(paymentIntents.status, "pending")
    )
  )
  .returning();
```

### Added "cancelled" Status to Enum

**File**: `models/schema.js` (Lines 35-40)

**Before**:
```javascript
const paymentIntentStatusEnum = pgEnum("payment_intent_status", [
  "pending",
  "completed",
  "failed",
  "expired",
]);
```

**After**:
```javascript
const paymentIntentStatusEnum = pgEnum("payment_intent_status", [
  "pending",
  "completed",
  "failed",
  "expired",
  "cancelled", // NEW!
]);
```

### Updated Validation Error Messages

**File**: `controllers/payment.controller.js` (Lines 680-698)

**Before**:
```javascript
if (paymentIntent.status !== "pending") {
  return res.status(400).json({
    valid: false,
    message: `Payment session is ${paymentIntent.status}. Please try booking again.`,
    code: paymentIntent.status.toUpperCase()
  });
}
```

**After**:
```javascript
if (paymentIntent.status !== "pending") {
  let message = `Payment session is ${paymentIntent.status}.`;
  if (paymentIntent.status === "cancelled") {
    message = "Payment session was cancelled. Please try booking again.";
  } else if (paymentIntent.status === "expired") {
    message = "Payment session has expired. Please try booking again.";
  } else if (paymentIntent.status === "completed") {
    message = "Payment has already been completed for this booking.";
  } else if (paymentIntent.status === "failed") {
    message = "Payment failed. Please try booking again.";
  }

  return res.status(400).json({
    valid: false,
    message: message,
    code: paymentIntent.status.toUpperCase()
  });
}
```

---

## 📁 Files Changed

### 1. `models/schema.js`
- **Lines 35-40**: Added "cancelled" to payment_intent_status enum
- **Migration**: Applied via `npm run db:push`

### 2. `controllers/payment.controller.js`

**Lines 610-640**: Updated `cancelPaymentIntent` function
- Changed from DELETE to UPDATE
- Preserves record for audit/validation
- Releases slot lock by changing status

**Lines 680-698**: Enhanced error messages in `validatePaymentIntent`
- User-friendly messages for each status
- Specific guidance for cancelled/expired/failed states

---

## 📊 How It Works Now

### Normal Flow (User Completes Payment)

```
1. User clicks "Book Now"
   ↓
2. Payment intent created (status: "pending")
   ↓
3. Modal opens
   ↓
4. User clicks "Pay Now"
   ↓
5. Validation: Intent found, status="pending" ✅
   ↓
6. Razorpay opens
   ↓
7. User completes payment
   ↓
8. Intent updated to status="completed"
```

### Cancel Flow (User Closes Modal)

```
1. User clicks "Book Now"
   ↓
2. Payment intent created (status: "pending")
   ↓
3. Modal opens
   ↓
4. User closes modal/cancels
   ↓
5. cancel-intent called
   ↓
6. Intent updated to status="cancelled" (NOT deleted!)
   ↓
7. Slot lock released ✅
   ↓
8. User can try booking again
```

### Re-open Cancelled Modal (Edge Case)

```
1. User re-opens payment modal with cancelled intent
   ↓
2. User clicks "Pay Now"
   ↓
3. Validation: Intent found, status="cancelled" ❌
   ↓
4. Modal closes
   ↓
5. Toast: "Payment session was cancelled. Please try booking again."
   ↓
6. User clicks "Book Now" → New intent created ✅
```

---

## 🎯 Benefits of UPDATE vs DELETE

| Aspect | DELETE (Old) | UPDATE (New) |
|--------|--------------|--------------|
| Audit Trail | ❌ Lost | ✅ Preserved |
| Validation | ❌ Can't find intent | ✅ Can check status |
| Error Messages | ❌ Generic "not found" | ✅ Specific per status |
| Debugging | ❌ No history | ✅ Full history |
| Slot Lock | ✅ Released | ✅ Released |
| Database Size | ❌ Smaller (missing data) | ✅ Complete |

---

## 🧪 Testing Steps

### Test 1: Normal Payment Flow

1. **Click "Book Now"**
2. **Modal opens**
3. **Click "Pay Now"**
4. **Expected**:
   - Validation passes ✅
   - Razorpay opens ✅
   - Payment completes ✅

### Test 2: Cancel and Re-book

1. **Click "Book Now"** → Modal opens
2. **Close modal** (click Cancel or X)
3. **Backend**: Intent status="cancelled" ✅
4. **Click "Book Now" again**
5. **Expected**:
   - New payment intent created ✅
   - Modal opens ✅
   - Can complete payment ✅

### Test 3: Try to Pay with Cancelled Intent

1. **Click "Book Now"** → Modal opens
2. **Close modal**
3. **Re-open modal** (if cached/stale)
4. **Click "Pay Now"**
5. **Expected**:
   - Validation fails ❌
   - Modal closes
   - Toast: "Payment session was cancelled. Please try booking again."
   - Can book again ✅

---

## 🗄️ Database State

### Before Fix (DELETE)

```sql
SELECT * FROM payment_intents WHERE id = 173;
-- Result: (0 rows) - Record deleted!
```

### After Fix (UPDATE)

```sql
SELECT * FROM payment_intents WHERE id = 173;
-- Result:
-- id: 173
-- status: 'cancelled'
-- failure_reason: 'User cancelled the payment session'
-- ... (all other fields preserved)
```

### Check for Cancelled Intents

```sql
SELECT
  id,
  slot_id,
  booking_date,
  status,
  failure_reason,
  created_at
FROM payment_intents
WHERE status = 'cancelled'
ORDER BY created_at DESC
LIMIT 10;
```

---

## 🔍 Backend Console Logs

### User Cancels Payment Intent

```
🔓 Request to cancel payment intent 173 by user 9
✅ Cancelled payment intent 173 (slot lock released)
```

### User Tries to Validate Cancelled Intent

```
🔍 [VALIDATE] Checking payment intent 173 for user 9
❌ [VALIDATE] Payment intent 173 has status: cancelled
```

---

## ✅ Verification Checklist

After testing, verify:

- [ ] Normal payment flow works
- [ ] Cancelling modal updates intent to "cancelled" (not delete)
- [ ] Re-booking works after cancellation
- [ ] Validation detects cancelled intent
- [ ] User sees "Payment session was cancelled" message
- [ ] Database has cancelled intents (not deleted)
- [ ] Slot lock released after cancellation
- [ ] No "Payment intent not found" errors

---

## 🚀 Next Steps

1. **Restart backend server**:
   ```bash
   cd home-service-management-backend
   npm run dev
   ```

2. **Test payment flow**:
   - Complete a normal payment
   - Cancel a payment
   - Try to pay with cancelled intent

3. **Check database**:
   ```sql
   SELECT * FROM payment_intents WHERE status = 'cancelled';
   ```

4. **Verify**: No more "Payment intent not found" errors

---

## 📞 If Issues Persist

1. Check database for cancelled intents
2. Verify enum has "cancelled" value:
   ```sql
   SELECT unnest(enum_range(NULL::payment_intent_status));
   ```
3. Check backend logs for validation attempts
4. Ensure `npm run db:push` completed successfully

The payment flow should now work correctly without deletion issues!
