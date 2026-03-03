# Slot Locking System - Phase 4: Frontend Enhancements

## 📅 Date: March 3, 2026

## ✅ Status: COMPLETED

---

## 🎯 Objective

Implement auto-retry mechanism and enhanced UX for handling slot locking scenarios. When a customer tries to book a slot that's temporarily locked by another customer, the system should automatically retry instead of showing an immediate error.

---

## 🔧 Changes Made

### File: `components/customer/payment/PaymentModal.tsx`

#### 1. Added New Payment Step: "retrying"

**Line 38-46:** Added retrying to the PaymentStep type.

```typescript
type PaymentStep =
  | "init"
  | "creating"
  | "ready"
  | "processing"
  | "success"
  | "failed"
  | "expired"
  | "retrying";  // ✨ NEW
```

#### 2. Added Retry State Management

**Lines 60-69:** Added retry-related state variables.

```typescript
// Retry state
const [retryCount, setRetryCount] = useState<number>(0);
const [retryCountdown, setRetryCountdown] = useState<number>(0);
const maxRetries = 3; // Maximum number of retry attempts
const retryDelay = 2000; // 2 seconds between retries

// Track retry timeout to allow cancellation
const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
```

#### 3. Enhanced `handleCreateOrder` with Auto-Retry Logic

**Lines 107-164:** Complete refactor with auto-retry mechanism.

**Key Features:**
- Detects "slot locked" errors via `err.code === "SLOT_LOCKED"` or `err.retryable === true`
- Automatically retries after 2 seconds
- Shows toast notification with retry count
- Resets retry count on success
- Handles max retries reached gracefully

```typescript
const handleCreateOrder = async (isRetry: boolean = false) => {
  // ... setup code ...

  try {
    const response = await api.post<PaymentOrderResponse>(
      API_ENDPOINTS.PAYMENT.CREATE_ORDER,
      bookingData,
    );

    // Success! Reset retry count
    setRetryCount(0);
    setStep("ready");

    if (isRetry) {
      toast.success("Slot is now available! You can proceed with payment.");
    }
  } catch (err: any) {
    // Check if this is a "slot locked" error (retryable)
    const isSlotLocked = err.code === "SLOT_LOCKED" || err.retryable === true;

    if (isSlotLocked && retryCount < maxRetries) {
      // Auto-retry logic
      const newRetryCount = retryCount + 1;
      setRetryCount(newRetryCount);

      // Show toast notification
      toast.info(
        `Another customer is booking this slot. Retrying in 2 seconds... (${newRetryCount}/${maxRetries})`
      );

      // Start countdown
      setRetryCountdown(2);
      // ... countdown logic ...

      // Schedule retry after 2 seconds
      const timeoutId = setTimeout(() => {
        handleCreateOrder(true); // Recursive call
      }, retryDelay);

      return; // Don't set step to failed yet
    }

    // Max retries reached or non-retryable error
    // ... human-friendly error messages ...
  }
};
```

#### 4. Added `handleCancelRetry` Function

**Lines 362-372:** Allows user to cancel auto-retry.

```typescript
const handleCancelRetry = () => {
  // Clear the retry timeout
  if (retryTimeoutRef.current) {
    clearTimeout(retryTimeoutRef.current);
    retryTimeoutRef.current = null;
  }

  setStep("failed");
  setError("Retry cancelled. The slot may still be available. Please try again.");
  toast.info("Auto-retry cancelled. You can manually retry or choose a different slot.");
};
```

#### 5. Enhanced Cleanup with Retry Timeout

**Lines 87-106:** Clear retry timeout on unmount.

```typescript
useEffect(() => {
  return () => {
    // Clear retry timeout if active
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      console.log("🛑 Cancelled pending retry");
    }

    // ... rest of cleanup ...
  };
}, [orderData, step]);
```

#### 6. New "Retrying" UI State

**Lines 422-447:** Visual feedback during retry attempts.

```typescript
{step === "retrying" && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center">
      <div className="relative">
        <Loader2 className="h-16 w-16 animate-spin text-orange-500 mx-auto mb-4" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold text-orange-600">{retryCountdown}</span>
        </div>
      </div>
      <h3 className="text-xl font-semibold mb-2 text-orange-700">
        Slot Locked - Retrying...
      </h3>
      <p className="text-muted-foreground mb-2">
        Another customer is currently booking this slot.
      </p>
      <p className="text-sm text-muted-foreground mb-6">
        Automatically retrying in {retryCountdown} second{retryCountdown !== 1 ? "s" : ""} (Attempt {retryCount}/{maxRetries})
      </p>
      <button onClick={handleCancelRetry}>
        Cancel Retry
      </button>
    </div>
  </div>
)}
```

#### 7. Enhanced "Failed" State UI

**Lines 506-546:** Dynamic error messages based on error type.

