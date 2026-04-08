const db = require("./config/db");
const { providerSubscriptions, subscriptionPlans, users } = require("./models/schema");
const { eq } = require("drizzle-orm");
require("dotenv").config();

async function checkSubscription() {
  console.log("🔍 Checking subscriptions...");

  try {
    // Get all subscriptions with plan details
    const subscriptions = await db
      .select({
        id: providerSubscriptions.id,
        providerId: providerSubscriptions.providerId,
        planId: providerSubscriptions.planId,
        status: providerSubscriptions.status,
        planName: subscriptionPlans.name,
        planFeatures: subscriptionPlans.features,
      })
      .from(providerSubscriptions)
      .innerJoin(subscriptionPlans, eq(providerSubscriptions.planId, subscriptionPlans.id))
      .orderBy(providerSubscriptions.createdAt);

    console.log(`\n📊 Found ${subscriptions.length} subscriptions:\n`);

    for (const sub of subscriptions) {
      const features = sub.planFeatures ? JSON.parse(sub.planFeatures) : null;
      console.log(`ID: ${sub.id}`);
      console.log(`Provider: ${sub.providerId}`);
      console.log(`Plan: ${sub.planName}`);
      console.log(`Status: ${sub.status}`);
      console.log(`Allowed Graphs: ${features?.allowedGraphs || "none"}`);
      console.log(`---`);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

checkSubscription();
