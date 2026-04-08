const db = require("../config/db");
const { razorpay } = require("../utils/razorpay");
const {
  subscriptionPlans,
  providerSubscriptions,
  subscriptionPayments,
  users,
  businessProfiles,
  bookings,
} = require("../models/schema");
const {
  eq,
  and,
  or,
  sql,
  lt,
  desc,
  ilike,
  inArray,
  count,
  gte,
  lte,
} = require("drizzle-orm");
const {
  createRazorpayCustomer,
  createRazorpaySubscription,
  createRazorpaySubscriptionPlan,
  cancelRazorpaySubscription,
  fetchRazorpaySubscription,
  fetchRazorpayCustomerByEmail,
  createPaymentLink,
  createSubscriptionLink,
} = require("../utils/razorpay");

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if a subscription payment already exists for a given Razorpay payment ID
 * @param {string} razorpayPaymentId - Razorpay payment ID
 * @returns {Promise<boolean>} True if payment exists
 */
async function subscriptionPaymentExists(razorpayPaymentId) {
  try {
    const [existing] = await db
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.razorpayPaymentId, razorpayPaymentId))
      .limit(1);
    return !!existing;
  } catch (error) {
    console.error("Error checking subscription payment:", error);
    return false;
  }
}

/**
 * Get provider's active subscription with plan details
 * @param {number} providerId - Provider user ID
 * @returns {Promise<object|null>} Subscription with plan details
 */
async function getProviderActiveSubscription(providerId) {
  try {
    const [subscription] = await db
      .select({
        id: providerSubscriptions.id,
        providerId: providerSubscriptions.providerId,
        planId: providerSubscriptions.planId,
        razorpaySubscriptionId: providerSubscriptions.razorpaySubscriptionId,
        status: providerSubscriptions.status,
        startDate: providerSubscriptions.startDate,
        endDate: providerSubscriptions.endDate,
        trialEndDate: providerSubscriptions.trialEndDate,
        billingCycle: providerSubscriptions.billingCycle,
        autoRenew: providerSubscriptions.autoRenew,
        cancelAtPeriodEnd: providerSubscriptions.cancelAtPeriodEnd,
        // Plan fields
        planName: subscriptionPlans.name,
        planDescription: subscriptionPlans.description,
        planMonthlyPrice: subscriptionPlans.monthlyPrice,
        planYearlyPrice: subscriptionPlans.yearlyPrice,
        planTrialDays: subscriptionPlans.trialDays,
        planPlatformFeePercentage: subscriptionPlans.platformFeePercentage,
        planMaxServices: subscriptionPlans.maxServices,
        planMaxBookingsPerMonth: subscriptionPlans.maxBookingsPerMonth,
        planPrioritySupport: subscriptionPlans.prioritySupport,
        planAnalyticsAccess: subscriptionPlans.analyticsAccess,
        planBenefits: subscriptionPlans.benefits,
        planFeatures: subscriptionPlans.features,
      })
      .from(providerSubscriptions)
      .innerJoin(
        subscriptionPlans,
        eq(providerSubscriptions.planId, subscriptionPlans.id),
      )
      .where(
        and(
          eq(providerSubscriptions.providerId, providerId),
          // Only return active or trial subscriptions - NOT pending_payment, expired, cancelled
          or(
            eq(providerSubscriptions.status, "active"),
            eq(providerSubscriptions.status, "trial")
          )
        )
      )
      .orderBy(desc(providerSubscriptions.createdAt))
      .limit(1);

    if (!subscription) {
      // Return default Free plan when no active subscription exists
      return {
        id: null,
        providerId: providerId,
        planId: null,
        razorpaySubscriptionId: null,
        status: "free",
        startDate: null,
        endDate: null,
        trialEndDate: null,
        billingCycle: null,
        autoRenew: false,
        cancelAtPeriodEnd: false,
        // Free plan defaults
        planName: "Free",
        planDescription: "Basic plan for new providers",
        planMonthlyPrice: 0,
        planYearlyPrice: 0,
        planTrialDays: 0,
        planPlatformFeePercentage: 15, // 15% platform fee for free plan
        planMaxServices: 4, // Up to 4 services
        planMaxBookingsPerMonth: 100, // Up to 100 bookings per month
        planPrioritySupport: false, // No priority support
        planAnalyticsAccess: false, // No analytics access
        planBenefits: [
          "List up to 4 services",
          "Get up to 100 bookings per month",
          "Email support"
        ],
        planFeatures: { // Already parsed object (not JSON string)
          allowedGraphs: [], // No analytics graphs
          maxServices: 4,
          maxBookingsPerMonth: 100,
          prioritySupport: false,
          analyticsAccess: false
        }
      };
    }

    // Parse features JSON
    return {
      ...subscription,
      planFeatures: subscription.planFeatures
        ? JSON.parse(subscription.planFeatures)
        : null,
    };
  } catch (error) {
    console.error("Error fetching provider subscription:", error);
    // Return Free plan on error too (planFeatures as object)
    return {
      id: null,
      providerId: providerId,
      status: "free",
      planName: "Free",
      planPlatformFeePercentage: 15,
      planMaxServices: 4,
      planMaxBookingsPerMonth: 100,
      planPrioritySupport: false,
      planAnalyticsAccess: false,
      planFeatures: {
        allowedGraphs: [],
        maxServices: 4,
        maxBookingsPerMonth: 100,
        prioritySupport: false,
        analyticsAccess: false
      }
    };
  }
}

/**
 * Get provider's monthly booking count
 * @param {number} providerId - Provider user ID
 * @returns {Promise<number>} Count of bookings in current month
 */
async function getMonthlyBookingCount(providerId) {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date();
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, providerId))
      .limit(1);

    if (!business) {
      return 0;
    }

    const [result] = await db
      .select({ count: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessProfileId, business.id),
          gte(bookings.bookingDate, startOfMonth),
          lte(bookings.bookingDate, endOfMonth),
          inArray(bookings.status, [
            "confirmed",
            "completed",
            "payment_pending",
          ]),
        ),
      );

    return result.count || 0;
  } catch (error) {
    console.error("Error getting monthly booking count:", error);
    return 0;
  }
}

/**
 * Calculate end date based on billing cycle
 * @param {string} billingCycle - "monthly" or "yearly"
 * @returns {Date} End date
 */
function calculateEndDate(billingCycle) {
  const endDate = new Date();
  if (billingCycle === "yearly") {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }
  return endDate;
}

// ============================================
// PROVIDER SUBSCRIPTION OPERATIONS
// ============================================

/**
 * Get current provider's subscription
 * GET /api/provider/subscription/current
 */
