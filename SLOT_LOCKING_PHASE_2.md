# Slot Locking System - Phase 2: Payment Controller Refactor

## 📅 Date: March 3, 2026

## ✅ Status: COMPLETED

---

## 🎯 Objective

Refactor payment controller to use optimistic locking with the unique constraint created in Phase 1. Add proper error handling and slot release mechanism.

---

## 🔧 Changes Made

### 1. Backend: `controllers/payment.controller.js`

#### Changed Lock Duration
**Line 127:** Changed from 2 minutes to **1 minute**

```javascript
// Before:
const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);

// After:
const expiresAt = new Date(now.getTime() + 1 * 60 * 1000);
```

#### Removed "Check Existing Intents" Logic
**Lines 166-187 (DELETED):** Removed the check for existing payment intents.

**Why?** The database unique constraint now handles this automatically.

#### Simplified Transaction Flow
**Before (Lines 119-212):**
```
1. Start SERIALIZABLE transaction
2. Check if slot booked → throw if yes
3. Check if intent exists → throw if yes
4. Insert new intent
5. Commit transaction
6. Create Razorpay order
```

**After (Lines 119-200):**
```
1. Check if slot booked → return error if yes
2. Try to insert intent directly
   → If unique violation: return "slot locked" error
   → If success: proceed
3. Create Razorpay order
4. If Razorpay fails: cleanup intent (release lock)
```

#### New Error Handling with Human-Friendly Messages

**Line 155-158:** Slot already booked
```javascript
return res.status(409).json({
  message: "This slot has already been booked. Please select a different time.",
  code: "SLOT_ALREADY_BOOKED",
});
```

**Line 180-186:** Slot locked by another customer (unique constraint violation)
```javascript
if (insertError.code === '23505' || insertError.message?.includes('unique constraint')) {
  return res.status(409).json({
    message: "Another customer is currently booking this slot. Please wait a moment and try again, or choose a different slot.",
    code: "SLOT_LOCKED",
    retryable: true,
  });
}
```

**Line 233-245:** Razorpay error with cleanup
```javascript
if (paymentIntent) {
  await db.delete(paymentIntents).where(eq(paymentIntents.id, paymentIntent.id));
  console.log(`🧹 Released slot lock for payment_intent ${paymentIntent.id}`);
}
return res.status(500).json({
  message: "Payment gateway is temporarily unavailable. Please try again.",
  code: "RAZORPAY_ERROR",
});
```

#### Added `cancelPaymentIntent` Function
**Lines 1063-1107:** New endpoint to release slot lock when user cancels payment.

```javascript
/**
 * Cancel payment intent (releases slot lock)
 * POST /api/payment/cancel-intent
 */
const cancelPaymentIntent = async (req, res) => {
  const userId = req.token.id;
  const { paymentIntentId } = req.body;

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

  return res.status(200).json({
    message: deleted ? "Slot lock released successfully" : "Payment intent not found",
    released: !!deleted,
  });
};
```

---

### 2. Backend: `routes/payment.route.js`

**Lines 33-41:** Added new route for cancel-intent endpoint.

```javascript
/**
 * POST /payment/cancel-intent
 * Cancel payment intent (releases slot lock)
 * Protected: Customer only (must own the payment intent)
 */
router.post("/cancel-intent", paymentController.cancelPaymentIntent);
```

---

### 3. Frontend: `lib/api.ts`

**Line 94:** Added CANCEL_INTENT endpoint.

```typescript
PAYMENT: {
  CREATE_ORDER: "/payment/create-order",
  VERIFY: "/payment/verify",
  FAILED: "/payment/failed",
  CANCEL_INTENT: "/payment/cancel-intent",  // ✨ NEW
  WEBHOOK: "/payment/webhook",
  // ...
}
```

---

### 4. Frontend: `components/customer/payment/PaymentModal.tsx`

**Lines 88-106:** Auto-cancel intent on unmount.

```typescript
useEffect(() => {
  return () => {
    // Cancel payment intent to release slot lock
    if (orderData && step === "ready") {
      api.post(API_ENDPOINTS.PAYMENT.CANCEL_INTENT, {
        paymentIntentId: orderData.paymentIntentId,
      }).catch((err) => console.warn("⚠️ Failed to cancel payment intent:", err));
    }
    flowHandledRef.current = false;
  };
}, [orderData, step]);
```

**Lines 501-514:** Cancel intent when user clicks Cancel button.

```typescript
<button
  onClick={() => {
    if (orderData && step === "ready") {
      api.post(API_ENDPOINTS.PAYMENT.CANCEL_INTENT, {
        paymentIntentId: orderData.paymentIntentId,
      }).catch((err) => console.warn("⚠️ Failed to cancel:", err));
    }
    onCancel();
  }}
>
  Cancel
</button>
```

---

## 📊 Flow Comparison

### Before Phase 2 (Pessimistic Locking)

```
Customer 1              Customer 2              Database
    │                        │                      │
    ├─ Check bookings        │                      │
    ├─ Check intents         │                      │
    ├─ Start transaction ────┼─ Start transaction   │
    │                        │   (waits)            │
    ├─ Insert intent         │                      │
    ├─ Commit                ├─ Check intents       │
    │                        ├─ Found intent!       │
    │                        ├─ Throw error         │
    │                        │                      │
Result: Customer 1 succeeds, Customer 2 gets error
```

