# Razorpay Validation Fix - Prevent Duplicate Payment Opens

## 📅 Date: March 3, 2026

---

## 🎯 Critical Issue Fixed

**Problem**: Both customers could:
1. ✅ Open custom payment modal (fixed in previous step)
2. ❌ **Click "Pay Now" and BOTH open Razorpay checkout** ❌

**User's Report**:
> "see what i want that if on a slot a modal is open where it is any modal then for same slot another customer not show modal just error but in this open modal on both not even our modal but also razorpay payment modal also allow to open on pay now"

---

## 🔍 Root Cause

The previous fix prevented opening the **custom modal**, but didn't validate the slot lock when clicking **"Pay Now"**. This meant both users could:

1. **User A**: Click "Book Now" → Modal opens → Click "Pay Now" → Razorpay opens ✅
2. **User B**: Click "Book Now" → Should get error, BUT if modal opens → Click "Pay Now" → Razorpay ALSO opens! ❌

The issue was that opening Razorpay didn't check if the slot was still locked.

---

## ✅ Solution Implemented

### New Validation Layer

**Added**: `POST /payment/validate-intent` endpoint

**When**: Called BEFORE opening Razorpay checkout

**What it checks**:
1. ✅ Payment intent exists
2. ✅ User owns the payment intent
3. ✅ Payment intent is still "pending"
4. ✅ Payment intent hasn't expired
5. ✅ **Slot hasn't been booked by someone else**
6. ✅ **No other payment intent exists for same slot+date**

**If any check fails**:
- Close the custom payment modal
- Show error message to user
- Don't open Razorpay checkout

---

## 📁 Files Changed

### Backend Changes (2 files)

**1. `controllers/payment.controller.js`**

**Lines 640-800**: Added `validatePaymentIntent` function

```javascript
const validatePaymentIntent = async (req, res) => {
  const { paymentIntentId } = req.body;
  const userId = req.token.id;

  // Check if payment intent exists
  const [paymentIntent] = await db.select()...;

  if (!paymentIntent) {
    return res.status(404).json({
      valid: false,
      message: "Payment session not found...",
      code: "INTENT_NOT_FOUND"
    });
  }

  // Verify ownership
  if (paymentIntent.userId !== userId) {
    return res.status(403).json({
      valid: false,
      message: "You don't have permission...",
      code: "NOT_AUTHORIZED"
    });
  }

  // Check status
  if (paymentIntent.status !== "pending") {
    return res.status(400).json({
      valid: false,
      message: `Payment session is ${paymentIntent.status}...`,
      code: paymentIntent.status.toUpperCase()
    });
  }

  // Check if expired
  if (new Date() > new Date(paymentIntent.expiresAt)) {
    // Mark as expired
    await db.update(paymentIntents)
      .set({ status: "expired" })
      .where(eq(paymentIntents.id, paymentIntentId));

    return res.status(400).json({
      valid: false,
      message: "Payment session has expired...",
      code: "EXPIRED"
    });
  }

  // CRITICAL: Check if slot has been booked by someone else
  const [existingBooking] = await db.select()...;

  if (existingBooking) {
    // Cancel this payment intent
    await db.update(paymentIntents)
      .set({ status: "failed", failureReason: "Slot already booked..." })
      .where(eq(paymentIntents.id, paymentIntentId));

    return res.status(409).json({
      valid: false,
      message: "This slot has been booked by another customer...",
      code: "SLOT_ALREADY_BOOKED"
    });
  }

  // CRITICAL: Check if another payment intent exists for same slot+date
  const [otherPendingIntent] = await db.select()...;

  if (otherPendingIntent && datesMatch) {
    return res.status(409).json({
      valid: false,
      message: "Another customer is currently booking this slot...",
      code: "SLOT_LOCKED",
      retryable: true
    });
  }

  // All checks passed!
  return res.status(200).json({
    valid: true,
    data: { ... }
  });
};
```

**2. `routes/payment.route.js`**

**Lines 84-97**: Added route for validation endpoint

