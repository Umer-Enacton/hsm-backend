/**
 * Clear Stale Payment Intents
 *
 * This script clears expired payment intents that might be blocking slots.
 * Run this after deployment or if users are getting SLOT_LOCKED errors.
 *
 * Usage: node clear-stale-intents.js
 */

const db = require("./config/db");
const { paymentIntents } = require("./models/schema");
const { eq, or, and, lt } = require("drizzle-orm");

async function clearStaleIntents() {
  try {
    console.log("🔍 Checking for stale payment intents...");

    const now = new Date();

    // Find all pending intents that have expired
    const staleIntents = await db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.status, "pending"),
          lt(paymentIntents.expiresAt, now) // expiresAt < now
        )
      );

    if (staleIntents.length === 0) {
      console.log("✅ No stale payment intents found. All slots are available.");
      return;
    }

    console.log(`⚠️ Found ${staleIntents.length} stale payment intents:`);
    console.log(
      staleIntents.map((intent) => ({
        id: intent.id,
        slotId: intent.slotId,
        userId: intent.userId,
        expiresAt: intent.expiresAt,
        status: intent.status,
      }))
    );

    // Mark all stale intents as expired
    console.log("🔄 Marking stale intents as expired...");

    for (const intent of staleIntents) {
      await db
        .update(paymentIntents)
        .set({ status: "expired" })
        .where(eq(paymentIntents.id, intent.id));

      console.log(`✅ Intent ${intent.id} marked as expired`);
    }

    console.log(
      `✅ Successfully cleared ${staleIntents.length} stale payment intents`
    );
    console.log("🔓 Slots are now available for booking!");
  } catch (error) {
    console.error("❌ Error clearing stale intents:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

clearStaleIntents();
