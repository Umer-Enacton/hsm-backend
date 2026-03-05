const db = require("../config/db");
const {
  bookings,
  services,
  slots,
  Address,
  businessProfiles,
  payments,
  paymentIntents,
  users,
} = require("../models/schema");
const { eq, and, gte, lte, desc, or, sql } = require("drizzle-orm");
const {
  createRazorpayOrder,
  verifySignature,
  initiateRefund,
  rupeesToPaise,
  paiseToRupees,
} = require("../utils/razorpay");

/**
 * Create payment order for a booking
 * POST /payment/create-order
 *
 * NEW FLOW:
 * 1. Validate booking details
 * 2. Check slot availability (including pending payment_intents)
 * 3. Create payment_intent (locks slot for 2 minutes)
 * 4. Create Razorpay order
 * 5. Return order details to frontend
 * 6. NO booking created yet - booking created after successful payment
 */
const createPaymentOrder = async (req, res) => {
  const client = await db.client; // Get transaction client

  try {
    const userId = req.token.id;
    const { serviceId, slotId, addressId, bookingDate } = req.body;

    // Validate required fields
    if (!serviceId || !slotId || !bookingDate || !addressId) {
      return res.status(400).json({
        message: "All fields are required: serviceId, slotId, addressId, bookingDate"
      });
    }

    // Validate booking date format
    const bookingDateObj = new Date(bookingDate);
    if (isNaN(bookingDateObj.getTime())) {
      return res.status(400).json({ message: "Invalid bookingDate format" });
    }

    // Check if booking date is in the past
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const bookingDateStart = new Date(
      bookingDateObj.getFullYear(),
      bookingDateObj.getMonth(),
      bookingDateObj.getDate()
    );

    if (bookingDateStart < todayStart) {
      return res
        .status(400)
        .json({ message: "Cannot book slots for past dates" });
    }

    // Verify address belongs to user
    const [address] = await db
      .select()
      .from(Address)
      .where(and(eq(Address.id, addressId), eq(Address.userId, userId)));

    if (!address) {
      return res.status(404).json({ message: "Please add an address first" });
    }

    // Verify service exists and is active
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, serviceId));

    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    if (!service.isActive) {
      return res.status(400).json({ message: "Service is not active" });
    }

    // Verify slot exists
    const [slot] = await db
      .select()
      .from(slots)
      .where(eq(slots.id, slotId));

    if (!slot) {
      return res.status(404).json({ message: "Slot not found" });
    }

    // Get business profile
    const [businessProfile] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, slot.businessProfileId));

    if (!businessProfile) {
      return res
        .status(404)
        .json({ message: "Business profile for the slot not found" });
    }

    // Verify business is verified
    if (!businessProfile.isVerified) {
      return res.status(403).json({ message: "Business is not verified" });
    }

    // OPTIMISTIC LOCKING: Try to insert payment_intent directly
    // Unique constraint prevents duplicate locks for same slot+date+status=pending
    console.log(`🔒 ATOMIC LOCK: Attempting to lock slot ${slotId} for ${bookingDate}`);
    console.log(`📍 User ${userId} trying to book slot ${slotId} on ${bookingDate}`);

    // Calculate amount BEFORE transaction (needed for error handling)
    const amountInPaise = rupeesToPaise(service.price);

    // Calculate expiry time for payment intent (1 minute from now)
    const expiresAt = new Date(now.getTime() + 1 * 60 * 1000);

    // Create date range for the selected date
    const startOfDay = new Date(bookingDateObj);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDateObj);
    endOfDay.setHours(23, 59, 59, 999);

    // ============================================
    // ADDITIONAL SAFEGUARD: Explicit check for existing pending payment intents
    // This adds a pre-check layer before the optimistic insert
    // ============================================
    console.log(`🔍 PRE-CHECK: Checking for existing pending payment intents...`);

    const [existingPendingIntent] = await db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.slotId, slotId),
          eq(paymentIntents.serviceId, serviceId), // ✅ Add serviceId check
          eq(paymentIntents.status, "pending")
        )
      )
      .limit(1);

    if (existingPendingIntent) {
      const existingDate = new Date(existingPendingIntent.bookingDate).toISOString().split('T')[0];
      const requestDate = new Date(bookingDateObj).toISOString().split('T')[0];

      console.log(`⚠️ Found existing pending intent:`, {
        existingIntentId: existingPendingIntent.id,
        existingDate: existingDate,
        requestDate: requestDate,
        slotId: slotId,
        serviceId: existingPendingIntent.serviceId,
        userId: existingPendingIntent.userId,
        expiresAt: existingPendingIntent.expiresAt
      });

      // CRITICAL: Check if the existing intent has expired (even if status is still pending)
      const now = new Date();
      const expiresAt = new Date(existingPendingIntent.expiresAt);
      const isExpired = now > expiresAt;

      if (isExpired) {
        console.log(`⏰ Existing pending intent ${existingPendingIntent.id} has expired! Marking as expired...`);

        // Mark it as expired immediately
        await db
          .update(paymentIntents)
          .set({ status: "expired" })
          .where(eq(paymentIntents.id, existingPendingIntent.id));

        console.log(`✅ Intent ${existingPendingIntent.id} marked as expired, slot is now available`);
        // Don't return error - continue with booking
      } else if (existingDate === requestDate) {
        // Intent is still valid and for the same date - block the slot
        const timeRemaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
        console.log(`❌ Slot ${slotId} already locked for Service ${existingPendingIntent.serviceId} on ${bookingDate} by user ${existingPendingIntent.userId} (${timeRemaining}s remaining)`);
        return res.status(409).json({
          message: "Another customer is currently booking this slot. Please wait a moment and try again, or choose a different slot.",
          code: "SLOT_LOCKED",
          retryable: true,
          debug: {
            existingIntentId: existingPendingIntent.id,
            lockedBy: existingPendingIntent.userId,
            lockedAt: existingPendingIntent.createdAt,
            timeRemaining: timeRemaining
          }
        });
      }
    } else {
      console.log(`✅ No existing pending payment intents found for slot ${slotId}`);
    }

    // Check if slot is already booked (confirmed bookings block new payment attempts)
    const [existingBooking] = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.slotId, slotId),
          gte(bookings.bookingDate, startOfDay),
          lte(bookings.bookingDate, endOfDay),
          or(
            eq(bookings.status, "pending"),
            eq(bookings.status, "payment_pending"),
            eq(bookings.status, "confirmed")
          )
        )
      )
      .limit(1);

    if (existingBooking) {
      console.log(`❌ Slot ${slotId} already booked for ${bookingDate}`);
      return res.status(409).json({
        message: "This slot has already been booked. Please select a different time.",
        code: "SLOT_ALREADY_BOOKED",
      });
    }

    let paymentIntent = null;
    let razorpayOrder = null;

    try {
      // Try to create payment_intent - unique constraint prevents race conditions
      console.log(`🔐 Creating payment intent to lock slot ${slotId}`);
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

      const [newIntent] = await db
        .insert(paymentIntents)
        .values({
          userId: userId,
          serviceId: serviceId,
          slotId: slotId,
          addressId: addressId,
          bookingDate: bookingDateObj,
          amount: amountInPaise,
          razorpayOrderId: `temp_${userId}_${Date.now()}`, // Temporary, will update after Razorpay order creation
          status: "pending",
          expiresAt: expiresAt,
        })
        .returning();

      paymentIntent = newIntent;
      console.log(`✅ Payment intent ${newIntent.id} created, slot ${slotId} locked for 1 minute`);
    } catch (insertError) {
      // Check if this is a unique constraint violation (slot already locked)
      const errorCode = insertError.code || insertError.cause?.code;
      const errorMessage = insertError.message || insertError.cause?.message || '';

      console.log(`❌ Insert failed with error:`, {
        errorCode,
        errorMessage: errorMessage.substring(0, 200),
        fullError: insertError.toString().substring(0, 300)
      });

      if (errorCode === '23505' || errorMessage.includes('unique constraint') || errorMessage.includes('duplicate key')) {
        console.log(`⏳ Slot ${slotId} is already locked by another customer (unique constraint violation)`);
        return res.status(409).json({
          message: "Another customer is currently booking this slot. Please wait a moment and try again, or choose a different slot.",
          code: "SLOT_LOCKED",
          retryable: true,
          debug: {
            constraint: 'payment_intents_slot_date_pending_unique',
            errorCode,
            errorMessage: errorMessage.substring(0, 200)
          }
        });
      }

      // Re-throw other errors to be handled by outer catch block
      console.log(`⚠️ Non-constraint error, re-throwing...`);
      throw insertError;
    }

    // Create Razorpay order now that slot is locked
    const tempReceipt = `intent_${paymentIntent.id}_${Date.now()}`;
    const notes = {
      serviceId: serviceId.toString(),
      userId: userId.toString(),
      slotId: slotId.toString(),
      bookingDate: bookingDate,
    };

    try {
      razorpayOrder = await createRazorpayOrder(amountInPaise, tempReceipt, notes);
      console.log(`✅ Razorpay order created: ${razorpayOrder.id}`);
    } catch (razorpayError) {
      console.error("❌ Razorpay order creation failed:", razorpayError);

      // Clean up the payment intent since Razorpay failed (releases slot lock)
      if (paymentIntent) {
        try {
          await db
            .delete(paymentIntents)
            .where(eq(paymentIntents.id, paymentIntent.id));
          console.log(`🧹 Released slot lock for payment_intent ${paymentIntent.id}`);
        } catch (cleanupError) {
          console.error("Error cleaning up payment_intent:", cleanupError);
        }
      }

      return res.status(500).json({
        message: "Payment gateway is temporarily unavailable. Please try again.",
        code: "RAZORPAY_ERROR",
        error: process.env.NODE_ENV === 'development' ? razorpayError.message : undefined,
      });
    }

    // Update payment intent with Razorpay order ID
    const [updatedIntent] = await db
      .update(paymentIntents)
      .set({ razorpayOrderId: razorpayOrder.id })
      .where(eq(paymentIntents.id, paymentIntent.id))
      .returning();

    console.log(`✅ Payment intent ${updatedIntent.id} updated with Razorpay order ID`);

    // Return order details to frontend
    res.status(201).json({
      message: "Payment order created successfully",
      paymentIntentId: updatedIntent.id,
      razorpayOrderId: updatedIntent.razorpayOrderId,
      amount: amountInPaise,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID,
      expiresAt: updatedIntent.expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("❌ Error creating payment order:", error);

    // If payment_intent was created but Razorpay failed, clean it up
    if (paymentIntent && !razorpayOrder) {
      try {
        await db
          .delete(paymentIntents)
          .where(eq(paymentIntents.id, paymentIntent.id));
        console.log(`🧹 Cleaned up payment_intent ${paymentIntent.id} due to error`);
      } catch (cleanupError) {
        console.error("Error cleaning up payment_intent:", cleanupError);
      }
    }

    // Extract error code and message from error or error.cause
    const errorCode = error.code || error.cause?.code;
    const errorMessage = error.message || error.cause?.message || '';

    // Check for unique constraint violation (slot locked by another customer)
    if (errorCode === '23505' || errorMessage.includes('unique constraint') || errorMessage.includes('duplicate key')) {
      return res.status(409).json({
        message: "Another customer is currently booking this slot. Please wait a moment and try again, or choose a different slot.",
        code: "SLOT_LOCKED",
        retryable: true,
      });
    }

    // Check for "already booked" error
    if (errorMessage.includes("already booked")) {
      return res.status(409).json({
        message: "This slot has already been booked. Please select a different time.",
        code: "SLOT_ALREADY_BOOKED",
      });
    }

    // Generic error response
    res.status(500).json({
      message: "Failed to create payment order. Please try again.",
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
    });
  }
};