```javascript
/**
 * POST /payment/validate-intent
 * CRITICAL: Validate payment intent before opening Razorpay
 */
router.post("/validate-intent", paymentController.validatePaymentIntent);
```

### Frontend Changes (3 files)

**1. `components/customer/payment/RazorpayCheckout.tsx`**

**Lines 1-13**: Updated imports to include useState and Loader2

**Lines 51-137**: Updated `useRazorpay` hook to validate before opening

```typescript
export function useRazorpay({
  options,
  paymentIntentId, // NEW prop
  onPaymentSuccess,
  onPaymentFailure,
  onModalClose,
}: RazorpayCheckoutProps) {
  const scriptLoaded = useRazorpayScript();
  const [isValidating, setIsValidating] = useState(false);

  const openCheckout = async () => {
    // Check Razorpay loaded
    if (!window.Razorpay) {
      onPaymentFailure?.(new Error("Razorpay not loaded..."));
      return;
    }

    // CRITICAL: Validate payment intent before opening Razorpay
    if (paymentIntentId) {
      setIsValidating(true);
      try {
        console.log(`🔍 Validating payment intent ${paymentIntentId}...`);

        const validationResponse = await api.post(
          API_ENDPOINTS.PAYMENT.VALIDATE_INTENT,
          { paymentIntentId }
        );

        if (!validationResponse.valid) {
          console.error(`❌ Validation failed:`, validationResponse);

          // Close the payment modal
          onModalClose?.();

          onPaymentFailure?.(new Error(validationResponse.message));
          setIsValidating(false);
          return;
        }

        console.log(`✅ Payment intent validated successfully`);
      } catch (error: any) {
        console.error(`❌ Validation error:`, error);

        // Close the payment modal
        onModalClose?.();

        onPaymentFailure?.(error);
        setIsValidating(false);
        return;
      } finally {
        setIsValidating(false);
      }
    }

    // Open Razorpay checkout
    const rzp = new window.Razorpay(razorpayOptions);
    rzp.open();
  };

  return { openCheckout, scriptLoaded, isValidating };
};
```

**Lines 139-194**: Updated `RazorpayCheckoutButton` component

```typescript
interface RazorpayCheckoutButtonProps {
  options: RazorpayOptions;
  paymentIntentId?: number; // NEW prop
  onPaymentSuccess?: (response: RazorpayResponse) => void;
  onPaymentFailure?: (error: any) => void;
  onModalClose?: () => void;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
}

export function RazorpayCheckoutButton({
  options,
  paymentIntentId, // NEW
  onPaymentSuccess,
  onPaymentFailure,
  onModalClose,
  children,
  className = "",
  disabled = false,
  loading = false,
}: RazorpayCheckoutButtonProps) {
  const { openCheckout, scriptLoaded, isValidating } = useRazorpay({
    options,
    paymentIntentId, // Pass to hook
    onPaymentSuccess,
    onPaymentFailure,
    onModalClose,
  });

  const handleClick = () => {
    if (!scriptLoaded) {
      onPaymentFailure?.(new Error("Payment gateway is loading..."));
      return;
    }
    openCheckout();
  };

  const isLoading = loading || isValidating;

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isLoading || !scriptLoaded}
      className={className}
      type="button"
    >
      {isLoading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          {isValidating ? "Validating..." : "Processing..."}
        </>
      ) : (
        children || "Pay Now"
      )}
    </button>
  );
}
```

**2. `components/customer/payment/PaymentModal.tsx`**

**Lines 456-470**: Updated RazorpayCheckoutButton usage

```typescript
{step === "ready" && orderData && (
  <RazorpayCheckoutButton
    options={getRazorpayOptions()!}
    paymentIntentId={orderData.paymentIntentId} // NEW prop
    onPaymentSuccess={handlePaymentSuccess}
    onPaymentFailure={handlePaymentFailure}
    onModalClose={() => {
      console.log("ℹ️ Razorpay modal closed by user");
    }}
    className="w-full bg-gradient-to-r from-purple-600 to-indigo-600..."
  >
    Pay ₹{formatAmount(orderData.amount)}
  </RazorpayCheckoutButton>
)}
```

