/**
 * Manual script to refund payments for rejected bookings
 * Run with: node scripts/processPendingRefunds.js
 */

require("dotenv").config();
const db = require("../config/db");
const { bookings, payments } = require("../models/schema");
const { eq, and } = require("drizzle-orm");
const { initiateRefund } = require("../utils/razorpay");

async function processPendingRefunds() {
  console.log("🔄 Processing pending refunds for rejected bookings...\n");

  try {
    // Find all rejected bookings with paid payments
    const rejectedBookings = await db
      .select({
        bookingId: bookings.id,
        paymentId: payments.id,
        razorpayPaymentId: payments.razorpayPaymentId,
        amount: payments.amount,
        bookingDate: bookings.bookingDate,
      })
      .from(bookings)
      .innerJoin(payments, eq(bookings.id, payments.bookingId))
      .where(
        and(
          eq(bookings.status, "rejected"),
          eq(payments.status, "paid")
        )
      );

    console.log(`Found ${rejectedBookings.length} rejected bookings with pending refunds`);

    if (rejectedBookings.length === 0) {
      console.log("✅ No pending refunds to process");
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const booking of rejectedBookings) {
      console.log(`\n📦 Processing booking ${booking.bookingId}...`);
      console.log(`   Payment ID: ${booking.razorpayPaymentId}`);
      console.log(`   Amount: ₹${booking.amount / 100}`);

      try {
        // Initiate refund
        const refundResult = await initiateRefund(
          booking.razorpayPaymentId,
          booking.amount,
          "Auto-refund: Booking rejected"
        );

        console.log(`   ✅ Refund initiated: ${refundResult.id}`);

        // Update payment status
        await db
          .update(payments)
          .set({
            status: "refunded",
            refundId: refundResult.id,
            refundAmount: booking.amount,
            refundReason: "Auto-refund: Booking rejected - Provider did not respond",
            refundedAt: new Date(),
          })
          .where(eq(payments.id, booking.paymentId));

        console.log(`   💾 Payment ${booking.paymentId} updated to refunded`);
        successCount++;

      } catch (error) {
        console.error(`   ❌ Refund failed: ${error.message}`);
        failCount++;

        // Log the error but continue processing
        console.error(`   📝 Error details:`, error);
      }
    }

    console.log(`\n${"=".repeat(50)}`);
    console.log(`✅ Successfully refunded: ${successCount}`);
    console.log(`❌ Failed refunds: ${failCount}`);
    console.log(`${"=".repeat(50)}\n`);

  } catch (error) {
    console.error("❌ Script error:", error);
    process.exit(1);
  }
}

// Run the script
processPendingRefunds()
  .then(() => {
    console.log("✅ Script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