```typescript
// Determine icon and title based on error type
const isSlotLocked = error?.includes("currently booking") || error?.includes("locked");
const isSlotBooked = error?.includes("already been booked");
const isRetryCancelled = error?.includes("Retry cancelled");

return (
  <div>
    {isSlotBooked ? (
      <Clock className="text-orange-500" />  // Slot booked icon
    ) : isRetryCancelled ? (
      <AlertCircle className="text-blue-500" />  // Retry cancelled icon
    ) : (
      <XCircle className="text-red-500" />  // Error icon
    )}
    <h3>
      {isSlotBooked ? "Slot Already Booked" :
       isRetryCancelled ? "Retry Cancelled" :
       "Payment Failed"}
    </h3>
    <p>{error}</p>
    <button onClick={handleRetry}>
      {isSlotBooked ? "Choose Different Slot" : "Try Again"}
    </button>
  </div>
);
```

#### 8. Updated Timer for 1 Minute Lock Duration

**Lines 59, 579-591:** Changed from 2 minutes to 1 minute.

```typescript
const [timeRemaining, setTimeRemaining] = useState<number>(60); // 1 minute (was 120)

// Timer color thresholds updated for 1 minute
className={`${
  timeRemaining < 20
    ? "bg-red-100 text-red-700 animate-pulse"  // Under 20 seconds
    : timeRemaining < 40
      ? "bg-orange-100 text-orange-700"        // Under 40 seconds
      : "bg-blue-100 text-blue-700"            // 40+ seconds
}`}
```

**Lines 595-609:** Updated warning messages.

```typescript
{step === "ready" && timeRemaining < 30 && (
  <div className="warning">
    <p>
      {timeRemaining < 15
        ? "Hurry! Your session is about to expire. Complete payment now."
        : "Your session will expire soon. Complete payment to keep your slot."}
    </p>
  </div>
)}

<div className="payment-info">
  <p>• Slot is reserved for 1 minute</p>  {/* Was 2 minutes */}
  <p>• Booking confirmed only after provider approval</p>
  <p>• Full refund if provider rejects booking</p>
</div>
```

---

## 📊 User Experience Flow

### Scenario 1: Slot Available (Happy Path)

```
User clicks "Book Now"
    ↓
[Creating: Reserving your slot...]
    ↓
[Ready: Show payment button + 1 minute timer]
    ↓
User pays → [Success]
```

### Scenario 2: Slot Locked (Auto-Retry)

```
User clicks "Book Now"
    ↓
[Creating: Reserving your slot...]
    ↓
Error: SLOT_LOCKED (another customer booking)
    ↓
Toast: "Another customer is booking this slot. Retrying in 2 seconds... (1/3)"
    ↓
[Retrying: Countdown 2...]
    ↓
(2 seconds later)
    ↓
Automatically retries...

┌─ If slot available:
│   ↓
│   [Ready: Show payment button]
│   Toast: "Slot is now available! You can proceed with payment."
│
└─ If still locked:
    ↓
    Toast: "Retrying in 2 seconds... (2/3)"
    [Retrying: Countdown 2...]
    ↓
    (Repeat up to 3 times)

If still locked after 3 retries:
    ↓
    [Failed: Slot is still locked after multiple attempts]
    Button: "Try Again" / "Close"
```

### Scenario 3: Slot Already Booked

```
User clicks "Book Now"
    ↓
[Creating: Reserving your slot...]
    ↓
Error: SLOT_ALREADY_BOOKED
    ↓
[Failed: Slot Already Booked]
Message: "This slot has already been booked. Please select a different time."
Button: "Choose Different Slot" / "Close"
```

---

## 🎨 UI Components

### 1. Creating State
```
┌─────────────────────────┐
│     [Spinner]           │
│  Preparing Payment       │
│  Reserving your slot...  │
└─────────────────────────┘
```

### 2. Retrying State (NEW)
```
┌─────────────────────────┐
│   [Spinner with "2"]    │
│ Slot Locked - Retrying...│
│ Another customer is     │
│ currently booking this  │
│ slot.                   │
│                         │
│ Automatically retrying  │
│ in 2 seconds (1/3)      │
│                         │
│   [Cancel Retry]        │
└─────────────────────────┘
```

### 3. Failed State (Enhanced)
```
┌─────────────────────────┐
│     [Error Icon]        │
│  Slot Already Booked    │
│                         │
│ This slot has already   │
│ been booked. Please     │
│ select a different time.│
│                         │
│ [Choose Different Slot] │
│       [Close]           │
└─────────────────────────┘
```

---

## 🧪 Testing

### Test 1: Auto-Retry When Slot Locked

