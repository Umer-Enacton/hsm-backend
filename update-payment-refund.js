require("dotenv").config();
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const { payments } = require("./models/schema");
const { eq } = require("drizzle-orm");

const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString);
const db = drizzle(client);

async function updatePaymentRefund() {
  console.log("\n=== UPDATE PAYMENT 14 AS REFUNDED ===\n");

  const [updated] = await db
    .update(payments)
    .set({
      refundId: "rfnd_SNvnwTuLfEiHi8",
      refundAmount: 2500, // ₹25 in paise
      refundReason: "Reschedule request declined by provider",
      refundedAt: new Date(),
      status: "refunded",
    })
    .where(eq(payments.id, 14))
    .returning();

  console.log("✅ Payment updated:");
  console.log(`   ID: ${updated.id}`);
  console.log(`   Status: ${updated.status}`);
  console.log(`   Refund ID: ${updated.refundId}`);
  console.log(`   Refund Amount: ₹${updated.refundAmount / 100}`);

  await client.end();
  process.exit(0);
}

updatePaymentRefund().catch(console.error);