**Problems:**
- Both customers might pass checks before insert
- SERIALIZABLE isolation causes unnecessary waiting
- Complex transaction logic

### After Phase 2 (Optimistic Locking)

```
Customer 1              Customer 2              Database
    │                        │                      │
    ├─ Check bookings        │                      │
    ├─ Insert intent ────────┼─ Insert intent       │
    │                        │   (at same time)     │
    │                        │                      │
    ├─ ✅ SUCCESS            ├─ ❌ UNIQUE VIOLATION │
    │                        │                      │
Result: Customer 1 succeeds, Customer 2 gets clean error immediately
```

**Benefits:**
- ✅ Only ONE customer can insert (enforced by database)
- ✅ No waiting on SERIALIZABLE isolation
- ✅ Simpler code, less error-prone
- ✅ Immediate feedback to Customer 2

---

## 🎯 Error Codes Reference

| Code | HTTP Status | Message | When |
|------|-------------|---------|------|
| `SLOT_ALREADY_BOOKED` | 409 | "This slot has already been booked. Please select a different time." | Booking exists for slot+date |
| `SLOT_LOCKED` | 409 | "Another customer is currently booking this slot. Please wait a moment and try again, or choose a different slot." | Unique constraint violation (another payment_intent exists) |
| `RAZORPAY_ERROR` | 500 | "Payment gateway is temporarily unavailable. Please try again." | Razorpay API call failed |

---

## 🧪 Testing

### Test 1: Simultaneous Booking Attempt

1. Open two browsers with different customers
2. Select same service, date, slot
3. Click "Book Now" simultaneously

**Expected Result:**
- One customer reaches payment
- Other customer sees: *"Another customer is currently booking this slot. Please wait a moment and try again..."*

### Test 2: Slot Release on Cancel

1. Start booking flow
2. Close payment modal (don't pay)

**Expected Result:**
- Slot becomes available immediately
- Other customers can book it

**Verify in logs:**
```
🔓 Releasing slot lock for payment intent: 123
✅ Released slot lock for payment intent 123
```

### Test 3: Already Booked Slot

1. Book a slot (complete payment)
2. Try to book same slot again (same date)

**Expected Result:**
- Error message: *"This slot has already been booked. Please select a different time."*

---

## 📁 Files Changed

### Backend
1. **`controllers/payment.controller.js`**
   - Lines 119-200: Refactored createPaymentOrder
   - Lines 1063-1107: Added cancelPaymentIntent function
   - Lines 1064-1072: Exported new function

2. **`routes/payment.route.js`**
   - Lines 33-41: Added `/cancel-intent` route

### Frontend
3. **`lib/api.ts`**
   - Line 94: Added CANCEL_INTENT endpoint

4. **`components/customer/payment/PaymentModal.tsx`**
   - Lines 88-106: Auto-cancel on unmount
   - Lines 501-514: Cancel on button click

---

## 🔍 How to Verify Changes

### Backend Verification

1. **Check the new endpoint exists:**
```bash
# Start backend and check routes
curl http://localhost:8000/api/payment/cancel-intent
# Should return 405 Method Not Allowed (wrong method, but route exists)
```

2. **Test the cancel endpoint:**
```javascript
// Create a payment intent first
const intent = await api.post('/payment/create-order', {...});

// Then cancel it
const result = await api.post('/payment/cancel-intent', {
  paymentIntentId: intent.paymentIntentId
});
// Should return: { message: "Slot lock released successfully", released: true }
```

### Frontend Verification

1. **Check browser console for cancel calls:**
   - Open payment modal
   - Close it without paying
   - Should see: `🔓 Releasing slot lock for payment intent: xxx`

2. **Network tab:**
   - Should see POST request to `/payment/cancel-intent`
   - Status: 200 OK

---

## ⚠️ Important Notes

### 1. Lock Duration Reduction
- **Before:** 2 minutes
- **After:** 1 minute
- **Reason:** Faster slot release = better UX

### 2. No More SERIALIZABLE Transactions
- Removed SERIALIZABLE isolation level
- Unique constraint provides better race condition prevention
- Faster, simpler, more reliable

### 3. Immediate Slot Release
- When user closes modal: slot released immediately
- When user clicks Cancel: slot released immediately
- Before: had to wait for 1-minute expiry

### 4. Backward Compatibility
- ✅ Existing payment_intents unaffected
- ✅ Error codes added for frontend handling
- ✅ Human-friendly messages for all scenarios

---

## 🎉 What's Next?

**Phase 3:** Cleanup Expired Intents (Cron Job)

Implement automatic cleanup of expired payment intents to keep database clean and ensure slots aren't locked longer than necessary.

---

## 📞 Contact

For questions or issues with Phase 2, check:
- Controller: `controllers/payment.controller.js` (lines 119-200, 1063-1107)
- Routes: `routes/payment.route.js` (lines 33-41)
- Frontend: `components/customer/payment/PaymentModal.tsx` (lines 88-106, 501-514)
