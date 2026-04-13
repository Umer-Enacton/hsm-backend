/**
 * CENTRALIZED WEBHOOK CONTROLLER
 * Handles ALL Razorpay webhook events
 *
 * Events handled:
 * - Booking payments: payment.captured, payment.failed, refund.processed
 * - Subscriptions: subscription.authorized, subscription.activated, subscription.charged,
 *                 subscription.completed, subscription.cancelled, subscription.paused, subscription.resumed
 */

const db = require("../config/db");
const {
  users,
  businessProfiles,
  bookings,
  payments,
  paymentIntents,
  slots,
  providerSubscriptions,
  subscriptionPayments,
  subscriptionPlans,
} = require("../models/schema");
const {
  eq,
  and,
  or,
  sql,
  lt,
  inArray,
  desc,
} = require("drizzle-orm");
const { verifyWebhookSignature } = require("../utils/razorpay");
const { paiseToRupees } = require("../utils/razorpay");
const { logBookingHistory } = require("../utils/historyHelper");
const { getProviderActiveSubscription } = require("./providerSubscription.controller");
const { notificationTemplates } = require("../utils/notificationHelper");

// ============================================
// MAIN WEBHOOK HANDLER
// ============================================

/**
 * Main webhook entry point
 * Verifies signature and routes events to appropriate handlers
 * POST /webhook/razorpay
 */
const handleWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];

    // IMPORTANT: Use raw body for signature verification
    // The raw body is captured by middleware in webhook.route.js
    // Razorpay signs the exact raw JSON string, so we must use that
    const body = req.rawBody || JSON.stringify(req.body);

    // Debug logging (remove in production if needed)
    console.log("🔍 Webhook signature verification:", {
      hasSignature: !!signature,
      signatureLength: signature?.length,
      bodyLength: body?.length,
      bodyStart: body?.substring(0, 100),
    });

    // 1. Verify webhook signature (CRITICAL for security)
    const isValid = verifyWebhookSignature(body, signature);
    if (!isValid) {
      console.error("❌ Invalid webhook signature");
      return res.status(400).json({ message: "Invalid signature" });
    }

    const event = req.body;
    const eventType = event.event;

    console.log("🔔 Razorpay Webhook received:", eventType);

    // 2. Route to appropriate handler
    switch (eventType) {
      // Booking Payment Events
      case "payment.captured":
        await handleBookingPaymentCaptured(event);
        break;

      case "payment.failed":
        await handleBookingPaymentFailed(event);
        break;

      case "refund.processed":
        await handleRefundProcessed(event);
        break;

      // Subscription Lifecycle Events
      case "subscription.authorized":
        await handleSubscriptionAuthorized(event);
        break;

      case "subscription.activated":
        await handleSubscriptionActivated(event);
        break;

      case "subscription.charged":
        await handleSubscriptionCharged(event);
        break;

      case "subscription.completed":
        await handleSubscriptionCompleted(event);
        break;

      case "subscription.cancelled":
        await handleSubscriptionCancelled(event);
        break;

      case "subscription.paused":
        await handleSubscriptionPaused(event);
        break;

      case "subscription.resumed":
        await handleSubscriptionResumed(event);
        break;

      default:
        console.log(`ℹ️  Unhandled webhook event: ${eventType}`);
    }

    // Always return 200 OK to Razorpay (prevent retries)
    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("Error handling webhook:", error);
    // Still return 200 to prevent Razorpad from retrying
    res.status(200).json({ status: "received" });
  }
};

// ============================================
// BOOKING PAYMENT EVENT HANDLERS
// ============================================

/**
 * Handle payment.captured event for booking payments
 * Creates booking and payment record
 */