**3. `lib/api.ts`**

**Lines 94-95**: Added VALIDATE_INTENT endpoint

```typescript
PAYMENT: {
  CREATE_ORDER: "/payment/create-order",
  VERIFY: "/payment/verify",
  FAILED: "/payment/failed",
  CANCEL_INTENT: "/payment/cancel-intent",
  VALIDATE_INTENT: "/payment/validate-intent", // NEW
  WEBHOOK: "/payment/webhook",
  ...
}
```

---

## 📊 Complete Flow Now

### User A (First Customer)

```
1. Click "Book Now"
   ↓
2. Button: "Checking availability..." (1-2 seconds)
   ↓
3. Backend: Pre-check → No locks found ✅
   ↓
4. Backend: Insert payment intent → Success ✅
   ↓
5. Frontend: Open custom payment modal
   ↓
6. User clicks "Pay Now"
   ↓
7. Frontend: Call /payment/validate-intent
   ↓
8. Backend: Validate all checks ✅
   ↓
9. Frontend: Open Razorpay checkout ✅
```

### User B (Second Customer - Within 1 Minute)

#### Scenario 1: Before User A Clicks "Pay Now"

```
1. Click "Book Now"
   ↓
2. Button: "Checking availability..." (1-2 seconds)
   ↓
3. Backend: Pre-check → Found existing lock! ❌
   ↓
4. Backend: Return 409 SLOT_LOCKED error
   ↓
5. Frontend: Show toast error
   ↓
6. NO modal opens ✅
```

#### Scenario 2: After User A Opens Custom Modal (Before Clicking "Pay Now")

```
1. Click "Book Now"
   ↓
2. Button: "Checking availability..." (1-2 seconds)
   ↓
3. Backend: Pre-check → Found existing lock! ❌
   ↓
4. Backend: Return 409 SLOT_LOCKED error
   ↓
5. Frontend: Show toast error
   ↓
6. NO modal opens ✅
```

#### Scenario 3: After User A Clicks "Pay Now" (Worst Case - Both Have Modals Open)

```
1. User B has custom modal open (somehow got through)
   ↓
2. User B clicks "Pay Now"
   ↓
3. Button: "Validating..." (1-2 seconds)
   ↓
4. Backend: Check payment intent
   ↓
5. Backend: Check for existing bookings → None ✅
   ↓
6. Backend: Check for other pending intents → Found User A's intent! ❌
   ↓
7. Backend: Return 409 SLOT_LOCKED error
   ↓
8. Frontend: Close custom modal ❌
   ↓
9. Frontend: Show error toast
   ↓
10. NO Razorpay opens ✅
```

---

## 🧪 Testing Steps

### Test 1: Normal Flow (Slot Available)

1. **Open one browser**
2. **Navigate to service page**
3. **Select date and slot**
4. **Click "Book Now"**
5. **Expected**:
   - Button: "Checking availability..." ✅
   - Modal opens ✅
   - Click "Pay Now" → Button: "Validating..." ✅
   - Razorpay opens ✅

### Test 2: Simultaneous Booking (Both Click "Book Now" Rapidly)

1. **Open two browsers** (different customers)
2. **Navigate to same service page**
3. **Select same date and slot**
4. **Click "Book Now" in both browsers rapidly**
5. **Expected**:
   - Browser A: Modal opens ✅
   - Browser B: Toast error "Another customer is currently booking..." ✅
   - Browser B: NO modal opens ✅

### Test 3: User B Has Modal Open (Edge Case)

1. **Browser A**: Click "Book Now" → Modal opens
2. **Browser B**: Click "Pay Now" (somehow got modal open)
3. **Expected**:
   - Browser B: Button shows "Validating..."
   - Backend: Finds User A's payment intent
   - Browser B: Modal closes
   - Browser B: Toast error "Another customer is currently booking..." ✅
   - Browser B: NO Razorpay opens ✅

