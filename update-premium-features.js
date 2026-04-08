const db = require("./config/db");
const { subscriptionPlans } = require("./models/schema");
const { eq } = require("drizzle-orm");
require("dotenv").config();

async function updatePremiumFeatures() {
  console.log("🔄 Updating Premium plan features...");

  try {
    // Get current Premium plan
    const [premium] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.name, "Premium"))
      .limit(1);

    if (!premium) {
      console.log("❌ Premium plan not found!");
      return;
    }

    console.log("📋 Current Premium features:", premium.features);

    // Update with latest features including time_patterns
    const updatedFeatures = {
      allowedRoutes: ["all"],
      allowedGraphs: ["revenue_chart", "status_chart", "trends", "time_patterns"],
    };

    await db
      .update(subscriptionPlans)
      .set({ features: JSON.stringify(updatedFeatures) })
      .where(eq(subscriptionPlans.name, "Premium"));

    console.log("✅ Premium plan updated with time_patterns!");
    console.log("📋 New features:", JSON.stringify(updatedFeatures, null, 2));

    // Also update Pro plan to ensure it has correct features
    const [pro] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.name, "Pro"))
      .limit(1);

    if (pro) {
      const proFeatures = {
        allowedRoutes: ["/dashboard", "/services", "/bookings", "/analytics"],
        allowedGraphs: ["revenue_chart", "status_chart", "trends"], // No time_patterns for Pro
      };

      await db
        .update(subscriptionPlans)
        .set({ features: JSON.stringify(proFeatures) })
        .where(eq(subscriptionPlans.name, "Pro"));

      console.log("✅ Pro plan updated with trends!");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error updating plans:", error);
    process.exit(1);
  }
}

updatePremiumFeatures();
