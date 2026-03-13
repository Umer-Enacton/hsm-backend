const db = require("./config/db");
const { bookings, payments } = require("./models/schema");
const { eq } = require("drizzle-orm");

async function testCompleteBooking() {
  try {
    console.log("📋 Testing booking completion flow...\n");

    // 1. Get current booking and payment status
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, 1))
      .limit(1);

    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, 1))
      .limit(1);

    console.log("BEFORE:");
    console.log(`  Booking status: ${booking.status}`);
    console.log(`  Payout status: ${payment.providerPayoutStatus || "null"}`);
    console.log(`  Provider share: ₹${payment.providerShare / 100}\n`);

    // 2. Update booking to completed
    await db
      .update(bookings)
      .set({ status: "completed" })
      .where(eq(bookings.id, 1));

    console.log("✅ Updated booking to 'completed'");

    // 3. Update payment payout status to pending
    await db
      .update(payments)
      .set({ providerPayoutStatus: "pending" })
      .where(eq(payments.id, payment.id));

    console.log("✅ Set payout status to 'pending'\n");

    // 4. Verify
    const [updatedBooking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, 1))
      .limit(1);

    const [updatedPayment] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, 1))
      .limit(1);

    console.log("AFTER:");
    console.log(`  Booking status: ${updatedBooking.status}`);
    console.log(`  Payout status: ${updatedPayment.providerPayoutStatus}`);
    console.log(`  Provider share: ₹${updatedPayment.providerShare / 100}\n`);

    console.log("✅ Ready for payout processing!");

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

testCompleteBooking();
