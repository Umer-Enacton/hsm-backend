const db = require("../config/db");
const {
  subscriptionPlans,
  providerSubscriptions,
  users,
} = require("../models/schema");
const { eq, and, or, sql, desc, ilike, inArray, count } = require("drizzle-orm");
const {
  createRazorpaySubscriptionPlan,
} = require("../utils/razorpay");

// ============================================
// HELPER FUNCTIONS
// ============================================

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
// PLAN CRUD OPERATIONS
// ============================================

/**
 * Create a new subscription plan
 * POST /api/subscription/plans
 */
const createPlan = async (req, res) => {
  try {
    const {
      name,
      description,
      monthlyPrice,
      yearlyPrice,
      trialDays,
      platformFeePercentage,
      maxServices,
      maxBookingsPerMonth,
      prioritySupport,
      analyticsAccess,
      benefits,
      features,
      allowedGraphs,
    } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ message: "Plan name is required" });
    }

    // Check if plan with same name already exists
    const [existing] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.name, name))
      .limit(1);

    if (existing) {
      return res.status(400).json({ message: "Plan with this name already exists" });
    }

    // Create Razorpay plans for monthly and yearly billing
    let razorpayMonthlyPlanId = null;
    let razorpayYearlyPlanId = null;

    if (monthlyPrice > 0) {
      const monthlyPlan = await createRazorpaySubscriptionPlan(
        `${name} - Monthly`,
        monthlyPrice,
        "monthly"
      );
      razorpayMonthlyPlanId = monthlyPlan.id;
    }

    if (yearlyPrice > 0) {
      const yearlyPlan = await createRazorpaySubscriptionPlan(
        `${name} - Yearly`,
        yearlyPrice,
        "yearly"
      );
      razorpayYearlyPlanId = yearlyPlan.id;
    }

    // Create plan in database
    const [plan] = await db
      .insert(subscriptionPlans)
      .values({
        name,
        description: description || null,
        monthlyPrice: monthlyPrice || 0,
        yearlyPrice: yearlyPrice || 0,
        trialDays: trialDays || 0,
        platformFeePercentage: platformFeePercentage || 5,
        maxServices: maxServices || 4,
        maxBookingsPerMonth: maxBookingsPerMonth || null,
        maxImagesPerService: 999, // Unlimited - field kept for schema compatibility
        prioritySupport: prioritySupport || false,
        analyticsAccess: analyticsAccess !== undefined ? analyticsAccess : true,
        razorpayMonthlyPlanId,
        razorpayYearlyPlanId,
        benefits: benefits || [],
        features: (features || allowedGraphs) ? JSON.stringify({
          ...(features ? JSON.parse(features) : {}),
          allowedGraphs: allowedGraphs || [],
        }) : null,
        isActive: true,
      })
      .returning();

    res.status(201).json({
      message: "Subscription plan created successfully",
      data: plan,
    });
  } catch (error) {
    console.error("Error creating subscription plan:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get all subscription plans
 * GET /api/subscription/plans
 */
const getPlans = async (req, res) => {
  try {
    const { includeInactive = "false" } = req.query;

    let query = db.select().from(subscriptionPlans);

    if (includeInactive !== "true") {
      query = query.where(eq(subscriptionPlans.isActive, true));
    }

    const plans = await query.orderBy(desc(subscriptionPlans.createdAt));

    // Parse features JSON for each plan
    const parsedPlans = plans.map((plan) => ({
      ...plan,
      features: plan.features ? JSON.parse(plan.features) : null,
    }));

    res.json({
      message: "Plans retrieved successfully",
      data: parsedPlans,
    });
  } catch (error) {
    console.error("Error fetching subscription plans:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get a single subscription plan by ID
 * GET /api/subscription/plans/:planId
 */
const getPlan = async (req, res) => {
  try {
    const { planId } = req.params;

    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }

    // Parse features JSON
    const parsedPlan = {
      ...plan,
      features: plan.features ? JSON.parse(plan.features) : null,
    };

    res.json({
      message: "Plan retrieved successfully",
      data: parsedPlan,
    });
  } catch (error) {
    console.error("Error fetching subscription plan:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Update a subscription plan
 * PUT /api/subscription/plans/:planId
 */
const updatePlan = async (req, res) => {
  try {
    const { planId } = req.params;
    const {
      name,
      description,
      monthlyPrice,
      yearlyPrice,
      trialDays,
      platformFeePercentage,
      maxServices,
      maxBookingsPerMonth,
      prioritySupport,
      analyticsAccess,
      benefits,
      features,
      allowedGraphs,
      isActive,
    } = req.body;

    // Check if plan exists
    const [existing] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ message: "Plan not found" });
    }

    // Check if name conflict (if name is being changed)
    if (name && name !== existing.name) {
      const [nameConflict] = await db
        .select()
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.name, name))
        .limit(1);

      if (nameConflict) {
        return res.status(400).json({ message: "Plan with this name already exists" });
      }
    }

    // Build update object
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (monthlyPrice !== undefined) updateData.monthlyPrice = monthlyPrice;
    if (yearlyPrice !== undefined) updateData.yearlyPrice = yearlyPrice;
    if (trialDays !== undefined) updateData.trialDays = trialDays;
    if (platformFeePercentage !== undefined)
      updateData.platformFeePercentage = platformFeePercentage;
    if (maxServices !== undefined) updateData.maxServices = maxServices;
    if (maxBookingsPerMonth !== undefined)
      updateData.maxBookingsPerMonth = maxBookingsPerMonth;
    if (prioritySupport !== undefined) updateData.prioritySupport = prioritySupport;
    if (analyticsAccess !== undefined) updateData.analyticsAccess = analyticsAccess;
    if (benefits !== undefined) updateData.benefits = benefits;
    if (features !== undefined || allowedGraphs !== undefined) {
      const existingFeatures = existing.features ? JSON.parse(existing.features) : {};
      updateData.features = JSON.stringify({
        ...existingFeatures,
        ...(features ? JSON.parse(features) : {}),
        allowedGraphs: allowedGraphs || existingFeatures.allowedGraphs || [],
      });
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    updateData.updatedAt = new Date();

    // Handle price changes - create new Razorpay plans
    if (
      monthlyPrice !== undefined &&
      monthlyPrice !== existing.monthlyPrice
    ) {
      if (monthlyPrice > 0) {
        const monthlyPlan = await createRazorpaySubscriptionPlan(
          `${name || existing.name} - Monthly`,
          monthlyPrice,
          "monthly"
        );
        updateData.razorpayMonthlyPlanId = monthlyPlan.id;
      } else {
        updateData.razorpayMonthlyPlanId = null;
      }
    }

    if (
      yearlyPrice !== undefined &&
      yearlyPrice !== existing.yearlyPrice
    ) {
      if (yearlyPrice > 0) {
        const yearlyPlan = await createRazorpaySubscriptionPlan(
          `${name || existing.name} - Yearly`,
          yearlyPrice,
          "yearly"
        );
        updateData.razorpayYearlyPlanId = yearlyPlan.id;
      } else {
        updateData.razorpayYearlyPlanId = null;
      }
    }

    // Update plan
    const [updated] = await db
      .update(subscriptionPlans)
      .set(updateData)
      .where(eq(subscriptionPlans.id, planId))
      .returning();

    // Parse features JSON
    const parsedPlan = {
      ...updated,
      features: updated.features ? JSON.parse(updated.features) : null,
    };

    res.json({
      message: "Plan updated successfully",
      data: parsedPlan,
    });
  } catch (error) {
    console.error("Error updating subscription plan:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Delete a subscription plan (soft delete or hard delete with migration)
 * DELETE /api/subscription/plans/:planId
 */
const deletePlan = async (req, res) => {
  try {
    const { planId } = req.params;
    const { migrateToPlanId } = req.body;

    // Check if plan exists
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }

    // Check for active subscribers
    const [subscriberCount] = await db
      .select({ count: count() })
      .from(providerSubscriptions)
      .where(eq(providerSubscriptions.planId, planId));

    if (subscriberCount.count > 0) {
      if (!migrateToPlanId) {
        return res.status(409).json({
          message: "Plan has active subscribers",
          data: { count: subscriberCount.count },
        });
      }

      if (planId === migrateToPlanId) {
        return res
          .status(400)
          .json({ message: "Cannot migrate to same plan" });
      }

      // Verify migration plan exists
      const [migrationPlan] = await db
        .select()
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.id, migrateToPlanId))
        .limit(1);

      if (!migrationPlan) {
        return res.status(400).json({ message: "Migration plan not found" });
      }

      // Migrate subscribers
      await db
        .update(providerSubscriptions)
        .set({ planId: migrateToPlanId })
        .where(eq(providerSubscriptions.planId, planId));
    }

    // Delete plan
    await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));

    res.json({
      message: subscriberCount.count > 0
        ? `Plan deleted. ${subscriberCount.count} subscribers migrated.`
        : "Plan deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting subscription plan:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  createPlan,
  getPlans,
  getPlan,
  updatePlan,
  deletePlan,
};