const handleBookingPaymentCaptured = async (event) => {
  try {
    const paymentEntity = event.payload?.payment?.entity || event.payload;
    if (!paymentEntity) {
      console.error("❌ No payment entity in payment.captured event");
      return;
    }

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

    // Store booking ID outside transaction scope for notification
    let createdBookingId = null;

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
          status: "confirmed",
          paymentStatus: "paid",
        })
        .returning();

      // Store booking ID for use after transaction
      createdBookingId = newBooking.id;

      // Log booking history
      await logBookingHistory(
        newBooking.id,
        "booked",
        "Booking Created",
        "customer",
        paymentIntent.userId,
        null,
        tx
      );

      // Get provider's subscription to determine platform fee percentage
      let platformFeePercentage = 5; // Default
      try {
        const [businessProfile] = await tx
          .select()
          .from(businessProfiles)
          .where(eq(businessProfiles.id, slot.businessProfileId))
          .limit(1);

        if (businessProfile) {
          const providerSubscription = await getProviderActiveSubscription(
            businessProfile.providerId
          );
          if (
            providerSubscription &&
            providerSubscription.planPlatformFeePercentage !== undefined
          ) {
            platformFeePercentage =
              providerSubscription.planPlatformFeePercentage;
          }
        }
      } catch (error) {
        console.error(
          "Error fetching provider subscription for platform fee:",
          error
        );
      }

      const platformFee = Math.round(
        paymentIntent.amount * (platformFeePercentage / 100)
      );
      const providerShare = paymentIntent.amount - platformFee;

      // Create payment record
      await tx
        .insert(payments)
        .values({
          bookingId: newBooking.id,
          userId: paymentIntent.userId,
          razorpayOrderId: order_id,
          razorpayPaymentId: id,
          amount: paymentIntent.amount,
          platformFee: platformFee,
          providerShare: providerShare,
          currency: "INR",
          status: "paid",
          paymentMethod: "razorpay",
          completedAt: new Date(),
        });

      // Update booking with provider earning and platform fee
      await tx
        .update(bookings)
        .set({
          providerEarning: providerShare,
          platformFee: platformFee,
        })
        .where(eq(bookings.id, newBooking.id));

      // Update payment intent
      await tx
        .update(paymentIntents)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(paymentIntents.id, paymentIntent.id));
    });

    console.log("✅ Payment captured successfully:", paymentIntent.id);

    // Send notification to provider
    try {
      await notificationTemplates.bookingCreated(createdBookingId);
    } catch (notifError) {
      console.error("❌ Failed to send notification:", notifError);
    }
  } catch (error) {
    console.error("Error handling payment.captured:", error);
  }
};

/**
 * Handle payment.failed event for booking payments
 * Updates payment intent to failed
 */
const handleBookingPaymentFailed = async (event) => {
  try {
    const paymentEntity = event.payload?.payment?.entity || event.payload;
    if (!paymentEntity) {
      console.error("❌ No payment entity in payment.failed event");
      return;
    }

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

    console.log("✅ Payment failed recorded:", paymentIntent.id, error_code);
  } catch (error) {
    console.error("Error handling payment.failed:", error);
  }
};

/**
 * Handle refund.processed event
 * Updates payment and booking to refunded
 */
const handleRefundProcessed = async (event) => {
  try {
    const refundEntity = event.payload?.refund?.entity;
    if (!refundEntity) {
      console.error("❌ No refund entity in refund.processed event");
      return;
    }

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

    console.log("✅ Refund processed:", payment.id);
  } catch (error) {
    console.error("Error handling refund.processed:", error);
  }
};

// ============================================
// SUBSCRIPTION LIFECYCLE EVENT HANDLERS
// ============================================

/**
 * Helper: Check if payment already recorded in subscription_payments
 */
async function subscriptionPaymentExists(paymentId) {
  const [existing] = await db
    .select()
    .from(subscriptionPayments)
    .where(eq(subscriptionPayments.razorpayPaymentId, paymentId))
    .limit(1);
  return !!existing;
}

/**
 * Handle subscription.authorized event
 * Customer has authorized the mandate (auto-debit)
 */
const handleSubscriptionAuthorized = async (event) => {
  try {
    const subscriptionEntity = event.payload?.subscription?.entity;
    if (!subscriptionEntity) {
      console.log("ℹ️  No subscription entity in webhook");
      return;
    }

    const razorpaySubscriptionId = subscriptionEntity.id;
    const customerId = subscriptionEntity.customer_id;
    const notes = subscriptionEntity.notes || {};

    console.log("✅ Subscription authorized:", razorpaySubscriptionId);

    // Find local subscription by Razorpay subscription ID or notes
    let localSub;
    if (notes.local_subscription_id) {
      [localSub] = await db
        .select()
        .from(providerSubscriptions)
        .where(
          eq(providerSubscriptions.id, parseInt(notes.local_subscription_id))
        )
        .limit(1);
    } else {
      [localSub] = await db
        .select()
        .from(providerSubscriptions)
        .where(
          eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubscriptionId)
        )
        .limit(1);
    }

    if (localSub) {
      const updateData = {
        status: "active",
        updatedAt: new Date(),
      };

      if (customerId) {
        updateData.razorpayCustomerId = customerId;
      }

      await db
        .update(providerSubscriptions)
        .set(updateData)
        .where(eq(providerSubscriptions.id, localSub.id));

      console.log("✅ Local subscription activated:", localSub.id);
    }
  } catch (error) {
    console.error("Error handling subscription.authorized:", error);
  }
};

