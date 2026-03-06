require("dotenv").config();
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const { payments } = require("./models/schema");
const { eq } = require("drizzle-orm");

const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString);
const db = drizzle(client);

async function syncRefund() {
  console.log("\n=== SYNC PAYMENT 11 REFUND TO DATABASE ===\n");

  const [updated] = await db
    .update(payments)
    .set({
      refundId: "rfnd_RAZORPAY_MANUAL", // Was refunded via dashboard
      refundAmount: 3000, // ₹30 in paise
      refundReason: "Reschedule request declined by provider (refunded via dashboard)",
      refundedAt: new Date(),
      status: "refunded",
    })
    .where(eq(payments.id, 11))
    .returning();

  console.log("✅ Payment updated:");
  console.log(`   ID: ${updated.id}`);
  console.log(`   Status: ${updated.status}`);
  console.log(`   Refund Amount: ₹${updated.refundAmount / 100}`);

  await client.end();
  process.exit(0);
}

syncRefund().catch(console.error);
