/**
 * Sync Subscription Plans with Razorpay
 *
 * This script creates Razorpay plans for any subscription plans
 * that don't have razorpayMonthlyPlanId or razorpayYearlyPlanId set.
 *
 * Usage: node sync-razorpay-plans.js
 */

const db = require("./config/db");
const { subscriptionPlans } = require("./models/schema");
const { eq } = require("drizzle-orm");
const { createRazorpaySubscriptionPlan } = require("./utils/razorpay");

async function syncPlans() {
  console.log("🔄 Starting Razorpay plan sync...\n");

  try {
    // Get all active plans
    const plans = await db.select().from(subscriptionPlans);

    console.log(`Found ${plans.length} plans in database\n`);

    for (const plan of plans) {
      console.log(`Processing plan: ${plan.name}`);
      console.log(`  - Monthly Price: ₹${plan.monthlyPrice / 100}`);
      console.log(`  - Yearly Price: ₹${plan.yearlyPrice / 100}`);
      console.log(`  - Current Razorpay IDs:`);
      console.log(`    - Monthly: ${plan.razorpayMonthlyPlanId || "NOT SET"}`);
      console.log(`    - Yearly: ${plan.razorpayYearlyPlanId || "NOT SET"}`);

      const updates = {};

      // Create monthly plan if needed
      if (plan.monthlyPrice > 0 && !plan.razorpayMonthlyPlanId) {
        console.log(`  ⏳ Creating Razorpay monthly plan...`);
        const monthlyPlan = await createRazorpaySubscriptionPlan(
          `${plan.name} - Monthly`,
          plan.monthlyPrice,
          "monthly"
        );
        updates.razorpayMonthlyPlanId = monthlyPlan.id;
        console.log(`  ✅ Monthly plan created: ${monthlyPlan.id}`);
      }

      // Create yearly plan if needed
      if (plan.yearlyPrice > 0 && !plan.razorpayYearlyPlanId) {
        console.log(`  ⏳ Creating Razorpay yearly plan...`);
        const yearlyPlan = await createRazorpaySubscriptionPlan(
          `${plan.name} - Yearly`,
          plan.yearlyPrice,
          "yearly"
        );
        updates.razorpayYearlyPlanId = yearlyPlan.id;
        console.log(`  ✅ Yearly plan created: ${yearlyPlan.id}`);
      }

      // Update database if we created any plans
      if (Object.keys(updates).length > 0) {
        await db
          .update(subscriptionPlans)
          .set(updates)
          .where(eq(subscriptionPlans.id, plan.id));
        console.log(`  💾 Database updated for ${plan.name}`);
      } else {
        console.log(`  ℹ️  No updates needed for ${plan.name}`);
      }

      console.log(""); // Empty line for readability
    }

    console.log("✅ Sync completed successfully!");
    console.log("\n📊 Final Plan Status:");
    console.log("─────────────────────────────────────");

    // Show final status
    const finalPlans = await db.select().from(subscriptionPlans);
    for (const plan of finalPlans) {
      console.log(`\n${plan.name}:`);
      console.log(`  Monthly: ${plan.razorpayMonthlyPlanId || "NOT SET"}`);
      console.log(`  Yearly: ${plan.razorpayYearlyPlanId || "NOT SET"}`);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error syncing plans:", error);
    process.exit(1);
  }
}

// Run the sync
syncPlans();