/**
 * Handle subscription.activated event
 * NEW: Fires when subscription becomes active after authorization
 */
const handleSubscriptionActivated = async (event) => {
  try {
    const subscriptionEntity = event.payload?.subscription?.entity;
    if (!subscriptionEntity) {
      console.log("ℹ️  No subscription entity in webhook");
      return;
    }

    const razorpaySubscriptionId = subscriptionEntity.id;
    const notes = subscriptionEntity.notes || {};

    console.log("✅ Subscription activated:", razorpaySubscriptionId);

    // Find local subscription
    const localSubscriptionId = notes.local_subscription_id
      ? parseInt(notes.local_subscription_id)
      : null;

    let activatedSubscription = null;
    let providerId = null;

    if (localSubscriptionId) {
      const [updated] = await db
        .select()
        .from(providerSubscriptions)
        .where(eq(providerSubscriptions.id, localSubscriptionId))
        .limit(1);

      await db
        .update(providerSubscriptions)
        .set({
          status: "active",
          razorpaySubscriptionId: razorpaySubscriptionId,
          updatedAt: new Date(),
        })
        .where(eq(providerSubscriptions.id, localSubscriptionId));

      console.log("✅ Local subscription activated:", localSubscriptionId);
      activatedSubscription = updated;
    } else {
      // Try to find by Razorpay subscription ID
      const [localSub] = await db
        .select()
        .from(providerSubscriptions)
        .where(
          eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubscriptionId)
        )
        .limit(1);

      if (localSub) {
        await db
          .update(providerSubscriptions)
          .set({
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(providerSubscriptions.id, localSub.id));

        console.log("✅ Local subscription activated:", localSub.id);
        activatedSubscription = localSub;
      }
    }

    // IMPORTANT: After activating new subscription, expire any other active subscriptions for this provider
    // This prevents multiple active subscriptions and should only happen AFTER payment is successful
    if (activatedSubscription) {
      providerId = activatedSubscription.providerId;

      // Find other active subscriptions for this provider (excluding the newly activated one)
      const [otherActiveSubs] = await db
        .select()
        .from(providerSubscriptions)
        .where(
          and(
            eq(providerSubscriptions.providerId, providerId),
            eq(providerSubscriptions.status, "active"),
            // Exclude the newly activated subscription
            sql`${providerSubscriptions.id} != ${activatedSubscription.id}`
          )
        )
        .orderBy(desc(providerSubscriptions.createdAt))
        .limit(1);

      if (otherActiveSubs) {
        console.log("⚠️  Expiring old active subscription:", otherActiveSubs.id, "after new subscription activated");

        await db
          .update(providerSubscriptions)
          .set({
            status: "expired",
            updatedAt: new Date(),
            cancelAtPeriodEnd: true,
          })
          .where(eq(providerSubscriptions.id, otherActiveSubs.id));

        console.log("✅ Old subscription marked as expired:", otherActiveSubs.id);
      }
    }
  } catch (error) {
    console.error("Error handling subscription.activated:", error);
  }
};

/**
 * Handle subscription.charged event
 * Recurring payment successful
 */
