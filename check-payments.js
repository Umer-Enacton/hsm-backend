require("dotenv").config();
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const { payments, bookings } = require("./models/schema");

// Database connection
const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString);
const db = drizzle(client);

async function checkPayments() {
  console.log("\n=== PAYMENTS TABLE ===\n");

  const allPayments = await db.select().from(payments).orderBy(payments.createdAt);

  console.log(`Total payments: ${allPayments.length}\n`);

  allPayments.forEach((p) => {
    console.log(`\n--- Payment ID: ${p.id} ---`);
    console.log(`Booking ID: ${p.bookingId}`);
    console.log(`User ID: ${p.userId}`);
    console.log(`Amount: ₹${p.amount / 100} (${p.amount} paise)`);
    console.log(`Status: ${p.status}`);
    console.log(`Razorpay Order ID: ${p.razorpayOrderId || "N/A"}`);
    console.log(`Razorpay Payment ID: ${p.razorpayPaymentId || "N/A"}`);
    console.log(`Refund ID: ${p.refundId || "N/A"}`);
    console.log(`Refund Amount: ${p.refundAmount ? `₹${p.refundAmount / 100}` : "N/A"}`);
    console.log(`Refund Reason: ${p.refundReason || "N/A"}`);
    console.log(`Created At: ${p.createdAt}`);
    console.log(`Refunded At: ${p.refundedAt || "N/A"}`);
  });

  console.log("\n\n=== BOOKINGS WITH PAYMENTS ===\n");

  const bookingsWithPayments = await db
    .select()
    .from(bookings)
    .where((b) => b.paymentStatus !== null);

  console.log(`Bookings with payment status: ${bookingsWithPayments.length}\n`);

  bookingsWithPayments.forEach((b) => {
    console.log(`\n--- Booking ID: ${b.id} ---`);
    console.log(`Customer ID: ${b.customerId}`);
    console.log(`Business ID: ${b.businessProfileId}`);
    console.log(`Service ID: ${b.serviceId}`);
    console.log(`Slot ID: ${b.slotId}`);
    console.log(`Booking Date: ${b.bookingDate}`);
    console.log(`Status: ${b.status}`);
    console.log(`Payment Status: ${b.paymentStatus || "N/A"}`);
  });

  process.exit(0);
}

checkPayments().catch(console.error);
