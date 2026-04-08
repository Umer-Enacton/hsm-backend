/**
 * Update Free plan to have 5 services instead of 4
 * User wants Free plan to have max 5 services
 */

const db = require("./config/db");
const { subscriptionPlans } = require("./models/schema");
const { eq } = require("drizzle-orm");

async function fixFreePlan() {
  try {
    console.log("🔧 Updating Free plan services limit...\n");

    // Check current Free plan
    const [freePlan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.name, "Free"));

    if (!freePlan) {
      console.log("❌ Free plan not found!");
      process.exit(1);
    }

    console.log("Current Free Plan:");
    console.log(`  Max Services: ${freePlan.maxServices}`);
    console.log(`  Max Bookings: ${freePlan.maxBookingsPerMonth}`);
    console.log(`  Platform Fee: ${freePlan.platformFeePercentage}%`);

    // Update to 5 services
    await db
      .update(subscriptionPlans)
      .set({ maxServices: 5 })
      .where(eq(subscriptionPlans.name, "Free"));

    console.log("\n✅ Free plan updated!");
    console.log(`  Max Services: 5`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

fixFreePlan();
