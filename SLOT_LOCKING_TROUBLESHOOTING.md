# Slot Locking System - Troubleshooting & Testing Guide

## 📅 Date: March 3, 2026

---

## 🔍 Understanding the Issue

**Problem**: Two customers clicking "Book Now" simultaneously for the same slot results in BOTH modals opening.

**Expected Behavior**:
- Customer A clicks → Slot locked → Modal opens ✅
- Customer B clicks → Gets error message → NO modal ❌

---

## 🛠️ Implementation Fixes

### What Was Added

1. **Pre-Check Layer** (NEW)
   - Explicit check for existing pending payment intents BEFORE attempting insert
   - Adds extra protection layer in addition to database constraint
   - Returns SLOT_LOCKED error immediately if slot already locked

2. **Enhanced Logging**
   - Detailed console logs at every step
   - Shows what data is being inserted
   - Shows exact error codes and messages
   - Helps debug race conditions

3. **Diagnostic Endpoint** (NEW)
   - `GET /payment/slot-lock-status?slotId=<id>&bookingDate=<date>`
   - Shows current lock status for any slot
   - Lists all pending intents and confirmed bookings
   - Available for testing/debugging

---

## 📋 Files Changed

### Backend Changes

**File**: `controllers/payment.controller.js`

**Line 119-165**: Added pre-check for existing pending intents
```javascript
// Check for existing pending payment intents
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

if (existingPendingIntent) {
  // Check if dates match
  const existingDate = new Date(existingPendingIntent.bookingDate).toISOString().split('T')[0];
  const requestDate = new Date(bookingDateObj).toISOString().split('T')[0];

  if (existingDate === requestDate) {
    return res.status(409).json({
      message: "Another customer is currently booking this slot...",
      code: "SLOT_LOCKED",
      retryable: true,
      debug: { ... }
    });
  }
}
```

**Line 195-250**: Enhanced logging for insert operation
```javascript
console.log(`📦 Insert data:`, {
  userId,
  serviceId,
  slotId,
  addressId,
  bookingDate: bookingDateObj.toISOString(),
  amount: amountInPaise,
  status: "pending",
  expiresAt: expiresAt.toISOString()
});

// ... insert happens ...

console.log(`❌ Insert failed with error:`, {
  errorCode,
  errorMessage: errorMessage.substring(0, 200),
  fullError: insertError.toString().substring(0, 300)
});
```

**Line 570-640**: Added diagnostic endpoint
```javascript
const getSlotLockStatus = async (req, res) => {
  // Returns detailed information about slot lock status
  // Includes pending intents, confirmed bookings, expiry info
};
```

**File**: `routes/payment.route.js`

**Line 72-82**: Added route for diagnostic endpoint
```javascript
router.get("/slot-lock-status", paymentController.getSlotLockStatus);
```

---

## 🧪 Testing Procedure

### Step 1: Verify Database Index

Run the SQL verification script:

```bash
# Connect to your PostgreSQL database
psql -U your_user -d your_database

# Run the verification queries
\i verify-slot-lock.sql
```

**Expected Output**:
- Index `payment_intents_slot_date_pending_unique` should exist
- Second INSERT should fail with "duplicate key" error

If the index doesn't exist, run:
```bash
cd home-service-management-backend
npm run db:generate
npm run db:push
```

---

### Step 2: Test Diagnostic Endpoint

**Method 1: Using Browser**
```
http://localhost:8000/payment/slot-lock-status?slotId=123&bookingDate=2026-03-05
```

**Method 2: Using curl**
```bash
curl -X GET "http://localhost:8000/payment/slot-lock-status?slotId=123&bookingDate=2026-03-05" \
  -H "Cookie: token=your_jwt_token"
```

**Expected Response** (if slot is locked):
```json
{
  "slotId": 123,
  "bookingDate": "2026-03-05",
  "locked": true,
  "pendingIntents": {
    "count": 1,
    "details": [
      {
        "intentId": 456,
        "userId": 789,
        "status": "pending",
        "createdAt": "2026-03-03T10:30:00.000Z",
        "expiresAt": "2026-03-03T10:31:00.000Z",
        "isExpired": false
      }
    ]
  },
  "confirmedBookings": {
    "count": 0,
    "details": []
  },
  "recommendation": "Slot is currently locked by another customer"
}
```

**Expected Response** (if slot is available):
```json
{
  "slotId": 123,
  "bookingDate": "2026-03-05",
  "locked": false,
  "pendingIntents": {
    "count": 0,
    "details": []
  },
  "confirmedBookings": {
    "count": 0,
    "details": []
  },
  "recommendation": "Slot is available"
}
```

---

### Step 3: Test Simultaneous Booking

**Setup**:
1. Open two browsers (Chrome + Firefox or Chrome Incognito)
2. Log in as two DIFFERENT customers
3. Navigate to the same service page
4. Select the same date and same slot

**Test**:
1. **Browser A**: Click "Book Now"
   - Expected: Button shows "Checking availability..."
   - Backend console: `✅ Payment intent created, slot locked`
   - Modal opens ✅

2. **Browser B** (within 5 seconds): Click "Book Now"
   - Expected: Button shows "Checking availability..."
   - Backend console: `⚠️ Found existing pending intent`
   - Toast: "Another customer is currently booking this slot..."
   - NO modal opens ✅