/**
 * Verify payment after successful Razorpay transaction
 * POST /payment/verify
 *
 * NEW FLOW:
 * 1. Verify Razorpay signature
 * 2. Find payment_intent
 * 3. Create booking (status: PENDING - NOT confirmed)
 * 4. Create payment record (status: paid)
 * 5. Update payment_intent to completed
 * 6. All in a transaction for atomicity
 */
const verifyPayment = async (req, res) => {
  try {
    const userId = req.token.id;
    const { razorpayOrderId, razorpayPaymentId, signature, paymentIntentId } = req.body;

    // Validate required fields (signature is optional for v2 checkout)
    if (!razorpayOrderId || !razorpayPaymentId || !paymentIntentId) {
      return res.status(400).json({
        message: "Required fields: razorpayOrderId, razorpayPaymentId, paymentIntentId"
      });
    }

    console.log("🔍 Verifying payment:", {
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      hasSignature: !!signature,
      intentId: paymentIntentId,
    });

    // If signature is provided, verify it
    if (signature && signature.trim() !== "") {
      const isValidSignature = verifySignature(razorpayOrderId, razorpayPaymentId, signature);

      if (!isValidSignature) {
        // Update payment_intent as failed
        await db
          .update(paymentIntents)
          .set({
            status: "failed",
            failureReason: "Invalid payment signature",
          })
          .where(eq(paymentIntents.id, paymentIntentId));

        return res.status(400).json({ message: "Invalid payment signature" });
      }

      console.log("✅ Signature verified");
    } else {
      console.log("⚠️ No signature provided, fetching payment details from Razorpay...");

      // No signature - fetch payment from Razorpay to verify it exists and matches the order
      try {
        const { fetchPaymentDetails } = require("../utils/razorpay");
        const razorpayPayment = await fetchPaymentDetails(razorpayPaymentId);

        console.log("📦 Razorpay payment details:", {
          id: razorpayPayment.id,
          orderId: razorpayPayment.order_id,
          amount: razorpayPayment.amount,
          status: razorpayPayment.status,
          captured: razorpayPayment.captured,
        });

        // Verify payment belongs to the correct order
        if (razorpayPayment.order_id !== razorpayOrderId) {
          await db
            .update(paymentIntents)
            .set({
              status: "failed",
              failureReason: "Payment order mismatch",
            })
            .where(eq(paymentIntents.id, paymentIntentId));

          return res.status(400).json({ message: "Payment does not match the order" });
        }

        // Verify payment is captured/completed
        if (razorpayPayment.status !== "captured") {
          await db
            .update(paymentIntents)
            .set({
              status: "failed",
              failureReason: `Payment not captured. Status: ${razorpayPayment.status}`,
            })
            .where(eq(paymentIntents.id, paymentIntentId));

          return res.status(400).json({ message: `Payment not completed. Status: ${razorpayPayment.status}` });
        }

        console.log("✅ Payment verified via Razorpay API");
      } catch (razorpayError) {
        console.error("Error fetching payment from Razorpay:", razorpayError);

        // Update payment_intent as failed
        await db
          .update(paymentIntents)
          .set({
            status: "failed",
            failureReason: "Payment verification failed",
          })
          .where(eq(paymentIntents.id, paymentIntentId));

        return res.status(400).json({ message: "Could not verify payment with Razorpay. Please contact support." });
      }
    }

    // Fetch payment intent
    const [paymentIntent] = await db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, paymentIntentId));

    if (!paymentIntent) {
      return res.status(404).json({ message: "Payment intent not found" });
    }

    // Verify user owns this payment intent
    if (paymentIntent.userId !== userId) {
      return res.status(403).json({ message: "You are not authorized to verify this payment" });
    }

    // Check if payment intent is already completed
    if (paymentIntent.status === "completed") {
      // Fetch existing booking
      const [existingBooking] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, paymentIntent.bookingId))
        .limit(1);

      if (existingBooking) {
        return res.status(200).json({
          message: "Payment already verified",
          bookingId: existingBooking.id,
        });
      }
    }

    // Check if Razorpay order ID matches
    if (paymentIntent.razorpayOrderId !== razorpayOrderId) {
      return res.status(400).json({ message: "Razorpay order ID mismatch" });
    }

    // Check if payment intent has expired
    if (new Date() > new Date(paymentIntent.expiresAt) && paymentIntent.status === "pending") {
      await db
        .update(paymentIntents)
        .set({ status: "expired" })
        .where(eq(paymentIntents.id, paymentIntentId));

      return res.status(400).json({ message: "Payment session has expired. Please try again." });
    }

    // Get business profile ID from slot
    const [slot] = await db
      .select()
      .from(slots)
      .where(eq(slots.id, paymentIntent.slotId));

    if (!slot) {
      return res.status(404).json({ message: "Slot not found" });
    }

    // Use transaction for atomicity
    let createdBookingId = null;

    await db.transaction(async (tx) => {
      // CRITICAL: Check for existing booking for this slot+date BEFORE creating new one
      // This prevents race conditions when multiple users book the same slot simultaneously
      console.log(`🔒 Checking for existing bookings for slot ${paymentIntent.slotId} on ${paymentIntent.bookingDate}`);

      // Create date range for the selected date
      const bookingDate = paymentIntent.bookingDate;
      const startOfDay = new Date(bookingDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(bookingDate);
      endOfDay.setHours(23, 59, 59, 999);

      const [existingBooking] = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.slotId, paymentIntent.slotId),
            // Check if bookingDate falls within the selected date
            and(
              gte(bookings.bookingDate, startOfDay),
              lte(bookings.bookingDate, endOfDay)
            ),
            or(
              eq(bookings.status, "pending"),
              eq(bookings.status, "confirmed")
            )
          )
        )
        .limit(1);

      if (existingBooking) {
        console.log(`❌ Slot ${paymentIntent.slotId} already booked for ${paymentIntent.bookingDate}`);
        // Slot is already booked - cancel this payment
        throw new Error("This slot is no longer available. It was just booked by another customer.");
      }

      console.log(`✅ Slot ${paymentIntent.slotId} is available, proceeding with booking`);

      // Get business profile ID from slot
      const [slot] = await tx
        .select()
        .from(slots)
        .where(eq(slots.id, paymentIntent.slotId));

      if (!slot) {
        throw new Error("Slot not found");
      }

      // 1. Create booking record with status PENDING (NOT confirmed)
      const [newBooking] = await tx
        .insert(bookings)
        .values({
          customerId: userId,
          businessProfileId: slot.businessProfileId,
          serviceId: paymentIntent.serviceId,
          slotId: paymentIntent.slotId,
          addressId: paymentIntent.addressId,
          bookingDate: paymentIntent.bookingDate,
          totalPrice: paiseToRupees(paymentIntent.amount),
          status: "pending", // PENDING - provider will confirm
          paymentStatus: "paid",
        })
        .returning();

      // Store the booking ID
      createdBookingId = newBooking.id;

      // 2. Create payment record
      await tx
        .insert(payments)
        .values({
          bookingId: newBooking.id,
          userId: userId,
          razorpayOrderId: razorpayOrderId,
          razorpayPaymentId: razorpayPaymentId,
          razorpaySignature: signature,
          amount: paymentIntent.amount,
          currency: "INR",
          status: "paid",
          paymentMethod: "razorpay",
          completedAt: new Date(),
        });

      // 3. Update payment_intent to completed
      await tx
        .update(paymentIntents)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(paymentIntents.id, paymentIntentId));
    });

    res.status(200).json({
      message: "Payment verified successfully! Your booking is pending confirmation from the service provider.",
      bookingId: createdBookingId,
    });
  } catch (error) {
    console.error("Error verifying payment:", error);

    // Check if this is a "slot already booked" error
    const isSlotBookedError = error.message && error.message.includes("no longer available");

    // Update payment_intent as failed
    const { paymentIntentId, razorpayPaymentId } = req.body;
    if (paymentIntentId) {
      try {
        await db
          .update(paymentIntents)
          .set({
            status: "failed",
            failureReason: error.message,
          })
          .where(eq(paymentIntents.id, paymentIntentId));

        // If slot was booked by someone else, initiate refund
        if (isSlotBookedError && razorpayPaymentId) {
          console.log("💰 Initiating refund for double-booked slot");
          // TODO: Initiate Razorpay refund here
          // const razorpay = require('../utils/razorpay');
          // await razorpay.initiateRefund(razorpayPaymentId, "Slot already booked by another customer");
        }
      } catch (updateError) {
        console.error("Error updating payment_intent as failed:", updateError);
      }
    }

    // Return appropriate error message
    if (isSlotBookedError) {
      return res.status(409).json({ // 409 = Conflict
        message: "This slot is no longer available. It was just booked by another customer. Your payment will be refunded automatically.",
        errorCode: "SLOT_ALREADY_BOOKED",
        requiresRefund: true
      });
    }

    res.status(500).json({
      message: "Failed to verify payment. Please contact support if amount was deducted.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * Record failed payment attempt
 * POST /payment/failed
 *
 * Called when payment fails in Razorpay checkout
 */
const recordFailedPayment = async (req, res) => {
  try {
    const userId = req.token.id;
    const { paymentIntentId, errorCode, errorDescription } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ message: "Payment intent ID is required" });
    }

    // Fetch payment intent
    const [paymentIntent] = await db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, paymentIntentId));

    if (!paymentIntent) {
      return res.status(404).json({ message: "Payment intent not found" });
    }

    // Verify user owns this payment intent
    if (paymentIntent.userId !== userId) {
      return res.status(403).json({ message: "You are not authorized to update this payment intent" });
    }

    // Update payment_intent as failed
    await db
      .update(paymentIntents)
      .set({
        status: "failed",
        failureReason: errorDescription || errorCode || "Payment failed",
      })
      .where(eq(paymentIntents.id, paymentIntentId));

    res.status(200).json({
      message: "Payment failure recorded",
    });
  } catch (error) {
    console.error("Error recording failed payment:", error);
    res.status(500).json({
      message: "Failed to record payment failure",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * Get payment details by booking ID
 * GET /payment/booking/:id
 */
const getPaymentByBookingId = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    // Fetch booking
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Check if user is either customer or provider
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking.businessProfileId))
      .limit(1);

    if (booking.customerId !== userId && (!business || business.providerId !== userId)) {
      return res.status(403).json({ message: "You are not authorized to view this payment" });
    }

    // Fetch payment
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId));

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.status(200).json({ payment });
  } catch (error) {
    console.error("Error fetching payment:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get payment by ID
 * GET /payment/:id
 */
const getPaymentById = async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    const userId = req.token.id;

    if (!paymentId) {
      return res.status(400).json({ message: "Payment ID is required" });
    }

    // Fetch payment
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId));

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    // Check if user owns this payment or is admin/provider
    if (payment.userId !== userId && req.token.roleId !== 3) {
      // If not owner or admin, check if user is provider for this booking
      const [booking] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, payment.bookingId))
        .limit(1);

      const [business] = await db
        .select()
        .from(businessProfiles)
        .where(eq(businessProfiles.id, booking.businessProfileId))
        .limit(1);

      if (!business || business.providerId !== userId) {
        return res.status(403).json({ message: "You are not authorized to view this payment" });
      }
    }

    res.status(200).json({ payment });
  } catch (error) {
    console.error("Error fetching payment:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Process refund for a payment
 * POST /payment/refund/:id
 *
 * Only admin can process refunds manually
 * Auto-refund happens when provider cancels a booking
 */
const processRefund = async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    const userId = req.token.id;
    const { reason } = req.body;

    if (!paymentId) {
      return res.status(400).json({ message: "Payment ID is required" });
    }

    // Only admin can process manual refunds
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Only admins can process refunds" });
    }

    // Fetch payment
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId));

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    // Check if payment is already refunded
    if (payment.status === "refunded") {
      return res.status(400).json({ message: "Payment already refunded" });
    }

    // Check if payment is paid
    if (payment.status !== "paid") {
      return res.status(400).json({ message: "Can only refund paid payments" });
    }

    // Check if Razorpay payment ID exists
    if (!payment.razorpayPaymentId) {
      return res.status(400).json({ message: "Razorpay payment ID not found" });
    }

    // Initiate refund via Razorpay
    const refund = await initiateRefund(
      payment.razorpayPaymentId,
      payment.amount, // Full refund
      { reason: reason || "Manual refund", userId: userId.toString() }
    );

    // Update payment record
    const [updatedPayment] = await db
      .update(payments)
      .set({
        status: "refunded",
        refundId: refund.id,
        refundAmount: refund.amount,
        refundReason: reason || "Manual refund",
        refundedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning();

    // Update booking status
    await db
      .update(bookings)
      .set({ status: "refunded" })
      .where(eq(bookings.id, payment.bookingId));

    res.status(200).json({
      message: "Refund processed successfully",
      refundId: refund.id,
      refundAmount: paiseToRupees(refund.amount),
      payment: updatedPayment,
    });
  } catch (error) {
    console.error("Error processing refund:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Handle Razorpay webhook events
 * POST /payment/webhook
 *
 * Events handled:
 * - payment.captured: Payment successful
 * - payment.failed: Payment failed
 * - refund.processed: Refund completed
 */
const handleWebhook = async (req, res) => {
  try {
    const webhookSignature = req.headers["x-razorpay-signature"];
    const body = req.body;

    // Verify webhook signature
    if (!webhookSignature) {
      return res.status(400).json({ message: "Webhook signature missing" });
    }

    // Note: We need raw body for signature verification
    // For now, process without verification (TODO: Implement proper verification)

    const event = body.event;
    const payload = body.payload;

    console.log("Webhook event received:", event);

    // Handle different events
    switch (event) {
      case "payment.captured":
        await handlePaymentCaptured(payload.payment.entity);
        break;

      case "payment.failed":
        await handlePaymentFailed(payload.payment.entity);
        break;

      case "refund.processed":
        await handleRefundProcessed(payload.refund.entity);
        break;

      default:
        console.log("Unhandled webhook event:", event);
    }

    // Always return 200 OK to Razorpay
    res.status(200).json({ message: "Webhook processed" });
  } catch (error) {
    console.error("Error handling webhook:", error);
    res.status(200).json({ message: "Webhook received" });
  }
};

/**
 * Handle payment.captured event
 * Creates booking if not already created (fallback for verification)
 */
const handlePaymentCaptured = async (paymentEntity) => {
  try {
    const { order_id, id, amount } = paymentEntity;

    // Find payment intent by Razorpay order ID
    const [paymentIntent] = await db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.razorpayOrderId, order_id));

    if (!paymentIntent) {
      console.log("Payment intent not found for order:", order_id);
      return;
    }

    // If already completed, skip (idempotent)
    if (paymentIntent.status === "completed") {
      console.log("Payment already processed:", paymentIntent.id);
      return;
    }

    // Check if booking already exists for this payment
    const [existingPayment] = await db
      .select()
      .from(payments)
      .where(eq(payments.razorpayOrderId, order_id))
      .limit(1);

    if (existingPayment) {
      console.log("Payment already recorded:", existingPayment.id);
      return;
    }

    // Use transaction to create booking and payment
    await db.transaction(async (tx) => {
      // Get business profile ID from slot
      const [slot] = await tx
        .select()
        .from(slots)
        .where(eq(slots.id, paymentIntent.slotId));

      if (!slot) {
        throw new Error("Slot not found");
      }

      // Create booking
      const [newBooking] = await tx
        .insert(bookings)
        .values({
          customerId: paymentIntent.userId,
          businessProfileId: slot.businessProfileId,
          serviceId: paymentIntent.serviceId,
          slotId: paymentIntent.slotId,
          addressId: paymentIntent.addressId,
          bookingDate: paymentIntent.bookingDate,
          totalPrice: paiseToRupees(paymentIntent.amount),
          status: "pending", // PENDING - provider will confirm
          paymentStatus: "paid",
        })
        .returning();

      // Create payment record
      await tx
        .insert(payments)
        .values({
          bookingId: newBooking.id,
          userId: paymentIntent.userId,
          razorpayOrderId: order_id,
          razorpayPaymentId: id,
          amount: paymentIntent.amount,
          currency: "INR",
          status: "paid",
          paymentMethod: "razorpay",
          completedAt: new Date(),
        });

      // Update payment intent
      await tx
        .update(paymentIntents)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(paymentIntents.id, paymentIntent.id));
    });

    console.log("Payment captured successfully via webhook:", paymentIntent.id);
  } catch (error) {
    console.error("Error handling payment.captured:", error);
  }
};

