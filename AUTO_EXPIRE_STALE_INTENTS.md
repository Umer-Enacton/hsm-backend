# Fix: Auto-Expire Stale Payment Intents

## 📅 Date: March 3, 2026

---

## 🐛 Problem

**User's Issue**:
> "ok working fine but on timer end of session expired then on another browser first i have to refresh then book"

**Translation**:
Payment works fine, but when the session timer expires in Browser A, Browser B has to **refresh the page** before they can book the same slot.

---

## 🔍 Root Cause

### What Was Happening

```
Browser A:
1. Opens modal → Timer starts (60 seconds)
2. Timer reaches 0 → Modal shows "Session Expired"
3. Payment intent status: "pending" (not expired yet!)
4. Cleanup service runs every 30 seconds...
5. Cleanup service marks intent as "expired" (finally!)

Browser B (tries to book during step 3-4):
1. Clicks "Book Now"
2. Pre-check finds intent with status="pending"
3. Pre-check checks: Is it expired? NO (cleanup hasn't run yet)
4. Returns "SLOT_LOCKED" error
5. User must refresh page ❌
```

**The Problem**:
- Frontend timer expires (60 seconds)
- But backend intent is still "pending" until cleanup service runs
- Cleanup service runs every 30 seconds, not immediately
- So Browser B sees stale lock for up to 30 seconds!

---

## ✅ Solution

### Auto-Expire During Pre-Check

**Added logic to check expiry during pre-check**:

```javascript
if (existingPendingIntent) {
  // Check if the existing intent has expired (even if status is still "pending")
  const now = new Date();
  const expiresAt = new Date(existingPendingIntent.expiresAt);
  const isExpired = now > expiresAt;

  if (isExpired) {
    // Mark it as expired immediately
    await db.update(paymentIntents)
      .set({ status: "expired" })
      .where(eq(paymentIntents.id, existingPendingIntent.id));

    // Don't return error - continue with booking
    console.log(`✅ Intent expired, slot is now available`);
  } else {
    // Intent is still valid - block the slot
    return res.status(409).json({
      message: "Another customer is currently booking...",
      code: "SLOT_LOCKED"
    });
  }
}
```

---

## 📊 How It Works Now

### Browser A (Timer Expires)

```
1. Opens modal → Intent created (expiresAt: +60s)
2. Timer counts down... 60... 30... 10... 0
3. Modal shows "Session Expired"
4. User closes modal
```

### Browser B (Tries to Book After Timer Expires)

```
1. Clicks "Book Now"
2. Pre-check finds intent (status: "pending")
3. Pre-check checks: now > expiresAt?
4. YES! Intent has expired
5. Backend immediately marks intent as "expired" ✅
6. Pre-check continues: No active locks found
7. New payment intent created ✅
8. Modal opens ✅
9. NO REFRESH NEEDED! ✅
```

---

## 📁 Files Changed

### `controllers/payment.controller.js`

**Lines 142-202**: Updated pre-check logic

**Added**:
- Expiry check during pre-check
- Auto-mark expired intents immediately
- Allow booking if intent has expired

**Before**:
```javascript
if (existingPendingIntent) {
  if (datesMatch) {
    return res.status(409).json({
      message: "Slot locked...",
      code: "SLOT_LOCKED"
    });
  }
}
```

**After**:
```javascript
if (existingPendingIntent) {
  const isExpired = now > expiresAt;

  if (isExpired) {
    // Mark as expired immediately
    await db.update(paymentIntents)
      .set({ status: "expired" })
      .where(eq(paymentIntents.id, existingPendingIntent.id));

    // Continue with booking (don't return error)
  } else if (datesMatch) {
    // Still valid - block the slot
    return res.status(409).json({
      message: "Slot locked...",
      code: "SLOT_LOCKED"
    });
  }
}
```

---

## 🎯 Benefits