3. **Backend Console Logs**:
```
Browser A:
🔒 ATOMIC LOCK: Attempting to lock slot 381 for 2026-03-05
📍 User 1 trying to book slot 381 on 2026-03-05
🔍 PRE-CHECK: Checking for existing pending payment intents...
✅ No existing pending payment intents found for slot 381
🔐 Creating payment intent to lock slot 381
📦 Insert data: { userId: 1, slotId: 381, ... }
✅ Payment intent 128 created, slot 381 locked for 1 minute

Browser B:
🔒 ATOMIC LOCK: Attempting to lock slot 381 for 2026-03-05
📍 User 2 trying to book slot 381 on 2026-03-05
🔍 PRE-CHECK: Checking for existing pending payment intents...
⚠️ Found existing pending intent: {
  existingIntentId: 128,
  existingDate: "2026-03-05",
  requestDate: "2026-03-05",
  slotId: 381,
  userId: 1
}
❌ Slot 381 already locked for 2026-03-05 by user 1
```

---

### Step 4: Verify Lock Expiry

**Test**:
1. Browser A: Click "Book Now" → Modal opens
2. Wait 60 seconds (don't complete payment)
3. Browser B: Click "Book Now"
4. Expected:
   - Browser A modal shows "Session Expired"
   - Browser B can now open modal ✅

**Backend Console**:
```
[Cleanup service runs every 30 seconds]
🧹 Cleaned up 1 expired intents
```

---

## 🐛 Debugging Common Issues

### Issue 1: Both Modals Still Opening

**Possible Causes**:

1. **Database index doesn't exist**
   - Fix: Run `npm run db:push`
   - Verify: Check diagnostic endpoint

2. **Different booking dates**
   - Check: Browser console logs
   - Fix: Ensure both browsers select same date
   - Debug: Check `bookingDate` in backend console logs

3. **Different slot IDs**
   - Check: Diagnostic endpoint with both slot IDs
   - Fix: Ensure both browsers select same slot

4. **Date timezone issues**
   - Check: Backend console logs for ISO dates
   - Debug: Look for date mismatches in logs

---

### Issue 2: Pre-Check Not Working

**Symptoms**:
- Both insert attempts reach the database
- Unique constraint catches it (both fail with constraint error)

**Debug Steps**:
1. Check backend console for "PRE-CHECK" logs
2. Verify query is correct:
   ```javascript
   .where(
     and(
       eq(paymentIntents.slotId, slotId),
       eq(paymentIntents.status, "pending")
     )
   )
   ```
3. Check if database has stale data:
   ```sql
   SELECT * FROM payment_intents WHERE status = 'pending';
   ```
4. Clean up stale data:
   ```sql
   DELETE FROM payment_intents
   WHERE status = 'pending'
   AND expires_at < NOW();
   ```

---

### Issue 3: Race Condition Still Happening

**If both requests pass pre-check**:

This means both requests hit the pre-check simultaneously before either insert. The database constraint should still catch this.

**Verify Constraint Works**:
```sql
-- Manual test
BEGIN;

INSERT INTO payment_intents (user_id, service_id, slot_id, address_id, booking_date, amount, razorpay_order_id, status, expires_at)
VALUES (999, 999, 999, 999, '2026-03-05', 10000, 'test1', 'pending', NOW() + INTERVAL '1 minute');

-- This SHOULD fail
INSERT INTO payment_intents (user_id, service_id, slot_id, address_id, booking_date, amount, razorpay_order_id, status, expires_at)
VALUES (998, 998, 999, 999, '2026-03-05', 10000, 'test2', 'pending', NOW() + INTERVAL '1 minute');

ROLLBACK;
```

If second insert succeeds, the index is broken:
```sql
-- Recreate index
DROP INDEX IF EXISTS payment_intents_slot_date_pending_unique;
CREATE UNIQUE INDEX payment_intents_slot_date_pending_unique
ON payment_intents (slot_id, booking_date)
WHERE status = 'pending';
```

---

## 📊 Monitoring Backend Logs

### Key Log Patterns to Watch

**Success Pattern**:
```
✅ No existing pending payment intents found
✅ Payment intent created, slot locked
```

**Lock Detected (Pre-Check)**:
```
⚠️ Found existing pending intent
❌ Slot already locked
```

**Lock Detected (Database Constraint)**:
```
❌ Insert failed with error: { errorCode: '23505', ... }
⏳ Slot is already locked (unique constraint violation)
```

**Error Pattern**:
```
❌ Insert failed
⚠️ Non-constraint error, re-throwing
```

---

## ✅ Verification Checklist

After implementation, verify:

- [ ] Diagnostic endpoint works and shows slot status
- [ ] Pre-check logs appear in backend console
- [ ] Only one modal opens when two browsers click simultaneously
- [ ] Second browser gets toast error, not modal
- [ ] Lock expires after 1 minute
- [ ] Cleanup service removes expired intents
- [ ] Database unique index exists and works
- [ ] No stale pending intents in database

---

## 🔧 Quick Fixes

### Restart Backend Server

```bash
cd home-service-management-backend
npm run dev
```

### Clean Up Stale Locks

```sql
DELETE FROM payment_intents
WHERE status = 'pending'
AND expires_at < NOW();
```

### Reset All Payment Intents

```sql
-- WARNING: This cancels all pending bookings!
DELETE FROM payment_intents WHERE status = 'pending';
```

---

## 📞 Next Steps

1. **Run the diagnostic endpoint** to check current slot status
2. **Test simultaneous booking** with the detailed logs enabled
3. **Check backend console** for the detailed logs
4. **Share console logs** if issue persists

The enhanced logging will show exactly where the issue is occurring!
