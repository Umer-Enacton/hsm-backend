require("dotenv").config();
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const { payments, bookings } = require("./models/schema");
const { desc } = require("drizzle-orm");

const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString);
const db = drizzle(client);

async function checkLatest() {
  console.log("\n=== LATEST 10 PAYMENTS ===\n");

  const latestPayments = await db
    .select()
    .from(payments)
    .orderBy(desc(payments.createdAt))
    .limit(10);

  for (const payment of latestPayments) {
    const isRefunded = payment.status === "refunded";
    console.log(`\n💰 Payment ID: ${payment.id} | Booking: ${payment.bookingId} | ₹${payment.amount / 100}`);
    console.log(`   Status: ${payment.status}${isRefunded ? " ✅ REFUNDED" : ""}`);
    console.log(`   Created: ${payment.createdAt}`);
    console.log(`   Razorpay ID: ${payment.razorpayPaymentId || "N/A"}`);
    if (isRefunded) {
      console.log(`   └─ Refund ID: ${payment.refundId}`);
      console.log(`   └─ Refund Amt: ₹${payment.refundAmount / 100}`);
      console.log(`   └─ Reason: ${payment.refundReason}`);
    }
  }

  console.log("\n\n=== RECENT BOOKINGS (with status change) ===\n");

  const recentBookings = await db
    .select()
    .from(bookings)
    .orderBy(desc(bookings.updatedAt))
    .limit(5);

  for (const booking of recentBookings) {
    console.log(`\n📌 Booking ${booking.id}: ${booking.status}`);
    console.log(`   Slot: ${booking.slotId} | Payment: ${booking.paymentStatus || "N/A"}`);
    console.log(`   Updated: ${booking.updatedAt || booking.createdAt}`);
    if (booking.previousSlotId) {
      console.log(`   └─ Had reschedule (prev slot: ${booking.previousSlotId})`);
    }
  }

  await client.end();
  process.exit(0);
}

checkLatest().catch(console.error);