1. Open browser A, start booking flow (don't complete payment)
2. Open browser B, try to book same slot
3. **Expected:**
   - Browser B shows: "Slot Locked - Retrying..."
   - Countdown: 2... 1...
   - Automatically retries after 2 seconds
   - If A completes/cancels, B shows: "Slot is now available!"

### Test 2: Max Retries

1. Browser A keeps payment modal open
2. Browser B tries to book same slot
3. **Expected:**
   - B retries 3 times (6 seconds total)
   - After 3rd retry: "Slot is still locked after multiple attempts"
   - User can manually retry or close

### Test 3: Cancel Retry

1. Browser B shows retrying screen
2. Click "Cancel Retry"
3. **Expected:**
   - Retry stops immediately
   - Shows: "Retry cancelled. The slot may still be available."
   - Can manually retry

### Test 4: Already Booked Slot

1. Browser A completes payment successfully
2. Browser B tries to book same slot
3. **Expected:**
   - No retry (immediate error)
   - Shows: "Slot Already Booked"
   - Button: "Choose Different Slot"

---

## 📁 Files Changed

### Frontend
1. **`components/customer/payment/PaymentModal.tsx`**
   - Line 45: Added "retrying" to PaymentStep type
   - Lines 60-69: Added retry state variables
   - Lines 107-164: Enhanced handleCreateOrder with auto-retry
   - Lines 362-372: Added handleCancelRetry function
   - Lines 422-447: New retrying UI state
   - Lines 506-546: Enhanced failed state UI
   - Lines 59, 579-609: Updated timer to 1 minute

---

## 🔍 How to Verify Changes

### 1. Check the Enhanced Component

```bash
# Open this file:
C:\Users\uasai\Desktop\Umer-Enacton\Home service\hsm-frontend\components\customer\payment\PaymentModal.tsx
```

**Key additions:**
- Line 45: `"retrying"` step
- Lines 60-69: Retry state
- Lines 362-372: Cancel retry function
- Lines 422-447: Retrying UI

### 2. Test Auto-Retry in Browser

```
1. Open browser A → Select service → Book Now
2. Don't complete payment, keep modal open
3. Open browser B → Same service, same slot → Book Now
4. Watch browser B:
   ✅ Shows "Retrying in 2 seconds..."
   ✅ Countdown: 2... 1...
   ✅ Auto-retries after 2 seconds
```

### 3. Check Browser Console

```
Browser B console:
⏳ Slot locked, retrying... (attempt 1/3)
⏳ Slot locked, retrying... (attempt 2/3)
✅ Slot is now available! (if A released)
```

### 4. Toast Notifications

Watch for toasts:
- ℹ️ "Another customer is booking this slot. Retrying in 2 seconds... (1/3)"
- ✅ "Slot is now available! You can proceed with payment."
- ℹ️ "Auto-retry cancelled. You can manually retry or choose a different slot."

---

## ⚙️ Configuration

### Retry Settings

| Setting | Value | Location |
|---------|-------|----------|
| `maxRetries` | 3 | Line 62 |
| `retryDelay` | 2000ms (2 seconds) | Line 63 |

### Timer Thresholds (1 minute lock)

| Time Remaining | Color | Animation |
|----------------|-------|-----------|
| 0-20 seconds | Red | Pulse |
| 20-40 seconds | Orange | None |
| 40-60 seconds | Blue | None |

---

## ⚠️ Important Notes

### 1. Retry Behavior
- **Automatic:** Retries happen automatically without user intervention
- **Cancellable:** User can cancel retry at any time
- **Smart:** Only retries for "slot locked" errors, not for "already booked"

### 2. Backend Error Codes

The frontend recognizes these error codes:

| Code | Retryable? | Behavior |
|------|-----------|----------|
| `SLOT_LOCKED` | ✅ Yes | Auto-retry up to 3 times |
| `SLOT_ALREADY_BOOKED` | ❌ No | Immediate error, no retry |
| `RAZORPAY_ERROR` | ❌ No | Immediate error, no retry |

### 3. Timer Change
- **Before:** 2 minutes
- **After:** 1 minute
- **Reason:** Faster slot release = better UX

### 4. User Feedback
- **Toast notifications** for retry attempts
- **Visual countdown** during retry
- **Clear error messages** based on error type
- **Cancel button** for retry control

---

## 🎉 Phase 4 Complete!

### Summary of All Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1** | Database: Added unique constraint | ✅ Complete |
| **Phase 2** | Backend: Optimistic locking + cancel endpoint | ✅ Complete |
| **Phase 3** | Backend: Auto-cleanup expired intents | ✅ Complete |
| **Phase 4** | Frontend: Auto-retry + enhanced UX | ✅ Complete |

### System Now Has:
- ✅ **Atomic slot locking** via database constraint
- ✅ **Optimistic locking** for better performance
- ✅ **Auto-cleanup** of expired intents (every 30s)
- ✅ **Auto-retry** when slot is temporarily locked
- ✅ **Human-friendly messages** for all scenarios
- ✅ **1-minute lock duration** for faster slot release
- ✅ **Slot release on cancel** (user or modal close)

---

## 📞 Contact

For questions or issues with Phase 4, check:
- Payment Modal: `components/customer/payment/PaymentModal.tsx`
- Key lines: 45, 60-69, 107-164, 362-372, 422-447
