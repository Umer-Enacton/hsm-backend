const db = require("./config/db");
const { payments, bookings } = require("./models/schema");
const { eq } = require("drizzle-orm");

async function checkAndUpdatePayoutStatus() {
  try {
    // Get the payment we just updated
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, 1))
      .limit(1);

    console.log("Payment:", payment);

    // Get the booking
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, payment.bookingId))
      .limit(1);

    console.log("Booking:", booking);

    if (booking.status === "completed" && payment.providerPayoutStatus === null) {
      // Set to pending
      await db
        .update(payments)
        .set({ providerPayoutStatus: "pending" })
        .where(eq(payments.id, payment.id));

      console.log("✅ Set payout status to 'pending' for completed booking");
    } else {
      console.log(`Booking status is: ${booking.status}`);
      console.log(`Payout status: ${payment.providerPayoutStatus || "null"}`);
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

checkAndUpdatePayoutStatus();
