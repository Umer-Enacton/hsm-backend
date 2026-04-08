const db = require("../config/db");
const {
  providerSubscriptions,
  subscriptionPlans,
} = require("../models/schema");
const { eq, and, lte, gte, sql, desc } = require("drizzle-orm");
const { notificationTemplates } = require("./notificationHelper");

/**
 * Process trial expirations and downgrade to Free plan
 * This function should be called daily via cron job
 */
async function processTrialExpirations() {
  console.log("🔄 Starting trial expiration check...");
  const now = new Date();

  try {
    // Find all expired trials (trialEndDate has passed)
    const expiringTrials = await db
      .select({
        id: providerSubscriptions.id,
        providerId: providerSubscriptions.providerId,
        planId: providerSubscriptions.planId,
        planName: subscriptionPlans.name,
        trialEndDate: providerSubscriptions.trialEndDate,
        razorpaySubscriptionId: providerSubscriptions.razorpaySubscriptionId,
      })
      .from(providerSubscriptions)
      .innerJoin(subscriptionPlans, eq(providerSubscriptions.planId, subscriptionPlans.id))
      .where(
        and(
          eq(providerSubscriptions.status, "trial"),
          lte(providerSubscriptions.trialEndDate, now)
        )
      );

    console.log(`Found ${expiringTrials.length} expired trials`);

    if (expiringTrials.length === 0) {
      return { processed: 0, message: "No expired trials found" };
    }

    // Find the Free plan
    const [freePlan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.name, "Free"))
      .limit(1);

    if (!freePlan) {
      console.error("Error: Free plan not found in database");
      return { processed: 0, error: "Free plan not found" };
    }

    let processedCount = 0;

    // Downgrade each expired trial to Free plan
    for (const trial of expiringTrials) {
      try {
        await db
          .update(providerSubscriptions)
          .set({
            planId: freePlan.id,
            status: "active",
            trialEndDate: null,
            razorpaySubscriptionId: `free_sub_${trial.providerId}_${Date.now()}`,
            endDate: null, // Free plan has no end date
            autoRenew: false,
            cancelAtPeriodEnd: false,
          })
          .where(eq(providerSubscriptions.id, trial.id));

        // Send notification to provider
        await notificationTemplates.trialExpired(trial.providerId, trial.planName);

        console.log(`✅ Downgraded provider ${trial.providerId} from ${trial.planName} to Free plan`);
        processedCount++;
      } catch (error) {
        console.error(`❌ Error downgrading trial for provider ${trial.providerId}:`, error);
      }
    }

    console.log(`✅ Trial expiration check complete. Processed ${processedCount} trials.`);
    return {
      processed: processedCount,
      message: `Successfully downgraded ${processedCount} trials to Free plan`,
    };
  } catch (error) {
    console.error("Error processing trial expirations:", error);
    return { processed: 0, error: error.message };
  }
}

/**
 * Check for trials expiring soon (within 3 days)
 * Send reminder notifications
 */
async function checkUpcomingTrialExpirations() {
  console.log("🔄 Checking upcoming trial expirations...");
  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  try {
    const upcomingExpirations = await db
      .select({
        id: providerSubscriptions.id,
        providerId: providerSubscriptions.providerId,
        planId: providerSubscriptions.planId,
        planName: subscriptionPlans.name,
        trialEndDate: providerSubscriptions.trialEndDate,
      })
      .from(providerSubscriptions)
      .innerJoin(subscriptionPlans, eq(providerSubscriptions.planId, subscriptionPlans.id))
      .where(
        and(
          eq(providerSubscriptions.status, "trial"),
          gte(providerSubscriptions.trialEndDate, now),
          lte(providerSubscriptions.trialEndDate, threeDaysFromNow)
        )
      );

    console.log(`Found ${upcomingExpirations.length} trials expiring soon`);

    for (const trial of upcomingExpirations) {
      const daysRemaining = Math.ceil(
        (new Date(trial.trialEndDate) - now) / (1000 * 60 * 60 * 24)
      );

      // Only send notification once per day per provider
      // In production, you'd track last notification sent
      if (daysRemaining <= 1) {
        await notificationTemplates.trialExpiringTomorrow(trial.providerId, trial.planName);
      } else if (daysRemaining === 3) {
        await notificationTemplates.trialExpiringSoon(trial.providerId, trial.planName, daysRemaining);
      }
    }

    return {
      processed: upcomingExpirations.length,
      message: `Sent reminders for ${upcomingExpirations.length} upcoming expirations`,
    };
  } catch (error) {
    console.error("Error checking upcoming trial expirations:", error);
    return { processed: 0, error: error.message };
  }
}

module.exports = {
  processTrialExpirations,
  checkUpcomingTrialExpirations,
};