const getCurrentSubscription = async (req, res) => {
  try {
    const providerId = req.token.id;

    const subscription = await getProviderActiveSubscription(providerId);

    // subscription is now always returned (Free plan if no active subscription)
    const message = subscription.status === "free"
      ? "Free plan active"
      : "Subscription retrieved successfully";

    // Calculate usage stats
    const currentMonthBookings = await getMonthlyBookingCount(providerId);
    const maxBookings = subscription.planMaxBookingsPerMonth;

    // Explicitly check for null (unlimited) vs 0 (no bookings allowed)
    const hasLimit = maxBookings !== null && maxBookings > 0;
    const limitReached = hasLimit && currentMonthBookings >= maxBookings;

    res.json({
      message,
      data: {
        ...subscription,
        usage: {
          currentMonthBookings,
          maxBookings,
          remainingBookings: hasLimit
            ? Math.max(0, maxBookings - currentMonthBookings)
            : null,
          limitReached,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching current subscription:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Purchase/subscribe to a plan
 * POST /api/provider/subscription/purchase
 */
const purchaseSubscription = async (req, res) => {
  try {
    const { planId, billingCycle = "monthly", startTrial } = req.body;
    const providerId = req.token.id;

    // Validate billing cycle
    if (!["monthly", "yearly"].includes(billingCycle)) {
      return res.status(400).json({ message: "Invalid billing cycle" });
    }

    // Get plan details
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }

    if (!plan.isActive) {
      return res.status(400).json({ message: "This plan is not active" });
    }

    // Check if provider has a business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, providerId))
      .limit(1);

    if (!business) {
      return res
        .status(400)
        .json({ message: "Please create a business profile first" });
    }

    // Get price based on billing cycle
    const price =
      billingCycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;

    // FREE PLAN: Bypass Razorpay entirely
    if (price === 0) {
      // Cancel existing subscription if any
      const [existing] = await db
        .select()
        .from(providerSubscriptions)
        .where(eq(providerSubscriptions.providerId, providerId))
        .limit(1);

      if (existing) {
        // Update existing subscription
        const [updated] = await db
          .update(providerSubscriptions)
          .set({
            planId,
            status: "active",
            razorpaySubscriptionId: `free_sub_${providerId}_${Date.now()}`,
            razorpayPlanId: "free_plan",
            startDate: new Date(),
            endDate: new Date("2099-12-31"), // Indefinite
            trialEndDate: null,
            billingCycle,
            autoRenew: false,
            amountPaid: 0,
            platformFeeAtPurchase: plan.platformFeePercentage,
            originalAmount: 0,
            cancelAtPeriodEnd: false,
            updatedAt: new Date(),
          })
          .where(eq(providerSubscriptions.id, existing.id))
          .returning();
      } else {
        // Create new subscription
        const [created] = await db
          .insert(providerSubscriptions)
          .values({
            providerId,
            planId,
            status: "active",
            razorpaySubscriptionId: `free_sub_${providerId}_${Date.now()}`,
            razorpayPlanId: "free_plan",
            startDate: new Date(),
            endDate: new Date("2099-12-31"),
            trialEndDate: null,
            billingCycle,
            autoRenew: false,
            amountPaid: 0,
            platformFeeAtPurchase: plan.platformFeePercentage,
            originalAmount: 0,
          })
          .returning();
      }

      return res.json({
        message: "Free plan activated successfully",
        data: { redirectUrl: "/provider/subscription?success=free" },
      });
    }

    // PAID PLAN: Check if user wants trial or direct purchase
    // Default: startTrial=true for first-time users, false for direct "Buy Now"
    const userWantsTrial = startTrial !== false; // Default to true unless explicitly false
    const hasTrial = plan.trialDays > 0;

    // Determine if this should be a trial or direct payment
    const isInTrial = hasTrial && userWantsTrial;

    let trialEndDate = null;
    let subscriptionStatus = "active";

    if (isInTrial) {
      trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + plan.trialDays);
      subscriptionStatus = "trial";
    }

    // Calculate end date
    const endDate = calculateEndDate(billingCycle);

    // If in trial, create trial subscription and return success
    if (isInTrial) {
      const [subscription] = await db
        .insert(providerSubscriptions)
        .values({
          providerId,
          planId,
          status: subscriptionStatus,
          razorpaySubscriptionId: null, // Will be set after trial/payment
          razorpayPlanId:
            billingCycle === "monthly"
              ? plan.razorpayMonthlyPlanId
              : plan.razorpayYearlyPlanId,
          startDate: new Date(),
          endDate,
          trialEndDate,
          billingCycle,
          autoRenew: false,
          amountPaid: 0,
          platformFeeAtPurchase: plan.platformFeePercentage,
          originalAmount: price,
        })
        .returning();

      return res.json({
        message: "Trial started successfully",
        data: {
          subscription,
          redirectUrl: "/provider/subscription?success=trial",
          trialEndDate,
        },
      });
    }

    // DIRECT PURCHASE (Buy Now): Create Razorpay payment link for immediate payment
    // Payment links always have working checkout pages (unlike subscription short_urls)
    // IMPORTANT: Subscription will ONLY be created AFTER webhook confirms payment success
    // This prevents orphaned subscriptions when users abandon payment

    // Fetch provider's business profile for customer details
    const [businessProfile] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, providerId))
      .limit(1);

    // Fetch provider's email for customer creation
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, providerId))
      .limit(1);

    // Use business name as the customer name for display in checkout
    // Priority: business name > user name > fallback
    const displayName =
      businessProfile?.businessName?.trim() || user?.name || "Service Provider";

    // Log what we're using for debugging
    console.log("📋 Customer display name details:");
    console.log(
      "   Business Profile:",
      businessProfile ? "Found" : "Not found",
    );
    console.log("   Business Name:", businessProfile?.businessName || "N/A");
    console.log("   User Name:", user?.name || "N/A");
    console.log("   Using display name:", displayName);

    // Create Razorpay customer with business details (this sets the display name in checkout)
    const customer = await createRazorpayCustomer({
      name: displayName,
      email: user?.email || "provider@example.com",
      contact: businessProfile?.phone || user?.phone || "",
    });

    // Build callback URL for redirect after payment
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const callbackUrl = `${frontendUrl}/provider/subscription?success=true&plan=${plan.name}`;

    // Create a payment link for the first payment
    // This ensures we get a working checkout page
    // NOTES contain all metadata needed to create subscription after payment
    const paymentLink = await createPaymentLink(price, {
      description: `${plan.name} - ${billingCycle === "monthly" ? "Monthly" : "Yearly"} Subscription`,
      customer_id: customer.id,
      notes: {
        provider_id: providerId.toString(),
        plan_id: planId.toString(),
        billing_cycle: billingCycle,
        type: "subscription_first_payment",
        platform_fee: plan.platformFeePercentage.toString(),
      },
      expire_by: Math.floor(Date.now() / 1000) + 1800, // 30 minutes
      callback_url: callbackUrl,
      callback_method: "get",
    });

    // Check if this is a mock payment link (Razorpay not configured)
    const isMockLink =
      paymentLink.id.startsWith("mock_plink_") ||
      paymentLink.short_url?.includes("mock");

    // Return payment link checkout URL (or success for mock)
    if (isMockLink) {
      // Local development - no real checkout, create subscription directly
      const [subscription] = await db
        .insert(providerSubscriptions)
        .values({
          providerId,
          planId,
          status: "active",
          razorpaySubscriptionId: `mock_sub_${providerId}_${Date.now()}`,
          razorpayPlanId:
            billingCycle === "monthly"
              ? plan.razorpayMonthlyPlanId
              : plan.razorpayYearlyPlanId,
          startDate: new Date(),
          endDate,
          trialEndDate: null,
          billingCycle,
          autoRenew: true,
          amountPaid: price,
          platformFeeAtPurchase: plan.platformFeePercentage,
          originalAmount: price,
        })
        .returning();

      return res.json({
        message: "Subscription activated successfully (development mode)",
        data: {
          subscription: { ...subscription, status: "active" },
          redirectUrl: "/provider/subscription?success=mock",
        },
      });
    }

    // Production - redirect to Razorpay checkout via payment link
    // Webhook will create subscription after payment confirms
    res.json({
      message: "Payment link generated successfully",
      data: {
        redirectUrl: paymentLink.short_url,
        paymentLinkId: paymentLink.id,
      },
    });
  } catch (error) {
    console.error("Error purchasing subscription:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Cancel subscription
 * POST /api/provider/subscription/cancel
 */
const cancelSubscription = async (req, res) => {
  try {
    const providerId = req.token.id;

    const [subscription] = await db
      .select()
      .from(providerSubscriptions)
      .where(eq(providerSubscriptions.providerId, providerId))
      .orderBy(desc(providerSubscriptions.createdAt))
      .limit(1);

    if (!subscription) {
      return res.status(404).json({ message: "No active subscription found" });
    }

    // Check if already scheduled for cancellation
    if (subscription.cancelAtPeriodEnd) {
      return res.status(400).json({
        message: "Subscription is already scheduled for cancellation",
      });
    }

    // Check if subscription was created via payment link (payment ID instead of subscription ID)
    // Skip Razorpay API cancellation for payment link subscriptions
    const isPaymentLinkSubscription =
      subscription.razorpaySubscriptionId?.startsWith("pay_");

    // Skip Razorpay cancellation for free plans and payment link subscriptions
    if (
      subscription.razorpaySubscriptionId &&
      !subscription.razorpaySubscriptionId.startsWith("free_sub_") &&
      !subscription.razorpaySubscriptionId.startsWith("mock_sub_") &&
      !isPaymentLinkSubscription
    ) {
      await cancelRazorpaySubscription(
        subscription.razorpaySubscriptionId,
        true,
      );
    }

    // Update DB
    await db
      .update(providerSubscriptions)
      .set({
        cancelAtPeriodEnd: true,
        updatedAt: new Date(),
      })
      .where(eq(providerSubscriptions.id, subscription.id));

    res.json({
      message:
        "Subscription will be cancelled at the end of the current billing period",
    });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Toggle auto-renewal
 * POST /api/provider/subscription/toggle-auto-renew
 */
const toggleAutoRenew = async (req, res) => {
  try {
    const { enable } = req.body;
    const providerId = req.token.id;

    const [subscription] = await db
      .select()
      .from(providerSubscriptions)
      .where(eq(providerSubscriptions.providerId, providerId))
      .orderBy(desc(providerSubscriptions.createdAt))
      .limit(1);

    if (!subscription) {
      return res.status(404).json({ message: "No active subscription found" });
    }

    // Cannot toggle auto-renewal for free plans or payment link subscriptions
    const isPaymentLinkSubscription =
      subscription.razorpaySubscriptionId?.startsWith("pay_");
    if (
      !subscription.razorpaySubscriptionId ||
      subscription.razorpaySubscriptionId.startsWith("free_sub_") ||
      isPaymentLinkSubscription
    ) {
      // For payment link subscriptions and free plans, just update the DB
      await db
        .update(providerSubscriptions)
        .set({
          autoRenew: enable || false,
          cancelAtPeriodEnd: !enable,
          updatedAt: new Date(),
        })
        .where(eq(providerSubscriptions.id, subscription.id));

      return res.json({
        message: `Auto-renewal ${enable ? "enabled" : "disabled"} successfully`,
      });
    }

    // For actual Razorpay subscriptions, cancel at period end if disabling
    if (!enable && subscription.status === "active") {
      await cancelRazorpaySubscription(
        subscription.razorpaySubscriptionId,
        true,
      );
    }

    // Update DB
    await db
      .update(providerSubscriptions)
      .set({
        autoRenew: enable || false,
        cancelAtPeriodEnd: !enable,
        updatedAt: new Date(),
      })
      .where(eq(providerSubscriptions.id, subscription.id));

    res.json({
      message: `Auto-renewal ${enable ? "enabled" : "disabled"} successfully`,
    });
  } catch (error) {
    console.error("Error toggling auto-renewal:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get subscription payment history
 * GET /api/provider/subscription/payments
 */
const getPaymentHistory = async (req, res) => {
  try {
    const providerId = req.token.id;

    // Get provider's active subscription
    const [subscription] = await db
      .select()
      .from(providerSubscriptions)
      .where(eq(providerSubscriptions.providerId, providerId))
      .orderBy(desc(providerSubscriptions.createdAt))
      .limit(1);

    if (!subscription) {
      return res.json({
        message: "No subscription found",
        data: [],
      });
    }

    const payments = await db
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.providerSubscriptionId, subscription.id))
      .orderBy(desc(subscriptionPayments.paymentDate));

    res.json({
      message: "Payment history retrieved successfully",
      data: payments,
    });
  } catch (error) {
    console.error("Error fetching payment history:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ============================================
// ADMIN: Get all provider subscriptions
// GET /api/subscription/providers
// ============================================

const getAllProviderSubscriptions = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, status, planId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build where conditions
    const conditions = [];

    if (status && status !== "all") {
      conditions.push(eq(providerSubscriptions.status, status));
    }

    if (planId) {
      conditions.push(eq(providerSubscriptions.planId, planId));
    }

    if (search) {
      conditions.push(
        or(
          ilike(users.name, `%${search}%`),
          ilike(users.email, `%${search}%`),
          ilike(businessProfiles.businessName, `%${search}%`),
          ilike(providerSubscriptions.razorpaySubscriptionId, `%${search}%`),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get subscriptions with provider and plan details
    const subscriptions = await db
      .select({
        // Subscription fields
        id: providerSubscriptions.id,
        status: providerSubscriptions.status,
        startDate: providerSubscriptions.startDate,
        endDate: providerSubscriptions.endDate,
        trialEndDate: providerSubscriptions.trialEndDate,
        billingCycle: providerSubscriptions.billingCycle,
        autoRenew: providerSubscriptions.autoRenew,
        cancelAtPeriodEnd: providerSubscriptions.cancelAtPeriodEnd,
        amountPaid: providerSubscriptions.amountPaid,
        platformFeeAtPurchase: providerSubscriptions.platformFeeAtPurchase,
        razorpaySubscriptionId: providerSubscriptions.razorpaySubscriptionId,
        createdAt: providerSubscriptions.createdAt,
        // Provider details
        providerId: users.id,
        providerName: users.name,
        providerEmail: users.email,
        // Plan details
        planId: subscriptionPlans.id,
        planName: subscriptionPlans.name,
        planPlatformFeePercentage: subscriptionPlans.platformFeePercentage,
        planMonthlyPrice: subscriptionPlans.monthlyPrice,
        planYearlyPrice: subscriptionPlans.yearlyPrice,
        // Business details
        providerBusiness: businessProfiles.businessName,
      })
      .from(providerSubscriptions)
      .innerJoin(users, eq(providerSubscriptions.providerId, users.id))
      .innerJoin(
        subscriptionPlans,
        eq(providerSubscriptions.planId, subscriptionPlans.id),
      )
      .leftJoin(businessProfiles, eq(users.id, businessProfiles.providerId))
      .where(whereClause)
      .orderBy(desc(providerSubscriptions.createdAt))
      .limit(take)
      .offset(skip);

    // Get total count
    const [{ totalCount }] = await db
      .select({ totalCount: count() })
      .from(providerSubscriptions)
      .innerJoin(users, eq(providerSubscriptions.providerId, users.id))
      .innerJoin(
        subscriptionPlans,
        eq(providerSubscriptions.planId, subscriptionPlans.id),
      )
      .leftJoin(businessProfiles, eq(users.id, businessProfiles.providerId))
      .where(whereClause);

    res.json({
      message: "Subscriptions retrieved successfully",
      data: subscriptions,
      pagination: {
        total: totalCount,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching provider subscriptions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ============================================
// PLAN UPGRADE (with Prorated Calculation)
// PUT /api/subscription/upgrade
// ============================================

const upgradeSubscription = async (req, res) => {
  try {
    const { newPlanId } = req.body;
    const providerId = req.token.id;

    if (!newPlanId) {
      return res.status(400).json({ message: "New plan ID is required" });
    }

    // Get current subscription
    const [currentSub] = await db
      .select()
      .from(providerSubscriptions)
      .where(eq(providerSubscriptions.providerId, providerId))
      .orderBy(desc(providerSubscriptions.createdAt))
      .limit(1);

    if (!currentSub) {
      return res.status(404).json({ message: "No active subscription found" });
    }

    // Check if already on this plan
    if (currentSub.planId === newPlanId) {
      return res
        .status(400)
        .json({ message: "Already subscribed to this plan" });
    }

    // Get current plan details
    const [currentPlan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, currentSub.planId))
      .limit(1);

    if (!currentPlan) {
      return res.status(404).json({ message: "Current plan not found" });
    }

    // Get new plan details
    const [newPlan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, newPlanId))
      .limit(1);

    if (!newPlan) {
      return res.status(404).json({ message: "New plan not found" });
    }

    // Determine which billing cycle to use (monthly or yearly)
    const billingCycle = currentSub.billingCycle || "monthly";

    // Get prices based on billing cycle
    const currentPrice =
      billingCycle === "yearly"
        ? currentPlan.yearlyPrice
        : currentPlan.monthlyPrice;
    const newPrice =
      billingCycle === "yearly" ? newPlan.yearlyPrice : newPlan.monthlyPrice;

    // If upgrading from free plan, full price applies
    if (currentPrice === 0) {
      // Create payment link for full amount
      const {
        createPaymentLink,
        createRazorpayCustomer,
      } = require("../utils/razorpay");

      // Get provider details
      const [business] = await db
        .select()
        .from(businessProfiles)
        .where(eq(businessProfiles.providerId, providerId))
        .limit(1);

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, providerId))
        .limit(1);

      const displayName =
        business?.businessName?.trim() || user?.name || "Service Provider";

      const customer = await createRazorpayCustomer({
        name: displayName,
        email: user?.email || "provider@example.com",
        contact: business?.phone || user?.phone || "",
      });

      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const callbackUrl = `${frontendUrl}/provider/subscription?success=upgrade&plan=${newPlan.name}`;

      const paymentLink = await createPaymentLink(newPrice, {
        description: `${newPlan.name} - ${billingCycle === "monthly" ? "Monthly" : "Yearly"} Subscription (Upgrade from Free)`,
        customer_id: customer.id,
        notes: {
          provider_id: providerId.toString(),
          plan_id: newPlanId.toString(),
          billing_cycle: billingCycle,
          platform_fee: newPlan.platformFeePercentage.toString(),
          type: "subscription_upgrade",
          from_plan_id: currentSub.planId.toString(),
        },
        expire_by: Math.floor(Date.now() / 1000) + 1800,
        callback_url: callbackUrl,
        callback_method: "get",
      });

      return res.json({
        message: "Payment link generated for plan upgrade",
        data: {
          redirectUrl: paymentLink.short_url,
          paymentLinkId: paymentLink.id,
          amount: newPrice,
          requiresPayment: true,
        },
      });
    }

    // Calculate proration for paid plans
    const now = new Date();
    const startDate = currentSub.startDate
      ? new Date(currentSub.startDate)
      : now;
    const endDate = currentSub.endDate ? new Date(currentSub.endDate) : now;

    // Calculate total days in billing cycle
    const totalDaysInCycle = Math.ceil(
      (endDate - startDate) / (1000 * 60 * 60 * 24),
    );

    // Calculate remaining days in current cycle
    const remainingDays = Math.max(
      0,
      Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)),
    );

    // Calculate daily rates
    const currentDailyRate = currentPrice / totalDaysInCycle;
    const newDailyRate = newPrice / totalDaysInCycle;

    // Calculate prorated amounts
    const refundAmount = Math.round(currentDailyRate * remainingDays); // Unused portion of current plan
    const chargeAmount = Math.round(newDailyRate * remainingDays); // Cost of new plan for remaining days
    const netAmount = chargeAmount - refundAmount; // Amount user needs to pay

    console.log("💰 Proration calculation:", {
      currentPlan: currentPlan.name,
      newPlan: newPlan.name,
      currentPrice,
      newPrice,
      totalDaysInCycle,
      remainingDays,
      currentDailyRate,
      newDailyRate,
      refundAmount,
      chargeAmount,
      netAmount,
    });

    // If net amount is zero or negative (downgrade), just update the plan
    if (netAmount <= 0) {
      const [updated] = await db
        .update(providerSubscriptions)
        .set({
          planId: newPlanId,
          platformFeeAtPurchase: newPlan.platformFeePercentage,
          originalAmount: currentSub.originalAmount, // Keep original amount
          updatedAt: new Date(),
        })
        .where(eq(providerSubscriptions.id, currentSub.id))
        .returning();

      const { notificationTemplates } = require("../utils/notificationHelper");
      await notificationTemplates.planUpgraded(providerId, newPlan.name);

      return res.json({
        message: "Plan downgraded successfully",
        data: {
          previousPlan: currentPlan.name,
          newPlan: newPlan.name,
          billingCycle,
          refundAmount: Math.abs(netAmount),
        },
      });
    }

    // Create payment link for the prorated difference
    const {
      createPaymentLink,
      createRazorpayCustomer,
    } = require("../utils/razorpay");

    // Get provider details
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, providerId))
      .limit(1);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, providerId))
      .limit(1);

    const displayName =
      business?.businessName?.trim() || user?.name || "Service Provider";

    const customer = await createRazorpayCustomer({
      name: displayName,
      email: user?.email || "provider@example.com",
      contact: business?.phone || user?.phone || "",
    });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const callbackUrl = `${frontendUrl}/provider/subscription?success=upgrade&plan=${newPlan.name}`;

    const paymentLink = await createPaymentLink(netAmount, {
      description: `Upgrade from ${currentPlan.name} to ${newPlan.name} (${remainingDays} days remaining)`,
      customer_id: customer.id,
      notes: {
        provider_id: providerId.toString(),
        plan_id: newPlanId.toString(),
        billing_cycle: billingCycle,
        platform_fee: newPlan.platformFeePercentage.toString(),
        type: "subscription_upgrade",
        from_plan_id: currentSub.planId.toString(),
        subscription_id: currentSub.id.toString(),
        remaining_days: remainingDays.toString(),
        proration: JSON.stringify({
          refundAmount,
          chargeAmount,
          netAmount,
          remainingDays,
        }),
      },
      expire_by: Math.floor(Date.now() / 1000) + 1800,
      callback_url: callbackUrl,
      callback_method: "get",
    });

    // Check if mock payment link
    const isMockLink =
      paymentLink.id.startsWith("mock_plink_") ||
      paymentLink.short_url?.includes("mock");

    if (isMockLink) {
      // Development mode - update immediately
      const [updated] = await db
        .update(providerSubscriptions)
        .set({
          planId: newPlanId,
          platformFeeAtPurchase: newPlan.platformFeePercentage,
          originalAmount: currentSub.originalAmount + netAmount,
          amountPaid: (currentSub.amountPaid || 0) + netAmount,
          updatedAt: new Date(),
        })
        .where(eq(providerSubscriptions.id, currentSub.id))
        .returning();

      const { notificationTemplates } = require("../utils/notificationHelper");
      await notificationTemplates.planUpgraded(providerId, newPlan.name);

      return res.json({
        message: "Plan upgraded successfully (development mode)",
        data: {
          previousPlan: currentPlan.name,
          newPlan: newPlan.name,
          billingCycle,
          proration: { refundAmount, chargeAmount, netAmount, remainingDays },
        },
      });
    }

    // Production - return payment link
    res.json({
      message: "Payment link generated for plan upgrade",
      data: {
        redirectUrl: paymentLink.short_url,
        paymentLinkId: paymentLink.id,
        amount: netAmount,
        requiresPayment: true,
        proration: {
          previousPlan: currentPlan.name,
          newPlan: newPlan.name,
          refundAmount: `₹${refundAmount / 100}`,
          chargeAmount: `₹${chargeAmount / 100}`,
          netAmount: `₹${netAmount / 100}`,
          remainingDays,
        },
      },
    });
  } catch (error) {
    console.error("Error upgrading subscription:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ============================================
// WEBHOOK HANDLER
// POST /api/subscription/webhook
// ============================================

const handleWebhook = async (req, res) => {
  try {
    const { verifyWebhookSignature } = require("../utils/razorpay");
    const signature = req.headers["x-razorpay-signature"];
    const body = JSON.stringify(req.body);

    // Verify webhook signature
    const isValid = verifyWebhookSignature(body, signature);
    if (!isValid) {
      console.error("❌ Invalid webhook signature");
      return res.status(400).json({ message: "Invalid signature" });
    }

    const event = req.body;
    const eventType = event.event;

    console.log("🔔 Razorpay Webhook received:", eventType);
    console.log("📋 Full event payload:", JSON.stringify(event, null, 2));

    // ============================================
    // HANDLE SUBSCRIPTION LIFECYCLE EVENTS
    // ============================================
    const subscriptionEvents = [
      "subscription.authorized",
      "subscription.charged",
      "subscription.completed",
      "subscription.cancelled",
      "subscription.paused",
      "subscription.resumed",
      "subscription.pending",
    ];

    if (subscriptionEvents.includes(eventType)) {
      await handleSubscriptionWebhook(event, eventType);
      return res.json({ status: "ok" });
    }

    // ============================================
    // HANDLE PAYMENT LINK EVENTS (Legacy)
    // ============================================
    // Extract payment entity from different event structures
    let paymentEntity = null;
    let notes = {};

    if (eventType === "payment_link.paid") {
      // payment_link.paid event structure
      paymentEntity = event.payload?.payment?.entity;
      notes = paymentEntity?.notes || {};
      console.log("💰 Payment link paid - Payment ID:", paymentEntity?.id);
      console.log("📝 Notes from payment:", JSON.stringify(notes));
    } else if (eventType === "payment.captured") {
      // payment.captured event structure
      paymentEntity = event.payload?.payment?.entity || event.payload;
      notes = paymentEntity?.notes || {};
      console.log("💰 Payment captured - Payment ID:", paymentEntity?.id);
      console.log("📝 Notes from payment:", JSON.stringify(notes));
    } else {
      // Unknown event type - log and acknowledge
      console.log(`ℹ️  Unhandled webhook event: ${eventType}`);
      return res.json({ status: "ok" });
    }

    if (!paymentEntity) {
      console.error("❌ No payment entity found in webhook");
      return res.json({ status: "ok" });
    }

    const paymentId = paymentEntity.id;
    const subscriptionId = notes.subscription_id;
    const paymentType = notes.type;

    console.log(
      "💳 Processing payment:",
      paymentId,
      "type:",
      paymentType,
      "subscriptionId:",
      subscriptionId,
    );

    switch (eventType) {
      case "payment.captured":
      case "payment_link.paid": {
        // Payment successful from payment link - create/activate subscription
        // Razorpay webhook structure: payload.payment.entity contains payment details

        if (paymentType === "subscription_upgrade") {
          // UPGRADE FLOW: Update existing subscription to new plan
          const providerId = parseInt(notes.provider_id);
          const planId = parseInt(notes.plan_id);
          const fromPlanId = parseInt(notes.from_plan_id);
          const existingSubscriptionId = notes.subscription_id;
          const billingCycle = notes.billing_cycle || "monthly";
          const platformFee = parseInt(notes.platform_fee) || 15;

          console.log(
            "📈 Processing subscription upgrade for provider:",
            providerId,
            "from plan:",
            fromPlanId,
            "to plan:",
            planId,
          );

          if (!providerId || !planId) {
            console.error(
              "❌ Missing required metadata in upgrade payment notes:",
              notes,
            );
            break;
          }

          // Get the subscription to update
          let subscription;
          if (existingSubscriptionId) {
            [subscription] = await db
              .select()
              .from(providerSubscriptions)
              .where(eq(providerSubscriptions.id, existingSubscriptionId))
              .limit(1);
          } else {
            // Fallback to finding by provider
            [subscription] = await db
              .select()
              .from(providerSubscriptions)
              .where(eq(providerSubscriptions.providerId, providerId))
              .orderBy(desc(providerSubscriptions.createdAt))
              .limit(1);
          }

          if (!subscription) {
            console.error("❌ Subscription not found for upgrade");
            break;
          }

          // Get plan details
          const [plan] = await db
            .select()
            .from(subscriptionPlans)
            .where(eq(subscriptionPlans.id, planId))
            .limit(1);

          if (!plan) {
            console.error("❌ Target plan not found:", planId);
            break;
          }

          // Update subscription to new plan
          const [updated] = await db
            .update(providerSubscriptions)
            .set({
              planId,
              platformFeeAtPurchase: platformFee,
              amountPaid:
                (subscription.amountPaid || 0) + (paymentEntity.amount || 0),
              updatedAt: new Date(),
            })
            .where(eq(providerSubscriptions.id, subscription.id))
            .returning();

          // Record payment (check for duplicates first)
          const paymentExists = await subscriptionPaymentExists(paymentId);
          if (!paymentExists) {
            await db.insert(subscriptionPayments).values({
              providerSubscriptionId: subscription.id,
              razorpayPaymentId: paymentId,
              amount: paymentEntity.amount || 0,
              status: "captured",
              paymentDate: new Date(),
            });
            console.log("✅ Upgrade payment recorded:", paymentId);
          } else {
            console.log(
              "⚠️  Upgrade payment already exists, skipping:",
              paymentId,
            );
          }

          console.log(
            "✅ Subscription upgraded:",
            subscription.id,
            "to plan:",
            plan.name,
          );
        } else if (
          paymentType === "subscription_first_payment" ||
          paymentType === "subscription_payment"
        ) {
          // NEW FLOW: Create subscription from payment link notes
          // This happens when user completes payment for a new subscription
          const providerId = parseInt(notes.provider_id);
          const planId = parseInt(notes.plan_id);
          const billingCycle = notes.billing_cycle || "monthly";
          const platformFee = parseInt(notes.platform_fee) || 15;
          const setupAutoRenew = notes.setup_auto_renew === "true"; // Flag to create Razorpay subscription

          console.log(
            "🆕 Creating new subscription for provider:",
            providerId,
            "plan:",
            planId,
            "autoRenew:",
            setupAutoRenew,
          );

          if (!providerId || !planId) {
            console.error(
              "❌ Missing required metadata in payment notes:",
              notes,
            );
            break;
          }

          // Check if there's a local subscription already created (from purchaseSubscriptionWithRazorpay)
          const localSubscriptionId = notes.local_subscription_id
            ? parseInt(notes.local_subscription_id)
            : null;

          // Get plan details
          const [plan] = await db
            .select()
            .from(subscriptionPlans)
            .where(eq(subscriptionPlans.id, planId))
            .limit(1);

          if (!plan) {
            console.error("❌ Plan not found:", planId);
            break;
          }

          // Calculate end date
          const endDate = calculateEndDate(billingCycle);
          const price =
            billingCycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;

          let newSubscription;

          if (localSubscriptionId) {
            // Update existing local subscription (created during purchase)
            console.log(
              "🔄 Updating existing local subscription:",
              localSubscriptionId,
            );
            [newSubscription] = await db
              .update(providerSubscriptions)
              .set({
                status: "active",
                razorpaySubscriptionId: paymentId, // Temporary: using payment ID
                startDate: new Date(),
                endDate,
                billingCycle,
                autoRenew: setupAutoRenew, // Will be updated after creating Razorpay subscription
                amountPaid: paymentEntity.amount || price,
                originalAmount: price,
                updatedAt: new Date(),
              })
              .where(eq(providerSubscriptions.id, localSubscriptionId))
              .returning();
          } else {
            // Check if provider already has an active subscription (avoid duplicates)
            const [existingSub] = await db
              .select()
              .from(providerSubscriptions)
              .where(eq(providerSubscriptions.providerId, providerId))
              .orderBy(desc(providerSubscriptions.createdAt))
              .limit(1);

            if (existingSub && existingSub.status === "active") {
              // Update existing subscription (upgrade/change plan)
              console.log("🔄 Updating existing subscription:", existingSub.id);
              [newSubscription] = await db
                .update(providerSubscriptions)
                .set({
                  planId,
                  status: "active",
                  razorpaySubscriptionId: paymentId,
                  startDate: new Date(),
                  endDate,
                  billingCycle,
                  autoRenew: setupAutoRenew,
                  amountPaid:
                    (existingSub.amountPaid || 0) +
                    (paymentEntity.amount || price),
                  platformFeeAtPurchase: platformFee,
                  originalAmount: price,
                  cancelAtPeriodEnd: false,
                  updatedAt: new Date(),
                })
                .where(eq(providerSubscriptions.id, existingSub.id))
                .returning();
            } else {
              // Create new subscription
              console.log("➕ Creating new subscription");
              [newSubscription] = await db
                .insert(providerSubscriptions)
                .values({
                  providerId,
                  planId,
                  status: "active",
                  razorpaySubscriptionId: paymentId,
                  razorpayPlanId: null, // Will be set up if autoRenew is true
                  startDate: new Date(),
                  endDate,
                  trialEndDate: null,
                  billingCycle,
                  autoRenew: setupAutoRenew,
                  amountPaid: paymentEntity.amount || price,
                  platformFeeAtPurchase: platformFee,
                  originalAmount: price,
                  cancelAtPeriodEnd: false,
                })
                .returning();
            }
          }

          // Record payment (check for duplicates first)
          const paymentExists = await subscriptionPaymentExists(paymentId);
          if (!paymentExists) {
            await db.insert(subscriptionPayments).values({
              providerSubscriptionId: newSubscription.id,
              razorpayPaymentId: paymentId,
              amount: paymentEntity.amount || price,
              status: "captured",
              paymentDate: new Date(),
            });
            console.log("✅ Subscription payment recorded:", paymentId);
          } else {
            console.log(
              "⚠️  Subscription payment already exists, skipping:",
              paymentId,
            );
          }

          // ============================================
          // SET UP AUTO-RENEWAL WITH RAZORPAY SUBSCRIPTION
          // ============================================
          if (setupAutoRenew && price > 0) {
            console.log(
              "🔄 Setting up Razorpay subscription for auto-renewal...",
            );

            try {
              // Get provider details for customer creation
              const [user] = await db
                .select()
                .from(users)
                .where(eq(users.id, providerId))
                .limit(1);

              const [business] = await db
                .select()
                .from(businessProfiles)
                .where(eq(businessProfiles.providerId, providerId))
                .limit(1);

              const displayName =
                business?.businessName?.trim() ||
                user?.name ||
                "Service Provider";

              // Get or create Razorpay customer
              let customerId = notes.razorpay_customer_id;
              if (!customerId) {
                const customer = await createRazorpayCustomer({
                  name: displayName,
                  email: user?.email || "provider@example.com",
                  contact: business?.phone || user?.phone || "",
                });
                customerId = customer.id;
              }

              // Get or create Razorpay plan
              let razorpayPlanId;
              if (billingCycle === "monthly") {
                razorpayPlanId = plan.razorpayMonthlyPlanId;
              } else {
                razorpayPlanId = plan.razorpayYearlyPlanId;
              }

              // If no Razorpay plan exists, create one
              if (!razorpayPlanId || razorpayPlanId.startsWith("mock_")) {
                console.log("📋 Creating new Razorpay plan...");
                const {
                  createRazorpaySubscriptionPlan,
                } = require("../utils/razorpay");
                const interval =
                  billingCycle === "monthly" ? "monthly" : "yearly";
                const newPlan = await createRazorpaySubscriptionPlan(
                  `${plan.name} - ${billingCycle}`,
                  price,
                  interval,
                );

                razorpayPlanId = newPlan.id;

                // Update plan in database
                const updateField =
                  billingCycle === "monthly"
                    ? "razorpayMonthlyPlanId"
                    : "razorpayYearlyPlanId";
                await db
                  .update(subscriptionPlans)
                  .set({ [updateField]: razorpayPlanId })
                  .where(eq(subscriptionPlans.id, planId));

                console.log(
                  "✅ Razorpay plan created and saved:",
                  razorpayPlanId,
                );
              }

              // Create Razorpay subscription for NEXT billing cycle
              // total_count: 11 (since we already charged for first month manually)
              const totalCount = billingCycle === "monthly" ? 11 : 1;
              const startAt = Math.floor(endDate.getTime() / 1000); // Start when current period ends

              const razorpaySubscription = await createRazorpaySubscription(
                razorpayPlanId,
                totalCount,
                {
                  customer_id: customerId,
                  notes: {
                    provider_id: providerId.toString(),
                    plan_id: planId.toString(),
                    billing_cycle: billingCycle,
                    platform_fee: platformFee.toString(),
                    local_subscription_id: newSubscription.id.toString(),
                  },
                  start_at: startAt, // Start billing at the end of current period
                },
              );

              if (razorpaySubscription && razorpaySubscription.id) {
                console.log(
                  "✅ Razorpay subscription created for auto-renewal:",
                  razorpaySubscription.id,
                );

                // Update local subscription with Razorpay subscription ID
                await db
                  .update(providerSubscriptions)
                  .set({
                    razorpaySubscriptionId: razorpaySubscription.id,
                    razorpayPlanId: razorpayPlanId,
                  })
                  .where(eq(providerSubscriptions.id, newSubscription.id));

                console.log(
                  "✅ Local subscription updated with Razorpay subscription ID",
                );
              }
            } catch (error) {
              console.error(
                "⚠️ Failed to set up Razorpay auto-renewal:",
                error,
              );
              // Don't fail the payment if auto-renewal setup fails
              // Subscription is still active, just won't auto-renew
            }
          }

          console.log(
            "✅ Subscription created/activated:",
            newSubscription.id,
            "for provider:",
            providerId,
          );
        } else if (subscriptionId) {
          // LEGACY FLOW: Update existing subscription by internal subscription ID
          const [existingSub] = await db
            .select()
            .from(providerSubscriptions)
            .where(eq(providerSubscriptions.id, subscriptionId))
            .limit(1);

          if (existingSub) {
            // Update subscription status to active
            await db
              .update(providerSubscriptions)
              .set({
                status: "active",
                amountPaid: paymentEntity.amount || existingSub.originalAmount,
                updatedAt: new Date(),
              })
              .where(eq(providerSubscriptions.id, subscriptionId));

            // Record payment
            await db.insert(subscriptionPayments).values({
              providerSubscriptionId: subscriptionId,
              razorpayPaymentId: paymentId,
              amount: paymentEntity.amount || existingSub.originalAmount,
              status: "captured",
              paymentDate: new Date(),
            });

            console.log("✅ Subscription activated:", subscriptionId);
          } else {
            console.warn("⚠️ Subscription not found for ID:", subscriptionId);
          }
        } else {
          console.warn(
            "⚠️ No subscription_id or subscription_payment/subscription_first_payment type in payment notes:",
            notes,
          );
        }

        break;
      }

      case "subscription.activated":
      case "subscription.charged": {
        // Payment successful, activate subscription
        const subscriptionId = payload.notes?.subscription_id;
        const razorpaySubId = payload.id;

        if (subscriptionId) {
          // Update by our internal subscription ID from notes
          await db
            .update(providerSubscriptions)
            .set({
              status: "active",
              razorpaySubscriptionId: razorpaySubId,
              updatedAt: new Date(),
            })
            .where(eq(providerSubscriptions.id, subscriptionId));
        } else {
          // Fallback: try to find by razorpaySubscriptionId if already set
          const [existingSub] = await db
            .select()
            .from(providerSubscriptions)
            .where(
              eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubId),
            )
            .limit(1);

          if (existingSub) {
            await db
              .update(providerSubscriptions)
              .set({
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(providerSubscriptions.id, existingSub.id));
          }
        }

        // Record payment
        if (eventType === "subscription.charged") {
          const [subscription] = await db
            .select()
            .from(providerSubscriptions)
            .where(
              eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubId),
            )
            .limit(1);

          if (subscription) {
            await db.insert(subscriptionPayments).values({
              providerSubscriptionId: subscription.id,
              razorpayPaymentId: payload.payment_id,
              amount: payload.amount,
              status: "captured",
              paymentDate: new Date(),
            });
          }
        }

        break;
      }

      case "subscription.completed": {
        // Subscription ended (all cycles completed)
        const razorpaySubId = payload.id;

        await db
          .update(providerSubscriptions)
          .set({
            status: "completed",
            endDate: new Date(payload.current_end * 1000),
            updatedAt: new Date(),
          })
          .where(
            eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubId),
          );

        break;
      }

      case "subscription.cancelled": {
        // Subscription cancelled
        const razorpaySubId = payload.id;

        await db
          .update(providerSubscriptions)
          .set({
            status: "cancelled",
            endDate: new Date(payload.current_end * 1000),
            cancelledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubId),
          );

        break;
      }

      case "subscription.paused": {
        // Subscription paused (usually due to payment failure)
        const razorpaySubId = payload.id;

        const [subscription] = await db
          .select()
          .from(providerSubscriptions)
          .where(
            eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubId),
          )
          .limit(1);

        if (subscription && subscription.status === "trial") {
          // Trial subscription paused - downgrade to Free plan
          const [freePlan] = await db
            .select()
            .from(subscriptionPlans)
            .where(eq(subscriptionPlans.name, "Free"))
            .limit(1);

          if (freePlan) {
            await db
              .update(providerSubscriptions)
              .set({
                planId: freePlan.id,
                status: "active",
                trialEndDate: null,
                razorpaySubscriptionId: `free_sub_${subscription.providerId}_${Date.now()}`,
                endDate: null,
                autoRenew: false,
                cancelAtPeriodEnd: false,
                updatedAt: new Date(),
              })
              .where(eq(providerSubscriptions.id, subscription.id));

            // Send notification
            const {
              notificationTemplates,
            } = require("../utils/notificationHelper");
            await notificationTemplates.trialExpired(
              subscription.providerId,
              subscription.planName,
            );
          }
        } else {
          await db
            .update(providerSubscriptions)
            .set({
              status: "cancelled", // Use valid enum value instead of "paused"
              updatedAt: new Date(),
            })
            .where(
              eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubId),
            );
        }

        break;
      }

      case "payment.failed": {
        // Payment failed - check if it's a trial and downgrade to Free
        // Razorpay webhook structure: payload.payment.entity contains payment details
        const paymentEntity = event.payload?.payment?.entity || payload;
        const notes = paymentEntity.notes || {};
        const subscriptionId = notes.subscription_id;
        const paymentType = notes.type;
        const razorpaySubId =
          paymentEntity.subscription_id ||
          paymentEntity.razorpay_payment_id?.subscription_id;

        console.log(
          "❌ Payment failed for subscription:",
          subscriptionId || razorpaySubId,
          "type:",
          paymentType,
        );

        // NEW FLOW: If this is a first_payment failure, no subscription exists yet
        // Just log it - user can try again
        if (
          (paymentType === "subscription_first_payment" ||
            paymentType === "subscription_payment") &&
          !subscriptionId
        ) {
          console.log(
            "ℹ️ Subscription payment failed - no subscription to cancel. User can retry.",
          );
          break;
        }

        // LEGACY FLOW: Try to find existing subscription
        let subscription = null;
        if (subscriptionId) {
          [subscription] = await db
            .select()
            .from(providerSubscriptions)
            .where(eq(providerSubscriptions.id, subscriptionId))
            .limit(1);
        }

        // Fallback: try to find by razorpaySubscriptionId
        if (!subscription && razorpaySubId) {
          [subscription] = await db
            .select()
            .from(providerSubscriptions)
            .where(
              eq(providerSubscriptions.razorpaySubscriptionId, razorpaySubId),
            )
            .limit(1);
        }

        if (subscription) {
          if (subscription.status === "trial") {
            // Trial payment failed - downgrade to Free plan
            const [freePlan] = await db
              .select()
              .from(subscriptionPlans)
              .where(eq(subscriptionPlans.name, "Free"))
              .limit(1);

            if (freePlan) {
              await db
                .update(providerSubscriptions)
                .set({
                  planId: freePlan.id,
                  status: "active",
                  trialEndDate: null,
                  razorpaySubscriptionId: `free_sub_${subscription.providerId}_${Date.now()}`,
                  endDate: null,
                  autoRenew: false,
                  cancelAtPeriodEnd: false,
                  updatedAt: new Date(),
                })
                .where(eq(providerSubscriptions.id, subscription.id));

              // Send notification
              const {
                notificationTemplates,
              } = require("../utils/notificationHelper");
              await notificationTemplates.trialExpired(
                subscription.providerId,
                subscription.planName,
              );
            }
          } else {
            // Regular subscription payment failed - mark as cancelled
            await db
              .update(providerSubscriptions)
              .set({
                status: "cancelled",
                updatedAt: new Date(),
              })
              .where(eq(providerSubscriptions.id, subscription.id));
          }
        } else {
          console.warn("⚠️ Subscription not found for failed payment");
        }

        break;
      }

      default: {
        // Unknown event - acknowledge but log it
        console.log(`ℹ️  Unhandled webhook event: ${eventType}`);
        break;
      }
    }

    // Always acknowledge webhook receipt
    res.json({ status: "ok" });
  } catch (error) {
    console.error("Error handling webhook:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ============================================
// RAZORPAY SUBSCRIPTION API (PRODUCTION)
// ============================================

/**
 * Purchase subscription using Razorpay Subscription API (auto-recurring)
 * This creates a REAL Razorpay subscription that auto-renews
 * POST /api/provider/subscription/purchase-razorpay
 */
const purchaseSubscriptionWithRazorpay = async (req, res) => {
  try {
    const { planId, billingCycle = "monthly" } = req.body;
    const providerId = req.token.id;

    console.log(
      "🛒 Starting Subscription purchase (Payment Link approach) - provider:",
      providerId,
      "plan:",
      planId,
      "cycle:",
      billingCycle,
    );

    // Validate billing cycle
    if (!["monthly", "yearly"].includes(billingCycle)) {
      return res.status(400).json({ message: "Invalid billing cycle" });
    }

    // Get plan details
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }

    if (!plan.isActive) {
      return res.status(400).json({ message: "This plan is not active" });
    }

    // Check if provider has a business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, providerId))
      .limit(1);

    if (!business) {
      return res
        .status(400)
        .json({ message: "Please create a business profile first" });
    }

    // Get price based on billing cycle
    const price =
      billingCycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;

    // FREE PLAN: Bypass Razorpay
    if (price === 0) {
      const endDate = new Date("2099-12-31");
      const [subscription] = await db
        .insert(providerSubscriptions)
        .values({
          providerId,
          planId,
          status: "active",
          razorpaySubscriptionId: `free_sub_${providerId}_${Date.now()}`,
          razorpayPlanId: "free_plan",
          startDate: new Date(),
          endDate,
          billingCycle,
          autoRenew: false,
          amountPaid: 0,
          platformFeeAtPurchase: plan.platformFeePercentage,
          originalAmount: 0,
        })
        .returning();

      return res.json({
        message: "Free plan activated",
        data: {
          subscription,
          redirectUrl: "/provider/subscription?success=free",
        },
      });
    }

    // ============================================
    // PAYMENT LINK APPROACH (Most Reliable)
    // ============================================
    // Payment Links work reliably with UPI, cards, netbanking, etc.
    // Webhook will handle subscription creation and auto-renewal setup

    // Get provider details for customer creation
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, providerId))
      .limit(1);

    const displayName =
      business?.businessName?.trim() || user?.name || "Service Provider";

    // Create Razorpay Customer
    console.log("👤 Creating Razorpay customer...");
    const customer = await createRazorpayCustomer({
      name: displayName,
      email: user?.email || "provider@example.com",
      contact: business?.phone || user?.phone || "",
    });

    // Calculate end date
    const endDate = calculateEndDate(billingCycle);

    // Build callback URL for redirect after payment
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const callbackUrl = `${frontendUrl}/provider/subscription?success=true`;

    // Create payment link (full amount charged immediately)
    const paymentLink = await createPaymentLink(price, {
      description: `${plan.name} - ${billingCycle === "monthly" ? "Monthly" : "Yearly"} Subscription`,
      customer_id: customer.id,
      notes: {
        provider_id: providerId.toString(),
        plan_id: planId.toString(),
        billing_cycle: billingCycle,
        platform_fee: plan.platformFeePercentage.toString(),
        type: "subscription_payment",
        setup_auto_renew: "true", // Flag to set up Razorpay subscription after payment
      },
      expire_by: Math.floor(Date.now() / 1000) + 1800, // 30 minutes
      callback_url: callbackUrl,
      callback_method: "get",
    });

    console.log("💳 Payment link created:", paymentLink.short_url);

    // Return payment link URL (full amount charged immediately!)
    res.json({
      message:
        "Payment link generated. Please complete payment to activate your subscription.",
      data: {
        redirectUrl: paymentLink.short_url,
        paymentLinkId: paymentLink.id,
        amount: price,
      },
    });
  } catch (error) {
    console.error("Error purchasing subscription:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Purchase subscription using Razorpay Subscription Links API
 * This generates a hosted Razorpay page for subscription authorization
 * POST /api/provider/subscription/purchase-link
 */
const purchaseSubscriptionWithLink = async (req, res) => {
  try {
    const { planId, billingCycle = "monthly" } = req.body;
    const providerId = req.token.id;

    console.log(
      "🔗 Starting Subscription Link purchase - provider:",
      providerId,
      "plan:",
      planId,
      "cycle:",
      billingCycle,
    );

    // Validate billing cycle
    if (!["monthly", "yearly"].includes(billingCycle)) {
      return res.status(400).json({ message: "Invalid billing cycle" });
    }

    // Get plan details
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }

    if (!plan.isActive) {
      return res.status(400).json({ message: "This plan is not active" });
    }

    // Check if provider has a business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, providerId))
      .limit(1);

    if (!business) {
      return res
        .status(400)
        .json({ message: "Please create a business profile first" });
    }

    // Get price based on billing cycle
    const price =
      billingCycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;

    // FREE PLAN: Bypass Razorpay
    if (price === 0) {
      const endDate = new Date("2099-12-31");
      const [subscription] = await db
        .insert(providerSubscriptions)
        .values({
          providerId,
          planId,
          status: "active",
          razorpaySubscriptionId: `free_sub_${providerId}_${Date.now()}`,
          razorpayPlanId: "free_plan",
          startDate: new Date(),
          endDate,
          billingCycle,
          autoRenew: false,
          amountPaid: 0,
          platformFeeAtPurchase: plan.platformFeePercentage,
          originalAmount: 0,
        })
        .returning();

      return res.json({
        message: "Free plan activated",
        data: {
          subscription,
          redirectUrl: "/provider/subscription?success=free",
        },
      });
    }

    // Get provider details for notes (to store correct user info after webhook)
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, providerId))
      .limit(1);

    const displayName =
      business?.businessName?.trim() || user?.name || "Service Provider";

    // DON'T create customer before subscription - it breaks hosted page!
    // Customer will be created by Razorpay during payment
    // We'll capture correct customer details from webhook

    // Create or get Razorpay Plan
    // We use plan.razorpayMonthlyPlanId or razorpayYearlyPlanId based on billing cycle
    const planIdField =
      billingCycle === "yearly"
        ? "razorpayYearlyPlanId"
        : "razorpayMonthlyPlanId";
    let razorpayPlanId = plan[planIdField];

    if (!razorpayPlanId) {
      console.log("📋 Creating new Razorpay plan...");
      const interval = billingCycle === "yearly" ? "yearly" : "monthly";
      const razorpayPlan = await createRazorpaySubscriptionPlan(
        `${plan.name} - ${billingCycle === "monthly" ? "Monthly" : "Yearly"}`,
        price,
        interval,
      );
      razorpayPlanId = razorpayPlan.id;

      // Update local plan with Razorpay plan ID for future use
      await db
        .update(subscriptionPlans)
        .set({ [planIdField]: razorpayPlanId })
        .where(eq(subscriptionPlans.id, planId));

      console.log(
        "✅ Razorpay plan created and saved:",
        razorpayPlanId,
        `(${planIdField})`,
      );
    } else {
      console.log(
        "✅ Using existing Razorpay plan:",
        razorpayPlanId,
        `(${planIdField})`,
      );
    }

    // Calculate total_count (number of billing cycles)
    // For monthly: 12 cycles = 1 year, for yearly: 1 cycle
    const totalCount = billingCycle === "monthly" ? 12 : 1;

    // ============================================
    // CLEANUP ABANDONED PENDING SUBSCRIPTIONS
    // ============================================
    // Check for pending_payment subscriptions older than 5 minutes
    // These are likely abandoned purchases (user clicked back)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const abandonedSubscriptions = await db
      .select()
      .from(providerSubscriptions)
      .where(
        and(
          eq(providerSubscriptions.providerId, providerId),
          eq(providerSubscriptions.status, "pending_payment"),
          lt(providerSubscriptions.createdAt, fiveMinutesAgo),
        ),
      );

    if (abandonedSubscriptions.length > 0) {
      console.log(
        "🧹 Found",
        abandonedSubscriptions.length,
        "abandoned pending subscriptions (older than 5 minutes)",
      );

      // For each abandoned subscription, cancel in Razorpay and mark as expired
      for (const sub of abandonedSubscriptions) {
        console.log("🔕 Cancelling abandoned subscription:", sub.id);

        // Cancel in Razorpay if it's a real subscription (not temp_*)
        if (
          sub.razorpaySubscriptionId &&
          !sub.razorpaySubscriptionId.startsWith("temp_")
        ) {
          try {
            await cancelRazorpaySubscription(sub.razorpaySubscriptionId, false);
            console.log(
              "✅ Cancelled in Razorpay:",
              sub.razorpaySubscriptionId,
            );
          } catch (err) {
            console.log("⚠️  Could not cancel in Razorpay:", err.message);
          }
        }

        // Mark as expired in our database
        await db
          .update(providerSubscriptions)
          .set({
            status: "expired",
            updatedAt: new Date(),
            cancelAtPeriodEnd: true,
          })
          .where(eq(providerSubscriptions.id, sub.id));

        console.log("✅ Marked as expired:", sub.id);
      }
    }

    // ============================================
    // CHECK FOR EXISTING ACTIVE SUBSCRIPTIONS
    // ============================================
    // If provider has an active subscription, expire it before creating new one
    // This prevents multiple active subscriptions
    const [existingActiveSub] = await db
      .select()
      .from(providerSubscriptions)
      .where(
        and(
          eq(providerSubscriptions.providerId, providerId),
          eq(providerSubscriptions.status, "active"),
        ),
      )
      .orderBy(desc(providerSubscriptions.createdAt))
      .limit(1);

    if (existingActiveSub) {
      console.log(
        "⚠️  Provider has existing active subscription:",
        existingActiveSub.id,
        "Expiring it before creating new one...",
      );

      // Expire the old subscription in our database
      await db
        .update(providerSubscriptions)
        .set({
          status: "expired",
          updatedAt: new Date(),
          cancelAtPeriodEnd: true,
        })
        .where(eq(providerSubscriptions.id, existingActiveSub.id));

      console.log(
        "✅ Old subscription marked as expired:",
        existingActiveSub.id,
      );
    }

    // Create local subscription record FIRST in "pending_payment" status
    const endDate = calculateEndDate(billingCycle);
    const now = new Date();
    const [localSubscription] = await db
      .insert(providerSubscriptions)
      .values({
        providerId,
        planId,
        status: "pending_payment", // Will be activated via webhook
        razorpaySubscriptionId: `temp_${Date.now()}`, // Temporary ID, will be updated after payment
        razorpayPlanId,
        startDate: now,
        endDate,
        billingCycle,
        autoRenew: true,
        amountPaid: 0, // Will be updated after payment
        platformFeeAtPurchase: plan.platformFeePercentage,
        originalAmount: price,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    console.log(
      "✅ Local subscription created:",
      localSubscription.id,
      "status: pending_payment",
      "for provider:",
      providerId,
      "user:",
      user?.email,
    );

    // Create Razorpay subscription (POST /v1/subscriptions)
    console.log("🔗 Creating Razorpay subscription...");
    const razorpaySubscription = await createSubscriptionLink(price, {
      plan_id: razorpayPlanId,
      total_count: totalCount,
      // customer_id: customer.id, // DON'T pass - breaks hosted page!
      // customer_notify: true,    // DON'T pass - breaks hosted page!
      // notify_info: {...},        // DON'T pass - breaks hosted page!
      notes: {
        provider_id: providerId.toString(),
        provider_email: user?.email, // Store for verification
        provider_name: user?.name,
        plan_id: planId.toString(),
        billing_cycle: billingCycle,
        platform_fee: plan.platformFeePercentage.toString(),
        local_subscription_id: localSubscription.id.toString(),
      },
    });

    console.log("✅ Razorpay subscription created:", razorpaySubscription.id);
    console.log("   Short URL:", razorpaySubscription.short_url);

    // Update local subscription with Razorpay subscription ID (sub_...)
    await db
      .update(providerSubscriptions)
      .set({
        razorpaySubscriptionId: razorpaySubscription.id,
        updatedAt: now,
      })
      .where(eq(providerSubscriptions.id, localSubscription.id));

    // Return subscription short URL (hosted Razorpay authorization page)
    res.json({
      message:
        "Subscription link generated. Please complete payment to activate your subscription.",
      data: {
        redirectUrl: razorpaySubscription.short_url,
        subscriptionId: razorpaySubscription.id, // sub_... ID
        localSubscriptionId: localSubscription.id,
        amount: price,
      },
    });
  } catch (error) {
    console.error("Error purchasing subscription with link:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Handle Razorpay Subscription lifecycle webhooks
 * Events: subscription.authorized, subscription.charged, subscription.completed, etc.
 */
const handleSubscriptionWebhook = async (event, eventType) => {
  try {
    const subscriptionEntity = event.payload?.subscription?.entity;
    if (!subscriptionEntity) {
      console.log("ℹ️  No subscription entity in webhook");
      return;
    }

    const razorpaySubscriptionId = subscriptionEntity.id;
    const notes = subscriptionEntity.notes || {};
    const providerId = parseInt(notes.provider_id);
    const planId = parseInt(notes.plan_id);

    console.log(
      "📋 Subscription webhook:",
      eventType,
      "for subscription:",
      razorpaySubscriptionId,
    );

    switch (eventType) {
      case "subscription.authorized": {
        // Customer has authorized the mandate (auto-debit)
        console.log("✅ Subscription authorized by customer");

        const customerId = subscriptionEntity.customer_id;
        const notes = subscriptionEntity.notes || {};

        console.log("📋 Subscription details:");
        console.log("   Customer ID:", customerId);
        console.log("   Notes provider_email:", notes.provider_email);
        console.log("   Notes provider_id:", notes.provider_id);

        // Fetch full customer details from Razorpay
        if (customerId) {
          try {
            const customer = await razorpay.customers.fetch(customerId);
            console.log("👤 Razorpay customer details:");
            console.log("   ID:", customer.id);
            console.log("   Email:", customer.email);
            console.log("   Contact:", customer.contact);
            console.log("   Name:", customer.name);
          } catch (err) {
            console.error("Error fetching customer details:", err.message);
          }
        }

        // Get provider email from notes to verify
        const providerEmail = notes.provider_email;
        if (providerEmail && customerId) {
          console.log(
            "🔍 Checking if customer exists for email:",
            providerEmail,
          );

          // Fetch customer by email to verify it exists in Razorpay
          const existingCustomer =
            await fetchRazorpayCustomerByEmail(providerEmail);

          if (existingCustomer && existingCustomer.id === customerId) {
            console.log(
              "✅ Customer verified! Email matches Razorpay customer.",
            );
            console.log("   Storing customer_id:", customerId);
          } else {
            console.log(
              "⚠️  Customer email doesn't match or customer not found.",
            );
            console.log("   Razorpay customer_id:", customerId);
            console.log("   Provider email:", providerEmail);
          }
        }

        const [localSub] = await db
          .select()
          .from(providerSubscriptions)
          .where(
            eq(
              providerSubscriptions.razorpaySubscriptionId,
              razorpaySubscriptionId,
            ),
          )
          .limit(1);

        if (localSub) {
          const updateData = {
            status: "active",
            updatedAt: new Date(),
          };

          // Store customer_id if available
          if (customerId) {
            updateData.razorpayCustomerId = customerId;
          }

          await db
            .update(providerSubscriptions)
            .set(updateData)
            .where(eq(providerSubscriptions.id, localSub.id));

          console.log("✅ Local subscription activated:", localSub.id);
          if (customerId) {
            console.log("✅ Customer ID stored:", customerId);
          }
        }
        break;
      }

      case "subscription.charged": {
        // Recurring payment successful
        console.log("💰 Subscription charged - recurring payment successful");

        const payment = event.payload?.payment?.entity;
        const [localSub] = await db
          .select()
          .from(providerSubscriptions)
          .where(
            eq(
              providerSubscriptions.razorpaySubscriptionId,
              razorpaySubscriptionId,
            ),
          )
          .limit(1);

        if (localSub && payment) {
          // Check if payment already recorded (avoid duplicates from multiple webhooks)
          const paymentExists = await subscriptionPaymentExists(payment.id);
          if (paymentExists) {
            console.log("⚠️  Payment already recorded, skipping:", payment.id);
            break;
          }

          // Record payment
          await db.insert(subscriptionPayments).values({
            providerSubscriptionId: localSub.id,
            razorpayPaymentId: payment.id,
            amount: payment.amount,
            status: "captured",
            paymentDate: new Date(),
          });

          // Update total amount paid
          await db
            .update(providerSubscriptions)
            .set({
              amountPaid: sql`${providerSubscriptions.amountPaid} + ${payment.amount}`,
              updatedAt: new Date(),
            })
            .where(eq(providerSubscriptions.id, localSub.id));

          console.log("✅ Recurring payment recorded:", payment.id);
        }
        break;
      }

      case "subscription.completed": {
        // All payments completed (subscription ended naturally)
        console.log("🏁 Subscription completed");

        await db
          .update(providerSubscriptions)
          .set({ status: "completed", autoRenew: false, updatedAt: new Date() })
          .where(
            eq(
              providerSubscriptions.razorpaySubscriptionId,
              razorpaySubscriptionId,
            ),
          );
        break;
      }

      case "subscription.cancelled": {
        // Subscription cancelled
        console.log("❌ Subscription cancelled");

        await db
          .update(providerSubscriptions)
          .set({ status: "cancelled", autoRenew: false, updatedAt: new Date() })
          .where(
            eq(
              providerSubscriptions.razorpaySubscriptionId,
              razorpaySubscriptionId,
            ),
          );
        break;
      }

      case "subscription.paused": {
        console.log("⏸️  Subscription paused");
        // Note: "paused" not in enum, using "cancelled" instead
        // In production, add "paused" to the enum if needed
        await db
          .update(providerSubscriptions)
          .set({ status: "cancelled", autoRenew: false, updatedAt: new Date() })
          .where(
            eq(
              providerSubscriptions.razorpaySubscriptionId,
              razorpaySubscriptionId,
            ),
          );
        break;
      }

      case "subscription.resumed": {
        console.log("▶️  Subscription resumed");
        await db
          .update(providerSubscriptions)
          .set({ status: "active", autoRenew: true, updatedAt: new Date() })
          .where(
            eq(
              providerSubscriptions.razorpaySubscriptionId,
              razorpaySubscriptionId,
            ),
          );
        break;
      }

      default:
        console.log(`ℹ️  Unhandled subscription event: ${eventType}`);
    }
  } catch (error) {
    console.error("Error handling subscription webhook:", error);
  }
};

/**
 * Get subscription details for checkout.js authorization
 * POST /api/provider/subscription/authorize
 */
const authorizeSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    const providerId = req.token.id;

    if (!subscriptionId) {
      return res.status(400).json({ message: "Subscription ID is required" });
    }

    console.log(
      "🔐 Authorizing subscription:",
      subscriptionId,
      "for provider:",
      providerId,
    );

    // Fetch Razorpay subscription details
    const { fetchRazorpaySubscription } = require("../utils/razorpay");
    const razorpaySubscription =
      await fetchRazorpaySubscription(subscriptionId);

    if (!razorpaySubscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    // Get provider details
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, providerId))
      .limit(1);

    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, providerId))
      .limit(1);

    const displayName =
      business?.businessName?.trim() || user?.name || "Service Provider";

    // Return subscription details for checkout
    res.json({
      message: "Subscription details fetched successfully",
      data: {
        key: process.env.RAZORPAY_KEY_ID,
        subscriptionId: razorpaySubscription.id,
        amount: razorpaySubscription.amount || 0,
        currency: razorpaySubscription.currency || "INR",
        description: `${displayName} - Subscription`,
        customerName: displayName,
        customerEmail: user?.email || "",
        customerContact: business?.phone || user?.phone || "",
      },
    });
  } catch (error) {
    console.error("Error authorizing subscription:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Cancel pending subscription (when user closes checkout modal without paying)
 * POST /api/provider/subscription/cancel-pending
 */
const cancelPendingSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    const providerId = req.token.id;

    if (!subscriptionId) {
      return res.status(400).json({ message: "Subscription ID is required" });
    }

    console.log(
      "❌ Cancelling pending subscription:",
      subscriptionId,
      "for provider:",
      providerId,
    );

    // Cancel in Razorpay
    const { cancelRazorpaySubscription } = require("../utils/razorpay");
    await cancelRazorpaySubscription(subscriptionId, false);

    // Delete local subscription record (since no payment was made)
    await db
      .delete(providerSubscriptions)
      .where(eq(providerSubscriptions.razorpaySubscriptionId, subscriptionId));

    console.log("✅ Pending subscription cancelled:", subscriptionId);

    res.json({
      message: "Pending subscription cancelled successfully",
    });
  } catch (error) {
    console.error("Error cancelling pending subscription:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Cleanup abandoned pending subscriptions
 * GET /api/provider/subscription/cleanup
 * Cancels pending subscriptions older than 5 minutes and marks them as expired
 */
const cleanupAbandonedSubscriptions = async (req, res) => {
  try {
    const providerId = req.token.id;

    console.log(
      "🧹 Cleaning up abandoned subscriptions for provider:",
      providerId,
    );

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Find abandoned subscriptions
    const abandonedSubscriptions = await db
      .select()
      .from(providerSubscriptions)
      .where(
        and(
          eq(providerSubscriptions.providerId, providerId),
          eq(providerSubscriptions.status, "pending_payment"),
          lt(providerSubscriptions.createdAt, fiveMinutesAgo),
        ),
      );

    if (abandonedSubscriptions.length === 0) {
      return res.json({
        message: "No abandoned subscriptions to clean up",
        data: { cleaned: 0 },
      });
    }

    let cleanedCount = 0;

    // For each abandoned subscription, cancel in Razorpay and mark as expired
    for (const sub of abandonedSubscriptions) {
      console.log("🔕 Cancelling abandoned subscription:", sub.id);

      // Cancel in Razorpay if it's a real subscription
      if (
        sub.razorpaySubscriptionId &&
        !sub.razorpaySubscriptionId.startsWith("temp_")
      ) {
        try {
          await cancelRazorpaySubscription(sub.razorpaySubscriptionId, false);
          console.log("✅ Cancelled in Razorpay:", sub.razorpaySubscriptionId);
        } catch (err) {
          console.log("⚠️  Could not cancel in Razorpay:", err.message);
        }
      }

      // Mark as expired
      await db
        .update(providerSubscriptions)
        .set({
          status: "expired",
          updatedAt: new Date(),
          cancelAtPeriodEnd: true,
        })
        .where(eq(providerSubscriptions.id, sub.id));

      cleanedCount++;
      console.log("✅ Marked as expired:", sub.id);
    }

    res.json({
      message: `Cleaned up ${cleanedCount} abandoned subscription(s)`,
      data: { cleaned: cleanedCount },
    });
  } catch (error) {
    console.error("Error cleaning up subscriptions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getCurrentSubscription,
  purchaseSubscription,
  purchaseSubscriptionWithRazorpay,
  purchaseSubscriptionWithLink,
  cancelSubscription,
  toggleAutoRenew,
  upgradeSubscription,
  getPaymentHistory,
  getAllProviderSubscriptions,
  handleWebhook,
  handleSubscriptionWebhook,
  getProviderActiveSubscription,
  getMonthlyBookingCount,
  authorizeSubscription,
  cancelPendingSubscription,
  cleanupAbandonedSubscriptions,
};
