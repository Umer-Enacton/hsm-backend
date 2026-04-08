/**
 * Seed Initial Subscription Plans
 * Run with: node seed-subscription-plans.js
 */

const db = require("./config/db");
const { subscriptionPlans } = require("./models/schema");

const plans = [
  {
    name: "Free",
    description: "Basic plan for new providers to get started",
    monthlyPrice: 0,
    yearlyPrice: 0,
    trialDays: 0,
    platformFeePercentage: 15,
    maxServices: 4,
    maxBookingsPerMonth: 100,
    maxImagesPerService: 3,
    prioritySupport: false,
    analyticsAccess: false, // No analytics access
    benefits: [
      "List up to 4 services",
      "Get up to 100 bookings per month",
      "Basic dashboard",
      "Email support",
    ],
    features: JSON.stringify({
      allowedRoutes: ["/dashboard", "/services", "/bookings"],
      allowedGraphs: [], // No charts
    }),
    isActive: true,
  },
  {
    name: "Pro",
    description: "Best for growing businesses with more features",
    monthlyPrice: 20000, // ₹200 in paise
    yearlyPrice: 240000, // ₹2400 in paise
    trialDays: 7,
    platformFeePercentage: 10,
    maxServices: 15,
    maxBookingsPerMonth: 500,
    maxImagesPerService: 7,
    prioritySupport: false,
    analyticsAccess: true,
    benefits: [
      "List up to 15 services",
      "Get up to 500 bookings per month",
      "Revenue & Status analytics",
      "Email support",
      "7-day free trial",
    ],
    features: JSON.stringify({
      allowedRoutes: ["/dashboard", "/services", "/bookings", "/analytics"],
      allowedGraphs: ["revenue_chart", "status_chart"], // No services/trends or time_patterns (Premium only)
    }),
    isActive: true,
  },
  {
    name: "Premium",
    description: "Maximum features for established businesses",
    monthlyPrice: 50000, // ₹500 in paise
    yearlyPrice: 600000, // ₹6000 in paise
    trialDays: 7,
    platformFeePercentage: 5,
    maxServices: -1, // Unlimited
    maxBookingsPerMonth: null, // Unlimited
    maxImagesPerService: 15,
    prioritySupport: true,
    analyticsAccess: true,
    benefits: [
      "Unlimited services",
      "Unlimited bookings",
      "Priority customer support",
      "Full analytics dashboard",
      "Service performance insights",
      "7-day free trial",
      "Lower platform fee (5%)",
    ],
    features: JSON.stringify({
      allowedRoutes: ["all"], // All routes
      allowedGraphs: ["revenue_chart", "status_chart", "trends", "time_patterns"], // All charts including services and time patterns
    }),
    isActive: true,
  },
];

async function seedPlans() {
  console.log("🌱 Seeding subscription plans...");

  try {
    for (const plan of plans) {
      // Check if plan already exists
      const [existing] = await db
        .select()
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.name, plan.name))
        .limit(1);

      if (existing) {
        console.log(`✓ Plan "${plan.name}" already exists, skipping...`);
        continue;
      }

      await db.insert(subscriptionPlans).values(plan);
      console.log(`✓ Created plan: ${plan.name}`);
    }

    console.log("\n✅ Subscription plans seeded successfully!");
    console.log("\n📊 Plans created:");
    console.log("  • Free - ₹0/mo (15% fee, 4 services, 100 bookings)");
    console.log("  • Pro - ₹200/mo or ₹2400/yr (10% fee, 15 services, 500 bookings, 7-day trial)");
    console.log("  • Premium - ₹500/mo or ₹6000/yr (5% fee, unlimited, 7-day trial)");

  } catch (error) {
    console.error("❌ Error seeding plans:", error);
    process.exit(1);
  }
}

// Import eq at the top
const { eq } = require("drizzle-orm");

// Run seed
seedPlans().then(() => {
  console.log("\n✅ Seed completed. You can now start the server.");
  process.exit(0);
});
