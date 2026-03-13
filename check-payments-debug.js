const db = require("./config/db");
const { payments } = require("./models/schema");
const { eq } = require("drizzle-orm");

async function checkPayments() {
  try {
    const allPayments = await db
      .select()
      .from(payments)
      .limit(5);

    console.log("\n=== RECENT PAYMENTS ===");
    allPayments.forEach((p) => {
      console.log({
        id: p.id,
        bookingId: p.bookingId,
        status: p.status,
        amount: p.amount,
        platformFee: p.platform_fee,
        providerShare: p.provider_share,
        providerPayoutStatus: p.provider_payout_status,
      });
    });

    // Check for paid payments with null providerShare
    const paidWithoutSplit = await db
      .select()
      .from(payments)
      .where(eq(payments.status, "paid"))
      .limit(5);

    console.log("\n=== PAID PAYMENTS CHECK ===");
    paidWithoutSplit.forEach((p) => {
      if (!p.provider_share || p.provider_share === 0) {
        console.log("❌ Payment with no providerShare:", p.id, p.amount);
      } else {
        console.log("✅ Payment has providerShare:", p.id, p.provider_share);
      }
    });

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

checkPayments();
