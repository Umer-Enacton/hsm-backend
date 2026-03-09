const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { bookings, payments, services } = require("../models/schema");
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
router.post("/cron/auto-reject-bookings", verifyCronSecret, async (req, res) => {
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
        slotTime: slots.startTime,
        providerId: services.providerId,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
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
              "Auto-refund: Booking time expired - Provider did not respond"
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
 * GET /cron/health
 * Health check endpoint for cron jobs
 */
router.get("/cron/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
