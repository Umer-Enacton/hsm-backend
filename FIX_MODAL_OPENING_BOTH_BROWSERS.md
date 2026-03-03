# Fix: Modal Opening in Both Browsers

## 🐛 Problem

Both payment modals were opening in different browsers, even when the slot should be locked.

### Root Cause

The `apiRequest` function in `lib/api.ts` was throwing a generic `Error` object that only preserved the `message` property. The backend's error response included:
- `message`: Human-readable error message
- `code`: Error code ("SLOT_LOCKED", "SLOT_ALREADY_BOOKED", etc.)
- `retryable`: Boolean flag for retryable errors

But the frontend was losing the `code` and `retryable` properties, so the error handling in the service page couldn't detect when the slot was locked.

### What Was Happening

```
Browser A → API call → Creates intent #128 → Opens modal ✅
Browser B → API call → Gets 409 error → BUT error.code is undefined
                                                       → Modal still opens! ❌
```

---

## ✅ Solution

### 1. Enhanced API Request Function

**File:** `lib/api.ts`

**Before:**
```typescript
if (!response.ok) {
  const error = await response.json().catch(() => ({
    message: "An error occurred",
  }));
  throw new Error(error.message || "Request failed");  // ❌ Loses code, retryable
}
```

**After:**
```typescript
if (!response.ok) {
  const error = await response.json().catch(() => ({
    message: "An error occurred",
    code: undefined,
  }));

  // Create enhanced error with all response properties
  const enhancedError = new Error(error.message || "Request failed") as any;
  enhancedError.code = error.code;              // ✅ Preserved
  enhancedError.statusCode = response.status;   // ✅ Preserved
  enhancedError.retryable = error.retryable;    // ✅ Preserved
  enhancedError.cause = error;                   // ✅ Original data

  throw enhancedError;
}
```

### 2. Updated Error Handling

**File:** `app/(pages)/customer/services/[id]/page.tsx`

**Before:**
```typescript
const errorCode = err.code || err.cause?.code;
if (errorCode === "SLOT_LOCKED" || err.retryable === true || err.code === 409) {
  toast.error("...");
}
```

**After:**
```typescript
const errorCode = err.code || err.cause?.code || err.statusCode;
const isRetryable = err.retryable || err.cause?.retryable;

// Log for debugging
console.log("📊 Error details:", { errorCode, errorMessage, isRetryable, statusCode });

if (errorCode === "SLOT_LOCKED" || isRetryable === true || err.statusCode === 409) {
  toast.error("Another customer is currently booking this slot. Please wait a moment or choose a different slot.");
  // NO modal opened ✅
}
```

---

## 🧪 Test It Now!

### Test Scenario: Simultaneous Booking

1. **Open two browsers** (different customers)
2. **Same service, same slot, same date**
3. **Click "Book Now" in both browsers rapidly**

### Expected Results:

```
Browser A:
    ↓
    [Button: Checking availability...]
    ↓
    ✅ Creates payment intent #128
    ↓
    Opens payment modal
    ↓
    Can proceed to payment

Browser B:
    ↓
    [Button: Checking availability...]
    ↓
    ❌ Gets 409 SLOT_LOCKED error
    ↓
    Toast: "Another customer is currently booking this slot..."
    ↓
    NO modal opens! ✅
```

### Backend Console Log:

```
Browser A:
🔐 Creating payment intent to lock slot 381
✅ Payment intent 128 created, slot 381 locked for 1 minute

Browser B:
🔐 Creating payment intent to lock slot 381
⏳ Slot 381 is already locked by another customer
[Returns 409 with SLOT_LOCKED code]
```

---

## 🔍 Debugging

If it still doesn't work, check the browser console logs for:

```
📊 Error details: {
  errorCode: "SLOT_LOCKED",
  errorMessage: "...",
  isRetryable: true,
  statusCode: 409
}
```

If you see `errorCode: undefined` and `statusCode: undefined`, the error is still not being preserved correctly.

---

## 📁 Files Changed

1. **`lib/api.ts`** (Lines 136-152)
   - Enhanced error object to preserve all response properties

2. **`app/(pages)/customer/services/[id]/page.tsx`** (Lines 330-355)
   - Updated error handling to check multiple error properties
   - Added debug logging

---

## 🎯 Why This Works Now

| Property | Before | After |
|----------|--------|-------|
| `err.code` | ❌ Undefined | ✅ "SLOT_LOCKED" |
| `err.retryable` | ❌ Undefined | ✅ true |
| `err.statusCode` | ❌ Undefined | ✅ 409 |
| `err.cause` | ❌ Undefined | ✅ Original error data |

Now the frontend can properly detect when the slot is locked and prevent the modal from opening!

---

## ⚠️ Important Notes

1. **Race Condition Still Possible**: If both browsers click within milliseconds of each other, both might pass through before the database constraint kicks in. This is acceptable behavior.

2. **Modal Cleanup**: If payment modal opens in one browser and they close it, the slot is released and the other browser can then book it.

3. **Payment Success**: If the first customer completes payment, the slot is permanently booked and the second customer will get "Slot already booked" error.

---

## ✅ Verification Checklist

After testing, you should see:

- [ ] Browser A opens modal, Browser B gets toast error
- [ ] No `paymentIntent is not defined` errors
- [ ] Console shows proper error codes
- [ ] Slot released when modal closed
- [ ] Both customers cannot pay for same slot
