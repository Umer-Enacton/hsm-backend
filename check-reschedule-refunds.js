require("dotenv").config();
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const { payments, bookings } = require("./models/schema");
const { eq, isNotNull, and } = require("drizzle-orm");

// Database connection
const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString);
const db = drizzle(client);

async function checkRescheduleRefunds() {
  console.log("\n=== RESCHEDULE_PENDING BOOKINGS & THEIR PAYMENTS ===\n");

  // Get all reschedule_pending bookings
  const { eq } = require("drizzle-orm");
  const rescheduleBookings = await db
    .select()
    .from(bookings)
    .where(eq(bookings.status, "reschedule_pending"));

  console.log(`Found ${rescheduleBookings.length} reschedule_pending bookings\n`);

  for (const booking of rescheduleBookings) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📅 BOOKING ID: ${booking.id}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Customer ID:       ${booking.customerId}`);
    console.log(`Business ID:       ${booking.businessProfileId}`);
    console.log(`Service ID:        ${booking.serviceId}`);
    console.log(`Current Slot ID:   ${booking.slotId}`);
    console.log(`Booking Date:      ${booking.bookingDate}`);
    console.log(`Status:            ${booking.status}`);
    console.log(`Payment Status:    ${booking.paymentStatus || "N/A"}`);
    console.log(`\n─── Reschedule Details ───`);
    console.log(`Previous Slot ID:  ${booking.previousSlotId || "N/A"}`);
    console.log(`Previous Date:     ${booking.previousBookingDate || "N/A"}`);
    console.log(`Reschedule Reason: ${booking.rescheduleReason || "N/A"}`);

    // Get all payments for this booking
    const bookingPayments = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, booking.id));

    console.log(`\n─── Payments for this booking (${bookingPayments.length} total) ───`);

    for (const payment of bookingPayments) {
      const isRefunded = payment.status === "refunded";
      console.log(`\n  💰 Payment ID: ${payment.id}`);
      console.log(`     Amount:    ₹${payment.amount / 100}`);
      console.log(`     Status:    ${payment.status} ${isRefunded ? "✅ REFUNDED" : ""}`);
      console.log(`     Created:   ${payment.createdAt}`);
      console.log(`     Razorpay Payment ID: ${payment.razorpayPaymentId || "N/A"}`);

      if (isRefunded) {
        console.log(`     └─ Refund ID:    ${payment.refundId}`);
        console.log(`     └─ Refund Amt:   ₹${payment.refundAmount / 100}`);
        console.log(`     └─ Refund Reason: ${payment.refundReason}`);
        console.log(`     └─ Refunded At:  ${payment.refundedAt}`);
      }
    }
  }

  console.log("\n\n");

  // Also check for any refunded reschedule fees
  console.log("\n=== ALL REFUNDED PAYMENTS (Reschedule Fee Refunds) ===\n");

  const refundedPayments = await db
    .select()
    .from(payments)
    .where(eq(payments.status, "refunded"));

  if (refundedPayments.length === 0) {
    console.log("No refunded payments found.");
  } else {
    for (const payment of refundedPayments) {
      console.log(`\n💸 Payment ID: ${payment.id}`);
      console.log(`   Booking ID: ${payment.bookingId}`);
      console.log(`   Amount:     ₹${payment.amount / 100}`);
      console.log(`   Refund ID:  ${payment.refundId}`);
      console.log(`   Refund Amt: ₹${payment.refundAmount / 100}`);
      console.log(`   Reason:     ${payment.refundReason}`);
      console.log(`   Refunded At: ${payment.refundedAt}`);
    }
  }

  console.log("\n\n");

  // Check if there are any declined reschedule bookings (status should go back to confirmed)
  console.log("\n=== BOOKINGS THAT HAD RESCHEDULE DECLINED (status = confirmed, has previousSlotId) ===\n");

  const declinedBookings = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, "confirmed"), isNotNull(bookings.previousSlotId)));

  if (declinedBookings.length === 0) {
    console.log("No declined reschedule bookings found.");
  } else {
    for (const booking of declinedBookings) {
      console.log(`\n📌 Booking ID: ${booking.id}`);
      console.log(`   Current Slot: ${booking.slotId}`);
      console.log(`   Had Previous Slot: ${booking.previousSlotId} (reschedule was declined)`);
    }
  }

  await client.end();
  process.exit(0);
}

checkRescheduleRefunds().catch(console.error);
