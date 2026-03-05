/**
 * Check All Payment Intents
 *
 * This script shows all payment intents in the database to diagnose slot locking issues.
 */

const db = require("./config/db");
const { paymentIntents } = require("./models/schema");

async function checkAllIntents() {
  try {
    console.log("🔍 Fetching all payment intents from database...\n");

    const allIntents = await db.select().from(paymentIntents);

    if (allIntents.length === 0) {
      console.log("✅ No payment intents found in database.");
      return;
    }

    console.log(`📊 Found ${allIntents.length} payment intents:\n`);

    const now = new Date();

    allIntents.forEach((intent, index) => {
      const expiresAt = new Date(intent.expiresAt);
      const isExpired = now > expiresAt;
      const timeRemaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

      console.log(`${index + 1}. Intent ID: ${intent.id}`);
      console.log(`   Status: ${intent.status}`);
      console.log(`   Slot ID: ${intent.slotId}`);
      console.log(`   Service ID: ${intent.serviceId}`);
      console.log(`   User ID: ${intent.userId}`);
      console.log(`   Created: ${intent.createdAt}`);
      console.log(`   Expires: ${intent.expiresAt}`);
      console.log(`   Is Expired: ${isExpired ? "YES ⚠️" : "NO"}`);
      if (!isExpired) {
        console.log(`   Time Remaining: ${timeRemaining}s (${Math.floor(timeRemaining / 60)}m ${timeRemaining % 60}s)`);
      }
      console.log(`   Booking Date: ${intent.bookingDate}`);
      console.log("");
    });

    // Summary
    const pendingIntents = allIntents.filter((i) => i.status === "pending");
    const expiredButPending = pendingIntents.filter((i) => new Date(i.expiresAt) < now);

    console.log("\n📈 Summary:");
    console.log(`   Total intents: ${allIntents.length}`);
    console.log(`   Pending intents: ${pendingIntents.length}`);
    console.log(`   Expired but still pending: ${expiredButPending.length}`);

    if (expiredButPending.length > 0) {
      console.log("\n⚠️ ACTION NEEDED: Found expired intents that are still pending!");
      console.log("Run: node clear-stale-intents.js");
    }
  } catch (error) {
    console.error("❌ Error checking intents:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

checkAllIntents();
