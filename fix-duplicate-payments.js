/**
 * FIX DUPLICATE SUBSCRIPTION PAYMENTS
 *
 * This script removes duplicate subscription payments and recalculates amount_paid
 *
 * Run with: node fix-duplicate-payments.js
 */

const db = require("./config/db");
const { subscriptionPayments, providerSubscriptions } = require("./models/schema");
const { eq, sql, desc } = require("drizzle-orm");

async function fixDuplicatePayments() {
  try {
    console.log("🔍 Finding duplicate subscription payments...");

    // Get all subscription payments to find duplicates
    const allPayments = await db
      .select()
      .from(subscriptionPayments)
      .orderBy(subscriptionPayments.createdAt);

    // Group by razorpay_payment_id
    const paymentGroups = new Map();
    for (const payment of allPayments) {
      if (!payment.razorpayPaymentId) continue;
      if (!paymentGroups.has(payment.razorpayPaymentId)) {
        paymentGroups.set(payment.razorpayPaymentId, []);
      }
      paymentGroups.get(payment.razorpayPaymentId).push(payment);
    }

    // Find duplicates
    let duplicateCount = 0;
    for (const [paymentId, entries] of paymentGroups) {
      if (entries.length > 1) {
        duplicateCount++;
        console.log(`\n📋 Duplicate payment found: ${paymentId} (${entries.length} entries)`);

        // Sort by created_at (oldest first)
        entries.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        // Keep the first one, delete the rest
        const toKeep = entries[0];
        const toDelete = entries.slice(1);

        for (const entry of toDelete) {
          console.log(`  ❌ Deleting duplicate entry ID: ${entry.id}`);
          await db
            .delete(subscriptionPayments)
            .where(eq(subscriptionPayments.id, entry.id));
        }

        console.log(`  ✅ Kept entry ID: ${toKeep.id} (created: ${toKeep.createdAt})`);
      }
    }

    console.log(`\n✅ Removed ${duplicateCount} duplicate payment groups`);

    // Recalculate amount_paid for all subscriptions
    console.log("\n🔄 Recalculating amount_paid for all subscriptions...");

    const subscriptions = await db
      .select()
      .from(providerSubscriptions);

    for (const sub of subscriptions) {
      // Get all captured payments for this subscription
      const payments = await db
        .select()
        .from(subscriptionPayments)
        .where(eq(subscriptionPayments.providerSubscriptionId, sub.id));

      // Sum up the amounts
      const actualAmount = payments
        .filter(p => p.status === "captured")
        .reduce((sum, p) => sum + (p.amount || 0), 0);

      if (sub.amountPaid !== actualAmount) {
        console.log(`  📝 Subscription ${sub.id} (provider ${sub.providerId}): ₹${sub.amountPaid / 100} → ₹${actualAmount / 100}`);
        await db
          .update(providerSubscriptions)
          .set({ amountPaid: actualAmount })
          .where(eq(providerSubscriptions.id, sub.id));
      }
    }

    console.log("\n✅ Fix complete!");

    // Show summary
    const summary = await db
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.status, "captured"));

    const totalAmount = summary.reduce((sum, p) => sum + (p.amount || 0), 0);

    console.log("\n📊 Summary:");
    console.log(`  Total payments: ${summary.length}`);
    console.log(`  Total amount: ₹${(totalAmount / 100).toFixed(2)}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

fixDuplicatePayments();
