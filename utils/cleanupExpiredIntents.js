/**
 * Cleanup Expired Payment Intents
 * Run this periodically (every 30 seconds) to clean up expired payment intents
 *
 * This is critical for the slot locking system:
 * - When payment intents expire, the unique constraint no longer applies
 * - Other customers can then book the same slot
 * - Keeps database clean and prevents accumulation of stale locks
 */

const db = require("../config/db");
const { paymentIntents } = require("../models/schema");
const { eq, lt, and } = require("drizzle-orm");

/**
 * Get current timestamp in readable format
 */
const getTimestamp = () => {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
};

/**
 * Cleanup expired payment intents
 * - Marks pending intents as 'expired' if they have passed their expiry time
 * - This releases the slot lock for other customers
 * - Returns detailed metrics about the cleanup
 */
const cleanupExpiredIntents = async () => {
  const startTime = Date.now();
  const timestamp = getTimestamp();

  try {
    const now = new Date();

    // Find all pending payment intents that have expired
    const expiredIntents = await db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.status, "pending"),
          lt(paymentIntents.expiresAt, now)
        )
      );

    if (expiredIntents.length === 0) {
      console.log(`[${timestamp}] 🧹 No expired intents to clean up`);
      return {
        cleaned: 0,
        activeLocks: 0,
        duration: Date.now() - startTime,
      };
    }

    // Mark all expired intents as 'expired'
    const updated = await db
      .update(paymentIntents)
      .set({ status: "expired" })
      .where(
        and(
          eq(paymentIntents.status, "pending"),
          lt(paymentIntents.expiresAt, now)
        )
      )
      .returning();

    const duration = Date.now() - startTime;

    console.log(`[${timestamp}] 🧹 Cleaned up ${updated.length} expired intent${updated.length > 1 ? 's' : ''} | Took ${duration}ms`);

    // Log detailed info for each expired intent (only in development)
    if (process.env.NODE_ENV === 'development') {
      updated.forEach((intent) => {
        const expiryTime = new Date(intent.expiresAt);
        const expiredMinutesAgo = Math.floor((now - expiryTime) / 1000 / 60);
        console.log(`   └─ Intent ${intent.id}: Slot ${intent.slotId}, expired ${expiredMinutesAgo}min ago`);
      });
    }

    return {
      cleaned: updated.length,
      duration,
      intents: updated,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${timestamp}] ❌ Cleanup failed after ${duration}ms:`, error.message);
    return { error: error.message, duration };
  }
};

/**
 * Start periodic cleanup
 * Runs every 30 seconds to automatically release expired slot locks
 *
 * This should be called when the server starts (see index.js)
 */
const startPeriodicCleanup = () => {
  const intervalSeconds = 30;
  const timestamp = getTimestamp();

  console.log(`[${timestamp}] 🧹 Starting periodic cleanup service`);
  console.log(`   ├─ Interval: ${intervalSeconds} seconds`);
  console.log(`   ├─ Lock duration: 1 minute`);
  console.log(`   └─ Mode: ${process.env.NODE_ENV || 'development'}`);

  // Run immediately on startup
  cleanupExpiredIntents();

  // Then run every 30 seconds
  const intervalMs = intervalSeconds * 1000;
  setInterval(cleanupExpiredIntents, intervalMs);

  console.log(`[${timestamp}] ✅ Cleanup service started\n`);
};

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--watch")) {
    // Run in watch mode (periodic cleanup)
    startPeriodicCleanup();
  } else {
    // Run once
    cleanupExpiredIntents()
      .then((result) => {
        if (!result.error) {
          console.log(`\n✅ Cleanup complete: ${result.cleaned} intents processed`);
          process.exit(0);
        } else {
          console.error(`\n❌ Cleanup failed: ${result.error}`);
          process.exit(1);
        }
      });
  }
}

module.exports = {
  cleanupExpiredIntents,
  startPeriodicCleanup,
};