/**
 * Handle payment.failed event
 */
const handlePaymentFailed = async (paymentEntity) => {
  try {
    const { order_id, error_description, error_code } = paymentEntity;

    // Find payment intent by Razorpay order ID
    const [paymentIntent] = await db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.razorpayOrderId, order_id));

    if (!paymentIntent) {
      console.log("Payment intent not found for order:", order_id);
      return;
    }

    // Update payment intent as failed
    await db
      .update(paymentIntents)
      .set({
        status: "failed",
        failureReason: error_description || "Payment failed",
      })
      .where(eq(paymentIntents.id, paymentIntent.id));

    console.log("Payment failed recorded:", paymentIntent.id, error_code);
  } catch (error) {
    console.error("Error handling payment.failed:", error);
  }
};

/**
 * Handle refund.processed event
 */
const handleRefundProcessed = async (refundEntity) => {
  try {
    const { payment_id, id, amount } = refundEntity;

    // Find payment by Razorpay payment ID
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.razorpayPaymentId, payment_id));

    if (!payment) {
      console.log("Payment not found for refund:", payment_id);
      return;
    }

    // Update payment record
    await db
      .update(payments)
      .set({
        status: "refunded",
        refundId: id,
        refundAmount: amount,
        refundedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    // Update booking record
    await db
      .update(bookings)
      .set({ status: "refunded" })
      .where(eq(bookings.id, payment.bookingId));

    console.log("Refund processed:", payment.id);
  } catch (error) {
    console.error("Error handling refund.processed:", error);
  }
};

