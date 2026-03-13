/**
 * Fix existing payments - add platformFee and providerShare
 * Run once to update all existing payment records
 */

const db = require("./config/db");
const { payments } = require("./models/schema");
const { eq, sql } = require("drizzle-orm");

async function fixExistingPayments() {
  try {
    console.log("Fetching all paid payments...");

    // Get all paid payments that need split calculation
    const allPayments = await db
      .select()
      .from(payments)
      .where(eq(payments.status, "paid"));

    console.log(`Found ${allPayments.length} paid payments`);

    let updated = 0;
    let skipped = 0;

    for (const payment of allPayments) {
      // Check if platform_fee or provider_share is null/undefined/0
      const needsUpdate = !payment.platform_fee ||
                          payment.platform_fee === 0 ||
                          !payment.provider_share ||
                          payment.provider_share === 0;

      if (needsUpdate) {
        // Calculate 5% platform fee
        const platformFee = Math.round(payment.amount * 0.05);
        const providerShare = payment.amount - platformFee;

        await db
          .update(payments)
          .set({
            platformFee: platformFee,
            providerShare: providerShare,
          })
          .where(eq(payments.id, payment.id));

        updated++;
        console.log(`✅ Updated payment ${payment.id}: ${payment.amount / 100} Rs → Platform: ₹${platformFee / 100}, Provider: ₹${providerShare / 100}`);
      } else {
        skipped++;
        console.log(`⊙ Payment ${payment.id} already has split values`);
      }
    }

    console.log(`\n✅ Updated ${updated} payment records`);
    console.log(`⊙ Skipped ${skipped} payments (already had values)`);
    process.exit(0);
  } catch (error) {
    console.error("Error updating payments:", error);
    console.error(error.stack);
    process.exit(1);
  }
}

fixExistingPayments();
