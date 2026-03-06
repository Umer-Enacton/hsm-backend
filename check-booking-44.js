require("dotenv").config();
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const { bookings, payments } = require("./models/schema");
const { eq } = require("drizzle-orm");

const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString);
const db = drizzle(client);

async function checkBooking44() {
  console.log("\n=== CHECKING BOOKING 44 ===\n");

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, 44));

  if (!booking) {
    console.log("Booking 44 not found!");
  } else {
    console.log(`📌 Booking ID: ${booking.id}`);
    console.log(`Customer ID: ${booking.customerId}`);
    console.log(`Business ID: ${booking.businessProfileId}`);
    console.log(`Service ID: ${booking.serviceId}`);
    console.log(`Status: ${booking.status}`);
    console.log(`Slot ID: ${booking.slotId}`);
    console.log(`Previous Slot ID: ${booking.previousSlotId || "N/A"}`);
    console.log(`Booking Date: ${booking.bookingDate}`);
    console.log(`Previous Date: ${booking.previousBookingDate || "N/A"}`);
    console.log(`Payment Status: ${booking.paymentStatus || "N/A"}`);
  }

  console.log("\n=== PAYMENTS FOR BOOKING 44 ===\n");

  const bookingPayments = await db
    .select()
    .from(payments)
    .where(eq(payments.bookingId, 44));

  console.log(`Found ${bookingPayments.length} payments\n`);

  for (const payment of bookingPayments) {
    console.log(`\n💰 Payment ID: ${payment.id}`);
    console.log(`   Amount: ₹${payment.amount / 100}`);
    console.log(`   Status: ${payment.status}${payment.status === "refunded" ? " ✅" : ""}`);
    console.log(`   Razorpay Payment ID: ${payment.razorpayPaymentId || "N/A"}`);
    console.log(`   Created: ${payment.createdAt}`);
    if (payment.status === "refunded") {
      console.log(`   ✅ Refund ID: ${payment.refundId}`);
      console.log(`   ✅ Refund Amount: ₹${payment.refundAmount / 100}`);
      console.log(`   ✅ Refund Reason: ${payment.refundReason}`);
      console.log(`   ✅ Refunded At: ${payment.refundedAt}`);
    }
  }

  await client.end();
  process.exit(0);
}

checkBooking44().catch(console.error);