/**
 * Cancel payment intent (releases slot lock)
 * POST /api/payment/cancel-intent
 *
 * Called when user closes payment modal without completing payment
 * This releases the slot lock immediately, allowing other customers to book
 */
const cancelPaymentIntent = async (req, res) => {
  try {
    const userId = req.token.id;
    const { paymentIntentId } = req.body;

    console.log(`🔓 Request to cancel payment intent ${paymentIntentId} by user ${userId}`);

    if (!paymentIntentId) {
      return res.status(400).json({ message: "paymentIntentId is required" });
    }

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

    if (updated) {
      console.log(`✅ Cancelled payment intent ${paymentIntentId} (slot lock released)`);
      return res.status(200).json({
        message: "Slot lock released successfully",
        released: true,
      });
    } else {
      console.log(`⚠️ Payment intent ${paymentIntentId} not found or not cancellable`);
      return res.status(200).json({
        message: "Payment intent not found or already completed",
        released: false,
      });
    }
  } catch (error) {
    console.error("❌ Error cancelling payment intent:", error);
    res.status(500).json({
      message: "Failed to cancel payment intent",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * DEBUG ENDPOINT: Check slot lock status
 * GET /payment/slot-lock-status?slotId=<slotId>&bookingDate=<date>
 *
 * This is a diagnostic endpoint to check if a slot is currently locked
 */
const getSlotLockStatus = async (req, res) => {
  try {
    const { slotId, bookingDate } = req.query;

    if (!slotId || !bookingDate) {
      return res.status(400).json({
        message: "slotId and bookingDate are required"
      });
    }

    console.log(`🔍 [DEBUG] Checking slot lock status for slot ${slotId} on ${bookingDate}`);

    // Check for pending payment intents
    const pendingIntents = await db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.slotId, parseInt(slotId)),
          eq(paymentIntents.status, "pending")
        )
      );

    // Check for confirmed bookings
    const bookingDateObj = new Date(bookingDate);
    const startOfDay = new Date(bookingDateObj);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDateObj);
    endOfDay.setHours(23, 59, 59, 999);

    const confirmedBookings = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.slotId, parseInt(slotId)),
          gte(bookings.bookingDate, startOfDay),
          lte(bookings.bookingDate, endOfDay),
          or(
            eq(bookings.status, "pending"),
            eq(bookings.status, "payment_pending"),
            eq(bookings.status, "confirmed")
          )
        )
      );

    res.status(200).json({
      slotId: parseInt(slotId),
      bookingDate: bookingDate,
      locked: pendingIntents.length > 0 || confirmedBookings.length > 0,
      pendingIntents: {
        count: pendingIntents.length,
        details: pendingIntents.map(intent => ({
          intentId: intent.id,
          userId: intent.userId,
          status: intent.status,
          createdAt: intent.createdAt,
          expiresAt: intent.expiresAt,
          isExpired: new Date(intent.expiresAt) < new Date()
        }))
      },
      confirmedBookings: {
        count: confirmedBookings.length,
        details: confirmedBookings.map(booking => ({
          bookingId: booking.id,
          userId: booking.userId,
          status: booking.status,
          bookingDate: booking.bookingDate
        }))
      },
      recommendation: pendingIntents.length > 0
        ? "Slot is currently locked by another customer"
        : confirmedBookings.length > 0
        ? "Slot is already booked"
        : "Slot is available"
    });
  } catch (error) {
    console.error("❌ [DEBUG] Error checking slot lock status:", error);
    res.status(500).json({
      message: "Failed to check slot lock status",
      error: error.message
    });
  }
};