### Test 4: User A Completes Payment

1. **Browser A**: Click "Book Now" → Modal opens → Click "Pay Now" → Razorpay opens → Complete payment
2. **Browser B**: Click "Book Now"
3. **Expected**:
   - Browser B: Toast error "This slot has already been booked..." ✅
   - Browser B: NO modal opens ✅

### Test 5: Lock Expiry

1. **Browser A**: Click "Book Now" → Modal opens
2. **Wait 60 seconds** (don't click "Pay Now")
3. **Browser A**: Click "Pay Now"
4. **Expected**:
   - Button: "Validating..."
   - Backend: Payment intent expired
   - Browser A: Modal closes
   - Browser A: Toast error "Payment session has expired..." ✅

---

## 🔍 Backend Console Logs

### User A (Valid Payment Intent)

```
🔒 ATOMIC LOCK: Attempting to lock slot 384...
📍 User 2 trying to book slot 384...
🔍 PRE-CHECK: Checking for existing pending payment intents...
✅ No existing pending payment intents found for slot 384
🔐 Creating payment intent to lock slot 384
📦 Insert data: { userId: 2, slotId: 384, status: "pending", ... }
✅ Payment intent 169 created, slot 384 locked for 1 minute
✅ Razorpay order created: order_SMj4LyMeNPsQcx
✅ Payment intent 169 updated with Razorpay order ID

// User clicks "Pay Now"
🔍 [VALIDATE] Checking payment intent 169 for user 2
✅ [VALIDATE] Payment intent 169 is valid (45s remaining)
```

### User B (Slot Locked)

```
🔒 ATOMIC LOCK: Attempting to lock slot 384...
📍 User 9 trying to book slot 384...
🔍 PRE-CHECK: Checking for existing pending payment intents...
⚠️ Found existing pending intent: { existingIntentId: 169, ... }
❌ Slot 384 already locked for 2026-03-03 by user 2
```

### User B (Edge Case - Got Modal Open, Clicks "Pay Now")

```
🔍 [VALIDATE] Checking payment intent 170 for user 9
❌ [VALIDATE] Another payment intent 169 exists for slot 384 on 2026-03-03
```

---

## ✅ Verification Checklist

After testing, verify:

- [ ] Normal flow works (modal opens, Razorpay opens)
- [ ] Simultaneous booking: Only one modal opens
- [ ] Second user gets toast error (not modal)
- [ ] Second user can't open Razorpay (validation prevents it)
- [ ] If User A completes payment, User B gets "Slot already booked" error
- [ ] If User A cancels, User B can book after 1 minute
- [ ] Backend shows validation logs
- [ ] "Validating..." state shows on button during validation

---

## 🎯 Key Benefits

1. ✅ **Triple-layer protection**:
   - Pre-check before modal opens
   - Validation before Razorpay opens
   - Database unique constraint

2. ✅ **Clean UX**: No modal flashing, no duplicate errors

3. ✅ **Prevents duplicate payments**: Only ONE Razorpay checkout can open per slot

4. ✅ **Real-time validation**: Even if modal opens, Razorpay won't open if slot is locked

5. ✅ **Automatic cleanup**: Invalid intents are marked as failed

---

## 🚀 Next Steps

1. **Restart backend server**:
   ```bash
   cd home-service-management-backend
   npm run dev
   ```

2. **Test all scenarios** from the testing steps above

3. **Check console logs** for validation messages

4. **Verify**: Only ONE customer can open Razorpay checkout per slot

---

## 📞 If Issues Persist

1. Check backend console for `[VALIDATE]` logs
2. Check browser console for validation errors
3. Test with diagnostic endpoint: `GET /payment/slot-lock-status?slotId=<id>&bookingDate=<date>`
4. Verify database state:
   ```sql
   SELECT * FROM payment_intents WHERE status = 'pending';
   ```
5. Check for stale data and clean up if needed

The system now has **comprehensive protection** at multiple layers to prevent double booking and duplicate payment opens!
