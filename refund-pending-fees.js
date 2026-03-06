require("dotenv").config();
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const { payments } = require("./models/schema");
const { eq, inArray } = require("drizzle-orm");
const { initiateRefund } = require("./utils/razorpay");

const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString);
const db = drizzle(client);

// Pending reschedule fee payment IDs
const PAYMENT_IDS = [4, 5, 6, 11, 12, 13];

async function refundPendingFees() {
  console.log("\n=== REFUND PENDING RESCHEDULE FEES ===\n");

  const pendingPayments = await db
    .select()
    .from(payments)
    .where(inArray(payments.id, PAYMENT_IDS));

  console.log(`Found ${pendingPayments.length} pending refund payments\n`);

  for (const payment of pendingPayments) {
    console.log(`\n💰 Processing Payment ID: ${payment.id} (₹${payment.amount / 100})`);

    try {
      // Initiate refund via Razorpay
      const refund = await initiateRefund(
        payment.razorpayPaymentId,
        null, // Full refund
        { reason: "Reschedule declined - manual refund" }
      );

      // Update database
      const [updated] = await db
        .update(payments)
        .set({
          refundId: refund.id,
          refundAmount: payment.amount,
          refundReason: "Reschedule request declined by provider",
          refundedAt: new Date(),
          status: "refunded",
        })
        .where(eq(payments.id, payment.id))
        .returning();

      console.log(`   ✅ Refunded! Refund ID: ${refund.id}`);
    } catch (error) {
      console.error(`   ❌ Failed: ${error.message}`);
    }
  }

  console.log("\n\n=== SUMMARY ===\n");

  const refundedPayments = await db
    .select()
    .from(payments)
    .where(inArray(payments.id, PAYMENT_IDS));

  let totalRefunded = 0;
  for (const p of refundedPayments) {
    if (p.status === "refunded") {
      totalRefunded += p.refundAmount || 0;
      console.log(`Payment ${p.id}: ₹${p.amount / 100} - ✅ Refunded (${p.refundId})`);
    } else {
      console.log(`Payment ${p.id}: ₹${p.amount / 100} - ❌ Still pending`);
    }
  }

  console.log(`\nTotal Refunded: ₹${totalRefunded / 100}`);

  await client.end();
  process.exit(0);
}

refundPendingFees().catch(console.error);