/**
 * Validate payment intent before opening Razorpay
 * POST /payment/validate-intent
 *
 * CRITICAL: This prevents users from opening Razorpay if:
 * 1. Payment intent has expired
 * 2. Payment intent was cancelled
 * 3. Payment intent was already completed
 * 4. Slot has been booked by someone else
 */
const validatePaymentIntent = async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    const userId = req.token.id;

    if (!paymentIntentId) {
      return res.status(400).json({
        message: "paymentIntentId is required"
      });
    }

    console.log(`🔍 [VALIDATE] Checking payment intent ${paymentIntentId} for user ${userId}`);

    // Get payment intent
    const [paymentIntent] = await db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, paymentIntentId))
      .limit(1);

    if (!paymentIntent) {
      console.log(`❌ [VALIDATE] Payment intent ${paymentIntentId} not found`);
      return res.status(404).json({
        valid: false,
        message: "Payment session not found. It may have been cancelled.",
        code: "INTENT_NOT_FOUND"
      });
    }

    // Verify ownership
    if (paymentIntent.userId !== userId) {
      console.log(`❌ [VALIDATE] User ${userId} doesn't own intent ${paymentIntentId} (owned by ${paymentIntent.userId})`);
      return res.status(403).json({
        valid: false,
        message: "You don't have permission to access this payment session.",
        code: "NOT_AUTHORIZED"
      });
    }

    // Check status
    if (paymentIntent.status !== "pending") {
      console.log(`❌ [VALIDATE] Payment intent ${paymentIntentId} has status: ${paymentIntent.status}`);

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
        code: paymentIntent.status.toUpperCase() // CANCELLED, EXPIRED, COMPLETED, FAILED
      });
    }

    // Check if expired
    if (new Date() > new Date(paymentIntent.expiresAt)) {
      console.log(`❌ [VALIDATE] Payment intent ${paymentIntentId} expired at ${paymentIntent.expiresAt}`);

      // Mark as expired
      await db
        .update(paymentIntents)
        .set({ status: "expired" })
        .where(eq(paymentIntents.id, paymentIntentId));

      return res.status(400).json({
        valid: false,
        message: "Payment session has expired. Please try again.",
        code: "EXPIRED"
      });
    }

    // CRITICAL: Check if slot has been booked by someone else
    const bookingDate = paymentIntent.bookingDate;
    const startOfDay = new Date(bookingDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDate);
    endOfDay.setHours(23, 59, 59, 999);

    const [existingBooking] = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.slotId, paymentIntent.slotId),
          gte(bookings.bookingDate, startOfDay),
          lte(bookings.bookingDate, endOfDay),
          or(
            eq(bookings.status, "pending"),
            eq(bookings.status, "payment_pending"),
            eq(bookings.status, "confirmed")
          )
        )
      )
      .limit(1);

    if (existingBooking) {
      console.log(`❌ [VALIDATE] Slot ${paymentIntent.slotId} already booked by booking ${existingBooking.id}`);

      // Cancel this payment intent
      await db
        .update(paymentIntents)
        .set({ status: "failed", failureReason: "Slot already booked by another customer" })
        .where(eq(paymentIntents.id, paymentIntentId));

      return res.status(409).json({
        valid: false,
        message: "This slot has been booked by another customer. Please select a different time.",
        code: "SLOT_ALREADY_BOOKED"
      });
    }

    // CRITICAL: Check if another payment intent exists for the same slot+date+service
    const [otherPendingIntent] = await db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.slotId, paymentIntent.slotId),
          eq(paymentIntents.serviceId, paymentIntent.serviceId), // ✅ Add serviceId check
          eq(paymentIntents.status, "pending"),
          // Different intent ID
          sql`${paymentIntents.id} != ${paymentIntentId}`
        )
      )
      .limit(1);

    if (otherPendingIntent) {
      const otherDate = new Date(otherPendingIntent.bookingDate).toISOString().split('T')[0];
      const thisDate = new Date(paymentIntent.bookingDate).toISOString().split('T')[0];

      if (otherDate === thisDate) {
        console.log(`❌ [VALIDATE] Another payment intent ${otherPendingIntent.id} exists for Service ${paymentIntent.serviceId}, slot ${paymentIntent.slotId} on ${thisDate}`);

        return res.status(409).json({
          valid: false,
          message: "Another customer is currently booking this slot. Please wait a moment or choose a different slot.",
          code: "SLOT_LOCKED",
          retryable: true
        });
      }
    }

    // All checks passed!
    const timeRemaining = Math.max(0, Math.floor((new Date(paymentIntent.expiresAt).getTime() - Date.now()) / 1000));

    console.log(`✅ [VALIDATE] Payment intent ${paymentIntentId} is valid (${timeRemaining}s remaining)`);

    res.status(200).json({
      valid: true,
      message: "Payment session is valid",
      data: {
        paymentIntentId: paymentIntent.id,
        slotId: paymentIntent.slotId,
        amount: paymentIntent.amount,
        razorpayOrderId: paymentIntent.razorpayOrderId,
        expiresAt: paymentIntent.expiresAt,
        timeRemaining: timeRemaining
      }
    });
  } catch (error) {
    console.error("❌ [VALIDATE] Error validating payment intent:", error);
    res.status(500).json({
      valid: false,
      message: "Failed to validate payment session",
      error: error.message
    });
  }
};

module.exports = {
  createPaymentOrder,
  verifyPayment,
  recordFailedPayment,
  cancelPaymentIntent,
  getPaymentByBookingId,
  getPaymentById,
  processRefund,
  handleWebhook,
  getSlotLockStatus, // DEBUG endpoint
  validatePaymentIntent, // CRITICAL for preventing duplicate Razorpay opens
};