const handleSubscriptionCharged = async (event) => {
  try {
    const subscriptionEntity = event.payload?.subscription?.entity;
    const payment = event.payload?.payment?.entity;

    if (!subscriptionEntity) {
      console.log("ℹ️  No subscription entity in webhook");
      return;
    }

    const razorpaySubscriptionId = subscriptionEntity.id;

    console.log("💰 Subscription charged:", razorpaySubscriptionId);

    const [localSub] = await db
      .select()
      .from(providerSubscriptions)
      .where(
        eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubscriptionId)
      )
      .limit(1);

    if (localSub && payment) {
      // Check if payment already recorded
      const paymentExists = await subscriptionPaymentExists(payment.id);
      if (paymentExists) {
        console.log("⚠️  Payment already recorded, skipping:", payment.id);
        return;
      }

      // Record payment
      await db.insert(subscriptionPayments).values({
        providerSubscriptionId: localSub.id,
        razorpayPaymentId: payment.id,
        amount: payment.amount,
        status: "captured",
        paymentDate: new Date(),
      });

      // Update total amount paid
      await db
        .update(providerSubscriptions)
        .set({
          amountPaid: sql`${providerSubscriptions.amountPaid} + ${payment.amount}`,
          updatedAt: new Date(),
        })
        .where(eq(providerSubscriptions.id, localSub.id));

      console.log("✅ Recurring payment recorded:", payment.id);
    }
  } catch (error) {
    console.error("Error handling subscription.charged:", error);
  }
};

/**
 * Handle subscription.completed event
 * All payments completed (subscription ended naturally)
 */
const handleSubscriptionCompleted = async (event) => {
  try {
    const subscriptionEntity = event.payload?.subscription?.entity;
    if (!subscriptionEntity) {
      console.log("ℹ️  No subscription entity in webhook");
      return;
    }

    const razorpaySubscriptionId = subscriptionEntity.id;

    console.log("🏁 Subscription completed:", razorpaySubscriptionId);

    await db
      .update(providerSubscriptions)
      .set({ status: "completed", autoRenew: false, updatedAt: new Date() })
      .where(
        eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubscriptionId)
      );

    console.log("✅ Subscription marked as completed");
  } catch (error) {
    console.error("Error handling subscription.completed:", error);
  }
};

/**
 * Handle subscription.cancelled event
 */
const handleSubscriptionCancelled = async (event) => {
  try {
    const subscriptionEntity = event.payload?.subscription?.entity;
    if (!subscriptionEntity) {
      console.log("ℹ️  No subscription entity in webhook");
      return;
    }

    const razorpaySubscriptionId = subscriptionEntity.id;

    console.log("❌ Subscription cancelled:", razorpaySubscriptionId);

    await db
      .update(providerSubscriptions)
      .set({ status: "cancelled", autoRenew: false, updatedAt: new Date() })
      .where(
        eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubscriptionId)
      );

    console.log("✅ Subscription marked as cancelled");
  } catch (error) {
    console.error("Error handling subscription.cancelled:", error);
  }
};

/**
 * Handle subscription.paused event
 */
const handleSubscriptionPaused = async (event) => {
  try {
    const subscriptionEntity = event.payload?.subscription?.entity;
    if (!subscriptionEntity) {
      console.log("ℹ️  No subscription entity in webhook");
      return;
    }

    const razorpaySubscriptionId = subscriptionEntity.id;

    console.log("⏸️  Subscription paused:", razorpaySubscriptionId);

    await db
      .update(providerSubscriptions)
      .set({ status: "cancelled", autoRenew: false, updatedAt: new Date() })
      .where(
        eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubscriptionId)
      );

    console.log("✅ Subscription marked as paused/cancelled");
  } catch (error) {
    console.error("Error handling subscription.paused:", error);
  }
};

/**
 * Handle subscription.resumed event
 */
const handleSubscriptionResumed = async (event) => {
  try {
    const subscriptionEntity = event.payload?.subscription?.entity;
    if (!subscriptionEntity) {
      console.log("ℹ️  No subscription entity in webhook");
      return;
    }

    const razorpaySubscriptionId = subscriptionEntity.id;

    console.log("▶️  Subscription resumed:", razorpaySubscriptionId);

    await db
      .update(providerSubscriptions)
      .set({ status: "active", autoRenew: true, updatedAt: new Date() })
      .where(
        eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubscriptionId)
      );

    console.log("✅ Subscription resumed");
  } catch (error) {
    console.error("Error handling subscription.resumed:", error);
  }
};

module.exports = {
  handleWebhook,
  // Booking payment handlers
  handleBookingPaymentCaptured,
  handleBookingPaymentFailed,
  handleRefundProcessed,
  // Subscription handlers
  handleSubscriptionAuthorized,
  handleSubscriptionActivated,
  handleSubscriptionCharged,
  handleSubscriptionCompleted,
  handleSubscriptionCancelled,
  handleSubscriptionPaused,
  handleSubscriptionResumed,
};
