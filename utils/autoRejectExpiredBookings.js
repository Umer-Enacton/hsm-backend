/**
 * Auto-reject pending bookings that have passed their scheduled time
 * This should be run periodically (e.g., every hour via cron)
 */

const db = require("../config/db");
const { bookings, slots, payments, services, users } = require("../models/schema");
const { eq, and, lt, sql } = require("drizzle-orm");
const { initiateRefund } = require("./razorpay");

/**
 * Find and auto-reject bookings that are past their scheduled time
 * @returns {Object} Summary of processed bookings
 */
async function autoRejectExpiredBookings() {
  try {
    console.log("Checking for expired pending bookings...");

    // Combine booking date with slot time using PostgreSQL date arithmetic
    const bookingDateTime = sql`CAST(${bookings.bookingDate} AS date) + ${slots.startTime}`;

    // Get pending bookings where the scheduled time has passed
    // We need to join with slots to get the time and with bookings to get the date

    const expiredBookings = await db
      .select({
        bookingId: bookings.id,
        customerId: bookings.customerId,
        providerId: sql`${services.providerId}`, // Will be joined
        bookingDate: bookings.bookingDate,
        slotId: bookings.slotId,
        totalPrice: bookings.totalPrice,
        paymentId: sql`${payments.id}`,
        razorpayPaymentId: payments.razorpayPaymentId,
        customerName: users.name,
        customerEmail: users.email,
        serviceName: services.name,
        slotTime: slots.startTime,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .innerJoin(payments, eq(bookings.id, payments.bookingId))
      .innerJoin(users, eq(bookings.customerId, users.id))
      .where(
        and(
          eq(bookings.status, "pending"),
          // Compare actual booking time (date + slot time) - reject exactly when slot starts
          sql`${bookingDateTime} < NOW()`
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
          .set({
            status: "rejected",
            // Optionally add a note about auto-rejection
          })
          .where(eq(bookings.id, booking.bookingId));

        console.log(`Booking ${booking.bookingId} marked as rejected`);

        // Initiate refund if payment was made
        if (booking.razorpayPaymentId) {
          try {
            const refundResult = await initiateRefund(
              booking.razorpayPaymentId,
              booking.totalPrice,
              "Booking expired - Provider did not respond"
            );

            // Update payment status
            await db
              .update(payments)
              .set({
                status: "refunded",
                refundId: refundResult.id,
                refundAmount: booking.totalPrice,
                refundReason: "Auto-refund: Booking time expired",
                refundedAt: new Date(),
              })
              .where(eq(payments.bookingId, booking.bookingId));

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

        // TODO: Send email notification to customer and provider about auto-rejection
        // await sendAutoRejectEmail(booking);

      } catch (error) {
        console.error(`Error processing booking ${booking.bookingId}:`, error);
        results.errors.push({
          bookingId: booking.bookingId,
          error: "Processing failed",
          details: error.message,
        });
      }
    }

    console.log("Auto-reject summary:", results);
    return results;

  } catch (error) {
    console.error("Auto-reject expired bookings error:", error);
    throw error;
  }
}

/**
 * Check for bookings that are about to expire (for reminders)
 * This could be used to send reminder notifications to providers
 * @returns {Array} List of bookings about to expire
 */
async function getBookingsAboutToExpire(hoursBefore = 2) {
  try {
    const expiringSoon = await db
      .select({
        bookingId: bookings.id,
        providerId: sql`${services.providerId}`,
        bookingDate: bookings.bookingDate,
        customerName: users.name,
        serviceName: services.name,
        slotTime: slots.startTime,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .innerJoin(users, eq(bookings.customerId, users.id))
      .where(
        and(
          eq(bookings.status, "pending"),
          // Booking time within the next X hours
          sql`${bookings.bookingDate} BETWEEN NOW() AND NOW() + INTERVAL '${hoursBefore} hours'`
        )
      )
      .orderBy(bookings.bookingDate);

    return expiringSoon;

  } catch (error) {
    console.error("Error getting expiring bookings:", error);
    return [];
  }
}

module.exports = {
  autoRejectExpiredBookings,
  getBookingsAboutToExpire,
};
