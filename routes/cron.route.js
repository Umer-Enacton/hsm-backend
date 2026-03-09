const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { bookings, payments, services, users, slots } = require("../models/schema");
const { eq, and, lt, sql } = require("drizzle-orm");
const { initiateRefund } = require("../utils/razorpay");

// Secret key for cron job authentication
const CRON_SECRET = process.env.CRON_SECRET || "default-cron-secret-change-in-production";

// Middleware to verify cron secret
const verifyCronSecret = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedAuth = `Bearer ${CRON_SECRET}`;

  if (authHeader !== expectedAuth) {
    return res.status(401).json({ message: "Unauthorized: Invalid cron secret" });
  }

  next();
};

/**
 * POST /cron/auto-reject-bookings
 * Internal endpoint for cron jobs to process expired bookings
 * Protected by CRON_SECRET
 */
router.post("/auto-reject-bookings", verifyCronSecret, async (req, res) => {
  console.log("Cron job: Processing expired bookings...");

  try {
    // Get pending bookings where scheduled time has passed
    const expiredBookings = await db
      .select({
        bookingId: bookings.id,
        customerId: bookings.customerId,
        bookingDate: bookings.bookingDate,
        slotId: bookings.slotId,
        totalPrice: bookings.totalPrice,
        paymentId: payments.id,
        razorpayPaymentId: payments.razorpayPaymentId,
        customerName: users.name,
        customerEmail: users.email,
        serviceName: services.name,
      })
      .from(bookings)
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .innerJoin(payments, eq(bookings.id, payments.bookingId))
      .innerJoin(users, eq(bookings.customerId, users.id))
      .where(
        and(
          eq(bookings.status, "pending"),
          lt(bookings.bookingDate, sql`NOW()`) // Booking time has passed
        )
      );

    console.log(`Found ${expiredBookings.length} expired pending bookings`);

    const results = {
      processed: 0,
      rejected: 0,
      refunded: 0,
      errors: [],
    };

    for (const booking of expiredBookings) {
      try {
        // Update booking status to rejected
        await db
          .update(bookings)
          .set({ status: "rejected" })
          .where(eq(bookings.id, booking.bookingId));

        console.log(`Booking ${booking.bookingId} marked as rejected`);

        // Initiate refund if payment exists
        if (booking.razorpayPaymentId) {
          try {
            const refundResult = await initiateRefund(
              booking.razorpayPaymentId,
              booking.totalPrice,
              "Auto-refund: Booking time expired"
            );

            // Update payment status
            await db
              .update(payments)
              .set({
                status: "refunded",
                refundId: refundResult.id,
                refundAmount: booking.totalPrice,
                refundReason: "Auto-refund: Booking time expired - Provider did not respond",
                refundedAt: new Date(),
              })
              .where(eq(payments.id, booking.paymentId));

            console.log(`Refund initiated for booking ${booking.bookingId}`);
            results.refunded++;
          } catch (refundError) {
            console.error(`Refund failed for booking ${booking.bookingId}:`, refundError);
            results.errors.push({
              bookingId: booking.bookingId,
              error: "Refund failed",
              details: refundError.message,
            });
          }
        }

        results.rejected++;
        results.processed++;

      } catch (error) {
        console.error(`Error processing booking ${booking.bookingId}:`, error);
        results.errors.push({
          bookingId: booking.bookingId,
          error: "Processing failed",
          details: error.message,
        });
      }
    }

    console.log("Cron job completed:", results);
    res.status(200).json({
      message: "Auto-reject completed",
      ...results,
    });

  } catch (error) {
    console.error("Cron job error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * POST /cron/auto-handle-reschedule-requests
 * Internal endpoint for cron jobs to auto-revert expired reschedule requests
 * If provider doesn't respond to reschedule request within 2 hours, revert to original slot
 * Protected by CRON_SECRET
 */
router.post("/auto-handle-reschedule-requests", verifyCronSecret, async (req, res) => {
  console.log("Cron job: Processing expired reschedule requests...");

  try {
    // Get reschedule_pending bookings where rescheduledAt is older than 2 hours
    const TWO_HOURS_AGO = sql`NOW() - INTERVAL '2 hours'`;

    const expiredRescheduleRequests = await db
      .select({
        bookingId: bookings.id,
        customerId: bookings.customerId,
        customerName: users.name,
        customerEmail: users.email,
        serviceName: services.name,
        currentSlotId: bookings.slotId,
        currentBookingDate: bookings.bookingDate,
        previousSlotId: bookings.previousSlotId,
        previousBookingDate: bookings.previousBookingDate,
        rescheduleReason: bookings.rescheduleReason,
        rescheduledAt: bookings.rescheduledAt,
        paymentId: payments.id,
        razorpayPaymentId: payments.razorpayPaymentId,
        amount: payments.amount,
      })
      .from(bookings)
      .innerJoin(users, eq(bookings.customerId, users.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(payments, eq(bookings.id, payments.bookingId))
      .where(
        and(
          eq(bookings.status, "reschedule_pending"),
          lt(bookings.rescheduledAt, TWO_HOURS_AGO)
        )
      );

    console.log(`Found ${expiredRescheduleRequests.length} expired reschedule requests`);

    const results = {
      processed: 0,
      reverted: 0,
      refunded: 0,
      errors: [],
    };

    for (const booking of expiredRescheduleRequests) {
      try {
        // Validate that we have previous slot info to restore
        if (!booking.previousSlotId || !booking.previousBookingDate) {
          console.error(`Booking ${booking.bookingId} has no previous slot info, skipping`);
          results.errors.push({
            bookingId: booking.bookingId,
            error: "No previous slot info available",
            details: "Cannot revert reschedule request"
          });
          continue;
        }

        // Revert booking to original slot
        const [updatedBooking] = await db
          .update(bookings)
          .set({
            slotId: booking.previousSlotId,
            bookingDate: booking.previousBookingDate,
            status: "confirmed",
            // Clear reschedule tracking fields
            previousSlotId: null,
            previousBookingDate: null,
            rescheduleReason: null,
            rescheduledBy: null,
            rescheduledAt: null,
          })
          .where(eq(bookings.id, booking.bookingId))
          .returning();

        console.log(`Booking ${booking.bookingId} reverted to original slot (slot ${booking.previousSlotId} → ${booking.currentSlotId})`);

        // Refund reschedule fee if there's a separate payment for it
        // Look for payments where is_reschedule = true (reschedule fee)
        if (booking.paymentId && booking.razorpayPaymentId) {
          try {
            const refundResult = await initiateRefund(
              booking.razorpayPaymentId,
              booking.amount,
              "Auto-refund: Reschedule request expired - Provider did not respond"
            );

            // Update payment status
            await db
              .update(payments)
              .set({
                status: "refunded",
                refundId: refundResult.id,
                refundAmount: booking.amount,
                refundReason: "Auto-refund: Reschedule request expired - Provider did not respond in time",
                refundedAt: new Date(),
              })
              .where(eq(payments.id, booking.paymentId));

            console.log(`Refund processed for reschedule fee of booking ${booking.bookingId}`);
            results.refunded++;
          } catch (refundError) {
            console.error(`Refund failed for booking ${booking.bookingId}:`, refundError);
            results.errors.push({
              bookingId: booking.bookingId,
              error: "Refund failed",
              details: refundError.message,
            });
          }
        }

        results.reverted++;
        results.processed++;

      } catch (error) {
        console.error(`Error processing booking ${booking.bookingId}:`, error);
        results.errors.push({
          bookingId: booking.bookingId,
          error: "Processing failed",
          details: error.message,
        });
      }
    }

    console.log("Cron job completed:", results);
    res.status(200).json({
      message: "Auto-handle reschedule requests completed",
      ...results,
    });

  } catch (error) {
    console.error("Cron job error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * GET /cron/health
 * Health check endpoint for cron jobs
 */
router.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