| Before | After |
|--------|-------|
| Timer expires → Wait up to 30s for cleanup | Timer expires → Immediate expiry ✅ |
| Browser B must refresh | Browser B can book immediately ✅ |
| Stale lock shown | Real-time lock status ✅ |
| Poor UX | Excellent UX ✅ |

---

## 🧪 Testing Steps

### Test 1: Immediate Booking After Expiry

1. **Browser A**: Click "Book Now" → Modal opens
2. **Wait for timer to expire** (60 seconds)
3. **Browser A**: Close modal
4. **Browser B**: Click "Book Now" immediately
5. **Expected**:
   - Browser B modal opens ✅
   - No refresh needed ✅

### Test 2: Booking Before Expiry

1. **Browser A**: Click "Book Now" → Modal opens
2. **Browser B** (within 60 seconds): Click "Book Now"
3. **Expected**:
   - Browser B gets "Another customer is booking..." error ✅
   - Time remaining shown in debug info ✅

### Test 3: Multiple Sequential Bookings

1. **Browser A**: Book → Wait 60s → Close
2. **Browser B**: Book immediately ✅
3. **Browser B**: Wait 60s → Close
4. **Browser A**: Book immediately ✅
5. **Expected**: No refresh needed, smooth flow ✅

---

## 🔍 Backend Console Logs (Expected)

### Browser A (Opens Modal)

```
🔒 ATOMIC LOCK: Attempting to lock slot 377
📍 User 9 trying to book slot 377
🔍 PRE-CHECK: Checking for existing pending payment intents...
✅ No existing pending payment intents found
🔐 Creating payment intent to lock slot 377
✅ Payment intent 190 created, slot 377 locked for 1 minute
```

### Browser B (Tries After 60 Seconds - Intent Expired)

```
🔒 ATOMIC LOCK: Attempting to lock slot 377
📍 User 2 trying to book slot 377
🔍 PRE-CHECK: Checking for existing pending payment intents...
⚠️ Found existing pending intent: {
  existingIntentId: 190,
  expiresAt: "2026-03-03T11:06:10.830Z"
}
⏰ Existing pending intent 190 has expired! Marking as expired...
✅ Intent 190 marked as expired, slot is now available
✅ No existing pending payment intents found (after expiry)
🔐 Creating payment intent to lock slot 377
✅ Payment intent 191 created, slot 377 locked for 1 minute
```

### Browser B (Tries Within 60 Seconds - Intent Valid)

```
🔒 ATOMIC LOCK: Attempting to lock slot 377
📍 User 2 trying to book slot 377
🔍 PRE-CHECK: Checking for existing pending payment intents...
⚠️ Found existing pending intent: {
  existingIntentId: 191,
  timeRemaining: 45
}
❌ Slot 377 already locked (45s remaining)
```

---

## ✅ Verification Checklist

After testing, verify:

- [ ] Timer expires in Browser A
- [ ] Browser B can book immediately without refresh ✅
- [ ] Backend logs show "Intent expired, slot is now available"
- [ ] Expired intent marked as "expired" immediately
- [ ] New payment intent created for Browser B
- [ ] Browser B can complete payment
- [ ] No need to refresh page ✅

---

## 🚀 Next Steps

1. **Test the scenario**:
   - Browser A: Open modal → Wait 60s → Close
   - Browser B: Click "Book Now" → Should work without refresh!

2. **Check backend logs**:
   - Look for "⏰ Existing pending intent has expired!"
   - Should see immediate expiry marking

3. **Verify smooth flow**:
   - No more "SLOT_LOCKED" errors after timer expires
   - Browser B can book immediately
   - Excellent UX!

---

## 🎉 Summary

**The Fix**:
- Added expiry check during pre-check
- Auto-mark expired intents immediately
- Don't wait for cleanup service

**The Result**:
- Real-time slot availability
- No page refresh needed
- Smooth handover between customers
- Perfect UX!

Now Browser B can book immediately after Browser A's timer expires, without refreshing! 🎉
