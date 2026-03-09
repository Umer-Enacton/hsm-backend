require("dotenv").config();
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const { payments } = require("./models/schema");
const { desc } = require("drizzle-orm");

const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString);
const db = drizzle(client);

async function checkLatest() {
  console.log("\n=== LATEST 5 PAYMENTS ===\n");

  const latestPayments = await db
    .select()
    .from(payments)
    .orderBy(desc(payments.createdAt))
    .limit(5);

  for (const payment of latestPayments) {
    const status = payment.status + (payment.status === "refunded" ? " ✅" : "");
    console.log(`ID: ${payment.id} | Booking: ${payment.bookingId} | Amount: ₹${payment.amount / 100} | Status: ${status}`);
    if (payment.status === "refunded") {
      console.log(`   Refund ID: ${payment.refundId}`);
    }
  }

  await client.end();
  process.exit(0);
}

checkLatest().catch(console.error);
