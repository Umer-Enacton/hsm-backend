const db = require("./config/db");
const { subscriptionPlans } = require("./models/schema");
const { eq } = require("drizzle-orm");
require("dotenv").config();

async function checkPlanFeatures() {
  console.log("🔍 Checking plan features in database...\n");

  try {
    const plans = await db
      .select()
      .from(subscriptionPlans)
      .orderBy(subscriptionPlans.monthlyPrice);

    for (const plan of plans) {
      const features = plan.features ? JSON.parse(plan.features) : null;
      const allowedGraphs = features?.allowedGraphs || [];

      console.log(`\n📋 ${plan.name} Plan:`);
      console.log(`   Analytics Access: ${plan.analyticsAccess}`);
      console.log(`   Allowed Graphs: ${allowedGraphs.join(", ") || "none"}`);

      // Check what SHOULD be allowed
      const expectedGraphs = [];
      if (plan.name.toLowerCase() === "free") {
        // No analytics
      } else if (plan.name.toLowerCase() === "pro") {
        expectedGraphs.push("revenue_chart", "status_chart");
      } else if (plan.name.toLowerCase() === "premium") {
        expectedGraphs.push("revenue_chart", "status_chart", "trends", "time_patterns");
      }

      const missing = expectedGraphs.filter(g => !allowedGraphs.includes(g));
      const extra = allowedGraphs.filter(g => !expectedGraphs.includes(g));

      if (missing.length > 0) {
        console.log(`   ❌ Missing: ${missing.join(", ")}`);
      }
      if (extra.length > 0) {
        console.log(`   ⚠️  Extra (should NOT have): ${extra.join(", ")}`);
      }
      if (missing.length === 0 && extra.length === 0) {
        console.log(`   ✅ Configuration correct!`);
      }
    }

    console.log("\n\n🔧 Fixing Pro plan to remove 'trends' and 'time_patterns'...");
    await db
      .update(subscriptionPlans)
      .set({
        features: JSON.stringify({
          allowedRoutes: ["/dashboard", "/services", "/bookings", "/analytics"],
          allowedGraphs: ["revenue_chart", "status_chart"], // Pro plan - NO trends, NO time_patterns
        })
      })
      .where(eq(subscriptionPlans.name, "Pro"));

    console.log("✅ Pro plan fixed! Now has only: revenue_chart, status_chart");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

checkPlanFeatures();
