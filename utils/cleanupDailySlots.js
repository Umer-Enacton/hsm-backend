/**
 * Cleanup Old Daily Slots
 * Run this weekly to delete daily_slots rows older than 7 days
 * 
 * This keeps the daily_slots table small and ensures lock acquisition
 * stays O(1) regardless of how long the system runs.
 */

const db = require("../config/db");
const { dailySlots } = require("../models/schema");
const { lt, sql } = require("drizzle-orm");

/**
 * Get current timestamp in readable format
 */
const getTimestamp = () => {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
};

/**
 * Cleanup old daily_slots rows
 * Deletes rows older than 7 days
 * Returns detailed metrics about the cleanup
 */
const cleanupOldDailySlots = async () => {
  const startTime = Date.now();
  const timestamp = getTimestamp();

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get count before deletion
    const beforeCount = await db
      .select({ count: sql`count(*)` })
      .from(dailySlots);

    // Delete rows older than 7 days
    const result = await db
      .delete(dailySlots)
      .where(lt(dailySlots.createdAt, sevenDaysAgo))
      .returning();

    const duration = Date.now() - startTime;

    // Get count after deletion
    const afterCount = await db
      .select({ count: sql`count(*)` })
      .from(dailySlots);

    console.log(`[${timestamp}] 🧹 Cleaned up ${result.length} old daily_slots rows | Took ${duration}ms`);
    console.log(`   ├─ Before: ${beforeCount[0]?.count || 0} rows`);
    console.log(`   └─ After: ${afterCount[0]?.count || 0} rows`);

    return {
      deleted: result.length,
      duration,
      beforeCount: beforeCount[0]?.count || 0,
      afterCount: afterCount[0]?.count || 0,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${timestamp}] ❌ Cleanup failed after ${duration}ms:`, error.message);
    return { error: error.message, duration };
  }
};

/**
 * Get stats about daily_slots table
 */
const getDailySlotsStats = async () => {
  try {
    const [{ total }] = await db
      .select({ count: sql`count(*)` })
      .from(dailySlots);

    // Get count of rows older than 7 days
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [{ olderThan7Days }] = await db
      .select({ count: sql`count(*)` })
      .from(dailySlots)
      .where(lt(dailySlots.createdAt, sevenDaysAgo));

    return {
      total: total || 0,
      olderThan7Days: olderThan7Days || 0,
      recent: (total || 0) - (olderThan7Days || 0),
    };
  } catch (error) {
    console.error("Error getting daily_slots stats:", error.message);
    return { error: error.message };
  }
};

// Run if called directly
if (require.main === module) {
  cleanupOldDailySlots()
    .then((result) => {
      if (!result.error) {
        console.log(`\n✅ Cleanup complete: ${result.deleted} old rows deleted`);
        process.exit(0);
      } else {
        console.error(`\n❌ Cleanup failed: ${result.error}`);
        process.exit(1);
      }
    });
}

module.exports = {
  cleanupOldDailySlots,
  getDailySlotsStats,
};