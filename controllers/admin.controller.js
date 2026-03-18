const db = require("../config/db");
const { payments, bookings, users, adminSettings, businessProfiles, services, paymentDetails } = require("../models/schema");
const { eq, and, sql, desc, inArray } = require("drizzle-orm");
const { notificationTemplates } = require("../utils/notificationHelper");

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get admin setting value by key
 * @param {string} key - Setting key
 * @param {string} defaultValue - Default value if not found
 * @returns {Promise<string>} Setting value
 */
async function getAdminSetting(key, defaultValue = "0") {
  try {
    const [setting] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, key))
      .limit(1);
    return setting ? setting.value : defaultValue;
  } catch (error) {
    console.error(`Error fetching admin setting ${key}:`, error);
    return defaultValue;
  }
}

/**
 * Set admin setting value
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 * @param {string} description - Optional description
 */
async function setAdminSetting(key, value, description = null) {
  try {
    const [existing] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, key))
      .limit(1);

    if (existing) {
      await db
        .update(adminSettings)
        .set({ value, updatedAt: new Date() })
        .where(eq(adminSettings.key, key));
    } else {
      await db.insert(adminSettings).values({
        key,
        value,
        description,
      });
    }
  } catch (error) {
    console.error(`Error setting admin setting ${key}:`, error);
    throw error;
  }
}

// ============================================
// CONTROLLER FUNCTIONS
// ============================================

/**
 * Get platform settings
 * GET /admin/settings
 */
const getPlatformSettings = async (req, res) => {
  try {
    // Only admin can access settings
    if (req.token.roleId !== 3) {
      return res.status(403).json({
        message: "Access denied: Only admin can access platform settings",
      });
    }

    const platformFee = await getAdminSetting("platform_fee_percentage", "5");
    const minimumPayout = await getAdminSetting("minimum_payout_amount", "30000"); // Default ₹300

    res.json({
      platformFeePercentage: Number(platformFee),
      minimumPayoutAmount: Number(minimumPayout),
    });
  } catch (error) {
    console.error("Error fetching platform settings:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Update platform fee percentage
 * PUT /admin/settings
 */
const updatePlatformSettings = async (req, res) => {
  try {
    // Only admin can update settings
    if (req.token.roleId !== 3) {
      return res.status(403).json({
        message: "Access denied: Only admin can update platform settings",
      });
    }

    const { platformFeePercentage, minimumPayoutAmount } = req.body;

    // Validate platform fee percentage (1-10%)
    if (platformFeePercentage !== undefined) {
      if (platformFeePercentage < 1 || platformFeePercentage > 10) {
        return res.status(400).json({
          message: "Platform fee percentage must be between 1% and 10%",
        });
      }
      await setAdminSetting(
        "platform_fee_percentage",
        platformFeePercentage.toString(),
        "Platform commission percentage charged on each booking (1-10%)"
      );
    }

    // Validate minimum payout amount (₹300 - ₹1000 in paise)
    if (minimumPayoutAmount !== undefined) {
      const minInRupees = minimumPayoutAmount / 100; // Convert to rupees for validation
      if (minInRupees < 300 || minInRupees > 1000) {
        return res.status(400).json({
          message: "Minimum payout amount must be between ₹300 and ₹1,000",
        });
      }
      await setAdminSetting(
        "minimum_payout_amount",
        minimumPayoutAmount.toString(),
        "Minimum amount required for provider payout in paise (₹300-₹1000)"
      );
    }

    // Return updated values
    const updatedPlatformFee = platformFeePercentage !== undefined
      ? platformFeePercentage
      : Number(await getAdminSetting("platform_fee_percentage", "5"));
    const updatedMinPayout = minimumPayoutAmount !== undefined
      ? minimumPayoutAmount
      : Number(await getAdminSetting("minimum_payout_amount", "30000"));

    res.json({
      message: "Platform settings updated successfully",
      platformFeePercentage: updatedPlatformFee,
      minimumPayoutAmount: updatedMinPayout,
    });
  } catch (error) {
    console.error("Error updating platform settings:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get revenue statistics
 * GET /admin/revenue
 */
const getRevenueStats = async (req, res) => {
  try {
    // Only admin can access revenue stats
    if (req.token.roleId !== 3) {
      return res.status(403).json({
        message: "Access denied: Only admin can access revenue statistics",
      });
    }

    const { startDate, endDate, groupBy } = req.query;

    // Get platform fee percentage
    const platformFeePercentage = Number(await getAdminSetting("platform_fee_percentage", "5"));

    // Build date filter
    let dateFilter = sql`TRUE`;
    if (startDate) {
      dateFilter = sql`${payments.createdAt} >= ${new Date(startDate)}`;
    }
    if (endDate) {
      dateFilter = sql`${dateFilter} AND ${payments.createdAt} <= ${new Date(endDate)}`;
    }

    // Get completed payments for revenue calculation
    const completedPayments = await db
      .select({
        id: payments.id,
        amount: payments.amount,
        platformFee: payments.platformFee,
        providerShare: payments.providerShare,
        status: payments.status,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, "paid"),
          dateFilter
        )
      );

    // Calculate totals
    let totalRevenue = 0;
    let totalPlatformFee = 0;
    let totalProviderShare = 0;
    let totalPayments = completedPayments.length;

    completedPayments.forEach((payment) => {
      totalRevenue += payment.amount;

      // Use stored split values if available, otherwise calculate
      if (payment.platformFee) {
        totalPlatformFee += payment.platformFee;
        totalProviderShare += payment.providerShare || 0;
      } else {
        // Fallback calculation for older payments
        const fee = Math.round(payment.amount * (platformFeePercentage / 100));
        totalPlatformFee += fee;
        totalProviderShare += payment.amount - fee;
      }
    });

    // Get monthly breakdown (always returned)
    const monthlyData = await db
      .select({
        month: sql`DATE_TRUNC('month', ${payments.createdAt})::DATE`,
        total: sql`SUM(${payments.amount})`,
        count: sql`COUNT(*)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, "paid"),
          dateFilter
        )
      )
      .groupBy(sql`DATE_TRUNC('month', ${payments.createdAt})`)
      .orderBy(desc(sql`DATE_TRUNC('month', ${payments.createdAt})`));

    const monthlyBreakdown = monthlyData.map((item) => ({
      month: item.month,
      total: Number(item.total),
      count: Number(item.count),
      platformFee: Math.round(Number(item.total) * (platformFeePercentage / 100)),
    }));

    // Get top providers by revenue
    const topProviders = await db
      .select({
        providerId: businessProfiles.providerId,
        businessName: businessProfiles.businessName,
        totalBookings: sql`COUNT(*)`,
        totalRevenue: sql`SUM(${payments.amount})`,
      })
      .from(bookings)
      .innerJoin(payments, eq(payments.bookingId, bookings.id))
      .innerJoin(businessProfiles, eq(businessProfiles.id, bookings.businessProfileId))
      .where(
        and(
          eq(payments.status, "paid"),
          dateFilter
        )
      )
      .groupBy(businessProfiles.id, businessProfiles.providerId, businessProfiles.businessName)
      .orderBy(desc(sql`SUM(${payments.amount})`))
      .limit(10);

    // Get booking status breakdown
    const statusBreakdown = await db
      .select({
        status: bookings.status,
        count: sql`COUNT(*)`,
      })
      .from(bookings)
      .where(dateFilter)
      .groupBy(bookings.status);

    // Format monthly breakdown for frontend
    const breakdown = monthlyBreakdown.map((item) => ({
      period: item.month,
      revenue: Number(item.total),
      platformFees: item.platformFee,
      bookings: Number(item.count),
    }));

    res.json({
      totalRevenue,
      platformFees: totalPlatformFee,
      providerPayouts: totalProviderShare,
      totalBookings: totalPayments,
      breakdown,
      topProviders: topProviders.map((p) => ({
        ...p,
        totalRevenue: Number(p.totalRevenue),
        totalBookings: Number(p.totalBookings),
      })),
      statusBreakdown: statusBreakdown.map((s) => ({
        status: s.status,
        count: Number(s.count),
      })),
    });
  } catch (error) {
    console.error("Error fetching revenue stats:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ============================================
// PAYOUT MANAGEMENT FUNCTIONS
// ============================================

/**
 * Get all payouts with optional filters
 * GET /admin/payouts?status=pending|paid|all&providerId=X
 */
const getPayouts = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { status = "all", providerId } = req.query;

    // Get minimum payout amount from settings
    const minimumPayoutAmount = Number(await getAdminSetting("minimum_payout_amount", "30000")); // Default ₹300

    // Build query conditions
    let query = db
      .select({
        // Payment fields
        paymentId: payments.id,
        bookingId: payments.bookingId,
        amount: payments.amount,
        providerShare: payments.providerShare,
        platformFee: payments.platformFee,
        providerPayoutStatus: payments.providerPayoutStatus,
        paymentCreatedAt: payments.createdAt,
        paymentCompletedAt: payments.completedAt,
        // Booking fields
        bookingStatus: bookings.status,
        bookingDate: bookings.bookingDate,
        totalPrice: bookings.totalPrice,
        // Provider/Business fields
        providerId: businessProfiles.providerId,
        providerName: users.name,
        providerEmail: users.email,
        providerBusiness: businessProfiles.businessName,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .innerJoin(businessProfiles, eq(bookings.businessProfileId, businessProfiles.id))
      .innerJoin(users, eq(businessProfiles.providerId, users.id))
      .where(eq(payments.status, "paid"));

    // Filter by payout status
    if (status && status !== "all") {
      query = query.where(eq(payments.providerPayoutStatus, status));
    } else {
      // If "all", only show payments with payout status set (not NULL)
      query = query.where(sql`${payments.providerPayoutStatus} IS NOT NULL`);
    }

    // Filter by provider
    if (providerId) {
      query = query.where(eq(businessProfiles.providerId, Number(providerId)));
    }

    const payouts = await query.orderBy(desc(payments.createdAt));

    // Calculate per-provider totals for minimum payout check
    const providerTotals = new Map();
    payouts.forEach((p) => {
      const current = providerTotals.get(p.providerId) || 0;
      providerTotals.set(p.providerId, current + Number(p.providerShare || 0));
    });

    // Add metadata to each payout
    const payoutsWithMeta = payouts.map((p) => {
      const providerTotal = providerTotals.get(p.providerId) || 0;
      return {
        ...p,
        providerShare: Number(p.providerShare || 0),
        canProcessPayout: providerTotal >= minimumPayoutAmount,
        providerTotalEarnings: providerTotal,
        minimumPayoutAmount,
      };
    });

    res.json({
      payouts: payoutsWithMeta,
      minimumPayoutAmount,
    });
  } catch (error) {
    console.error("Error fetching payouts:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get payout summary for admin dashboard
 * GET /admin/payouts/summary
 */
const getPayoutsSummary = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const minimumPayoutAmount = Number(await getAdminSetting("minimum_payout_amount", "30000"));

    // Get totals by payout status
    const [summary] = await db
      .select({
        totalPending: sql`COALESCE(SUM(CASE WHEN ${payments.providerPayoutStatus} = 'pending' THEN ${payments.providerShare} ELSE 0 END), 0)`,
        totalPaid: sql`COALESCE(SUM(CASE WHEN ${payments.providerPayoutStatus} = 'paid' THEN ${payments.providerShare} ELSE 0 END), 0)`,
        countPending: sql`COUNT(CASE WHEN ${payments.providerPayoutStatus} = 'pending' THEN 1 END)`,
        countPaid: sql`COUNT(CASE WHEN ${payments.providerPayoutStatus} = 'paid' THEN 1 END)`,
      })
      .from(payments)
      .where(sql`${payments.providerPayoutStatus} IS NOT NULL`);

    // Get unique providers with pending payouts
    const providersWithPending = await db
      .select({
        providerId: businessProfiles.providerId,
        providerName: users.name,
        providerBusiness: businessProfiles.businessName,
        totalPending: sql`SUM(COALESCE(${payments.providerShare}, 0))`,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .innerJoin(businessProfiles, eq(bookings.businessProfileId, businessProfiles.id))
      .innerJoin(users, eq(businessProfiles.providerId, users.id))
      .where(eq(payments.providerPayoutStatus, "pending"))
      .groupBy(businessProfiles.providerId, users.name, businessProfiles.businessName)
      .orderBy(desc(sql`SUM(COALESCE(${payments.providerShare}, 0))`));

    // Filter providers who meet minimum payout
    const providersReadyToPay = providersWithPending
      .filter((p) => Number(p.totalPending) >= minimumPayoutAmount)
      .map((p) => ({
        ...p,
        totalPending: Number(p.totalPending),
        canProcess: true,
      }));

    const providersWaiting = providersWithPending
      .filter((p) => Number(p.totalPending) < minimumPayoutAmount)
      .map((p) => ({
        ...p,
        totalPending: Number(p.totalPending),
        canProcess: false,
      }));

    res.json({
      totalPendingAmount: Number(summary?.totalPending) || 0,
      totalPaidAmount: Number(summary?.totalPaid) || 0,
      pendingCount: Number(summary?.countPending) || 0,
      paidCount: Number(summary?.countPaid) || 0,
      providersReadyToPay,
      providersWaiting,
      minimumPayoutAmount,
    });
  } catch (error) {
    console.error("Error fetching payout summary:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Mark a single payout as paid (MANUAL MODE)
 * Use this after manually transferring money to provider
 * PUT /admin/payouts/:id/mark-paid
 */
const markPayoutAsPaid = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { id } = req.params;

    // Get payment with booking info
    const [paymentWithBooking] = await db
      .select({
        paymentId: payments.id,
        bookingId: payments.bookingId,
        providerShare: payments.providerShare,
        providerPayoutStatus: payments.providerPayoutStatus,
      })
      .from(payments)
      .where(eq(payments.id, id))
      .limit(1);

    if (!paymentWithBooking) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (paymentWithBooking.providerPayoutStatus !== "pending") {
      return res.status(400).json({
        message: `Cannot mark as paid. Current status: ${paymentWithBooking.providerPayoutStatus || "null"}`
      });
    }

    // Update payments table (manual payout tracking)
    await db
      .update(payments)
      .set({
        providerPayoutStatus: "paid",
        providerPayoutAt: new Date(),
        // No Razorpay payout ID since this is manual
      })
      .where(eq(payments.id, id));

    // Also update booking table to keep in sync
    const providerPayoutAmountRupees = Math.round(Number(paymentWithBooking.providerShare) / 100);
    await db
      .update(bookings)
      .set({
        providerPayoutAmount: providerPayoutAmountRupees,
        providerPayoutStatus: "paid",
        providerPayoutAt: new Date(),
      })
      .where(eq(bookings.id, paymentWithBooking.bookingId));

    console.log("✅ Payout marked as paid (MANUAL MODE):", {
      paymentId: id,
      bookingId: paymentWithBooking.bookingId,
      amount: providerPayoutAmountRupees,
    });

    res.json({
      message: "Payout marked as paid successfully (manual tracking)",
      amount: paymentWithBooking.providerShare,
      amountInRupees: providerPayoutAmountRupees,
      note: "Remember to transfer money to provider manually via Razorpay Dashboard or UPI/Bank",
    });
  } catch (error) {
    console.error("Error marking payout as paid:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Bulk process payouts - Mark multiple payouts as paid
 * PUT /admin/payouts/process-bulk
 */
const bulkProcessPayouts = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { payoutIds, razorpayPayoutId } = req.body;

    if (!payoutIds || !Array.isArray(payoutIds) || payoutIds.length === 0) {
      return res.status(400).json({ message: "payoutIds array is required" });
    }

    // Get minimum payout amount
    const minimumPayoutAmount = Number(await getAdminSetting("minimum_payout_amount", "30000"));

    // Fetch all payments with their provider info
    const paymentsToProcess = await db
      .select({
        paymentId: payments.id,
        providerShare: payments.providerShare,
        providerId: businessProfiles.providerId,
        providerPayoutStatus: payments.providerPayoutStatus,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .innerJoin(businessProfiles, eq(bookings.businessProfileId, businessProfiles.id))
      .where(sql`${payments.id} = ANY(${payoutIds})`);

    // Group by provider and check minimum
    const providerTotals = new Map();
    const validPaymentIds = new Set();
    const skippedPayments = [];

    paymentsToProcess.forEach((p) => {
      if (p.providerPayoutStatus !== "pending") {
        skippedPayments.push({
          id: p.paymentId,
          reason: `Status is "${p.providerPayoutStatus}", not "pending"`
        });
        return;
      }

      const current = providerTotals.get(p.providerId) || 0;
      const newTotal = current + Number(p.providerShare || 0);
      providerTotals.set(p.providerId, newTotal);

      // Only include if provider meets minimum
      if (newTotal >= minimumPayoutAmount) {
        validPaymentIds.add(p.paymentId);
      } else {
        skippedPayments.push({
          id: p.paymentId,
          reason: `Provider total (₹${(newTotal / 100).toFixed(2)}) is below minimum (₹${(minimumPayoutAmount / 100).toFixed(2)})`
        });
      }
    });

    // Update all valid payments
    const updateData = {
      providerPayoutStatus: "paid",
      providerPayoutAt: new Date(),
    };

    if (razorpayPayoutId) {
      updateData.providerPayoutId = razorpayPayoutId;
    }

    const result = await db
      .update(payments)
      .set(updateData)
      .where(inArray(payments.id, Array.from(validPaymentIds)))
      .returning();

    // Also update corresponding bookings to keep in sync
    // Get booking IDs from updated payments
    const bookingIds = result.map(p => p.bookingId);
    const providerShareMap = new Map(result.map(p => [p.bookingId, Math.round(Number(p.providerShare) / 100)]));

    for (const bookingId of bookingIds) {
      await db
        .update(bookings)
        .set({
          providerPayoutAmount: providerShareMap.get(bookingId),
          providerPayoutStatus: "paid",
          providerPayoutId: razorpayPayoutId || null,
          providerPayoutAt: new Date(),
        })
        .where(eq(bookings.id, bookingId));
    }

    console.log("✅ Bulk payout processed - updated payments and bookings:", {
      processedCount: result.length,
      bookingIdsUpdated: bookingIds,
    });

    res.json({
      message: "Bulk payout processed successfully",
      processedCount: result.length,
      skippedCount: skippedPayments.length,
      skippedPayments,
      totalAmount: result.reduce((sum, p) => sum + Number(p.providerShare || 0), 0),
    });
  } catch (error) {
    console.error("Error processing bulk payouts:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get payouts grouped by provider (for provider-level payouts)
 * GET /admin/payouts/by-provider?filter=ready|waiting|all
 */
const getPayoutsByProvider = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { filter = "all" } = req.query;
    const minimumPayoutAmount = Number(await getAdminSetting("minimum_payout_amount", "30000"));

    // Get all pending payouts grouped by provider
    const providerPayouts = await db
      .select({
        providerId: businessProfiles.providerId,
        providerName: users.name,
        providerEmail: users.email,
        providerPhone: users.phone,
        businessName: businessProfiles.businessName,
        businessId: businessProfiles.id,
        totalPending: sql`SUM(${payments.providerShare})`,
        bookingCount: sql`COUNT(*)`,
        paymentIds: sql`array_agg(${payments.id})`,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .innerJoin(businessProfiles, eq(bookings.businessProfileId, businessProfiles.id))
      .innerJoin(users, eq(businessProfiles.providerId, users.id))
      .where(
        and(
          eq(payments.providerPayoutStatus, "pending"),
          eq(payments.status, "paid")
        )
      )
      .groupBy(businessProfiles.providerId, users.name, users.email, users.phone, businessProfiles.businessName, businessProfiles.id)
      .orderBy(desc(sql`SUM(${payments.providerShare})`));

    // Add metadata and fetch payment details for each provider
    let providersWithMeta = await Promise.all(
      providerPayouts.map(async (p) => {
        const totalPending = Number(p.totalPending) || 0;
        const bookingCount = Number(p.bookingCount) || 0;
        const paymentIds = p.paymentIds.filter((id) => id !== null);

        // Get provider's active payment details
        const [activePaymentDetails] = await db
          .select({
            upiId: paymentDetails.upiId,
            bankAccount: paymentDetails.bankAccount,
            ifscCode: paymentDetails.ifscCode,
            accountHolderName: paymentDetails.accountHolderName,
          })
          .from(paymentDetails)
          .where(and(eq(paymentDetails.userId, p.providerId), eq(paymentDetails.isActive, true)))
          .limit(1);

        // Mask bank account for security
        let bankAccountMasked = null;
        if (activePaymentDetails?.bankAccount) {
          const acc = activePaymentDetails.bankAccount;
          bankAccountMasked = `********${acc.slice(-4)}`;
        }

        return {
          ...p,
          totalPending,
          bookingCount,
          paymentIds,
          canProcessPayout: totalPending >= minimumPayoutAmount,
          minimumPayoutAmount,
          paymentDetails: activePaymentDetails ? {
            upiId: activePaymentDetails.upiId,
            bankAccount: activePaymentDetails.bankAccount,
            bankAccountMasked,
            ifscCode: activePaymentDetails.ifscCode,
            accountHolderName: activePaymentDetails.accountHolderName,
          } : null,
        };
      })
    );

    // Apply filter
    if (filter === "ready") {
      providersWithMeta = providersWithMeta.filter((p) => p.canProcessPayout);
    } else if (filter === "waiting") {
      providersWithMeta = providersWithMeta.filter((p) => !p.canProcessPayout);
    }

    res.json({
      providers: providersWithMeta,
      minimumPayoutAmount,
    });
  } catch (error) {
    console.error("Error fetching provider payouts:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Pay all pending payouts for a specific provider
 * PUT /admin/payouts/provider/:providerId/pay-all
 */
const payProvider = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { providerId } = req.params;
    const { razorpayPayoutId } = req.body;

    // Get all pending payments for this provider
    const providerPayments = await db
      .select({
        paymentId: payments.id,
        providerShare: payments.providerShare,
        providerPayoutStatus: payments.providerPayoutStatus,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .innerJoin(businessProfiles, eq(bookings.businessProfileId, businessProfiles.id))
      .where(
        and(
          eq(businessProfiles.providerId, Number(providerId)),
          eq(payments.providerPayoutStatus, "pending"),
          eq(payments.status, "paid")
        )
      );

    if (providerPayments.length === 0) {
      return res.status(404).json({ message: "No pending payouts found for this provider" });
    }

    const paymentIds = providerPayments.map((p) => p.paymentId);
    const totalAmount = providerPayments.reduce((sum, p) => sum + Number(p.providerShare || 0), 0);

    // Update all payments as paid
    const updateData = {
      providerPayoutStatus: "paid",
      providerPayoutAt: new Date(),
    };

    if (razorpayPayoutId) {
      updateData.providerPayoutId = razorpayPayoutId;
    }

    const result = await db
      .update(payments)
      .set(updateData)
      .where(inArray(payments.id, paymentIds))
      .returning();

    // Also update corresponding bookings to keep in sync
    for (const payment of result) {
      const providerPayoutAmountRupees = Math.round(Number(payment.providerShare) / 100);
      await db
        .update(bookings)
        .set({
          providerPayoutAmount: providerPayoutAmountRupees,
          providerPayoutStatus: "paid",
          providerPayoutId: razorpayPayoutId || null,
          providerPayoutAt: new Date(),
        })
        .where(eq(bookings.id, payment.bookingId));
    }

    console.log("✅ Provider payouts processed - updated payments and bookings:", {
      providerId: Number(providerId),
      processedCount: result.length,
    });

    res.json({
      message: "Provider payouts processed successfully",
      providerId: Number(providerId),
      processedCount: result.length,
      totalAmount,
      paymentIds,
    });
  } catch (error) {
    console.error("Error paying provider:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get dashboard stats for admin home page
 * GET /admin/dashboard/stats
 */
const getDashboardStats = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    // Get counts for users, businesses, services, bookings
    const [userCount] = await db
      .select({ count: sql`COUNT(*)` })
      .from(users);

    const [businessCount] = await db
      .select({
        total: sql`COUNT(*)`,
        verified: sql`COUNT(*) FILTER (WHERE ${businessProfiles.isVerified} = true)`,
      })
      .from(businessProfiles);

    const [serviceCount] = await db
      .select({
        total: sql`COUNT(*)`,
        active: sql`COUNT(*) FILTER (WHERE ${services.isActive} = true)`,
      })
      .from(services);

    // Get booking status breakdown
    const bookingStats = await db
      .select({
        status: bookings.status,
        count: sql`COUNT(*)`,
      })
      .from(bookings)
      .groupBy(bookings.status);

    const totalBookings = bookingStats.reduce((sum, b) => sum + Number(b.count), 0);
    const completedBookings = Number(bookingStats.find((b) => b.status === "completed")?.count || 0);
    const pendingBookings = Number(bookingStats.find((b) => b.status === "pending")?.count || 0);

    // Get platform revenue from paid payments
    const [revenueData] = await db
      .select({
        totalRevenue: sql`COALESCE(SUM(${payments.amount}), 0)`,
        totalPlatformFee: sql`COALESCE(SUM(${payments.platformFee}), 0)`,
        paymentCount: sql`COUNT(*)`,
      })
      .from(payments)
      .where(eq(payments.status, "paid"));

    // Get payout summary
    const minimumPayoutAmount = Number(await getAdminSetting("minimum_payout_amount", "30000"));
    const [payoutSummary] = await db
      .select({
        totalPending: sql`COALESCE(SUM(CASE WHEN ${payments.providerPayoutStatus} = 'pending' THEN ${payments.providerShare} ELSE 0 END), 0)`,
        countPending: sql`COUNT(CASE WHEN ${payments.providerPayoutStatus} = 'pending' THEN 1 END)`,
      })
      .from(payments)
      .where(sql`${payments.providerPayoutStatus} IS NOT NULL`);

    res.json({
      users: {
        total: Number(userCount?.count) || 0,
      },
      businesses: {
        total: Number(businessCount?.total) || 0,
        verified: Number(businessCount?.verified) || 0,
        pending: (Number(businessCount?.total) || 0) - (Number(businessCount?.verified) || 0),
      },
      services: {
        total: Number(serviceCount?.total) || 0,
        active: Number(serviceCount?.active) || 0,
      },
      bookings: {
        total: totalBookings,
        completed: completedBookings,
        pending: pendingBookings,
      },
      revenue: {
        totalRevenue: Number(revenueData?.totalRevenue) || 0,
        platformFees: Number(revenueData?.totalPlatformFee) || 0,
        paymentCount: Number(revenueData?.paymentCount) || 0,
      },
      payouts: {
        pendingAmount: Number(payoutSummary?.totalPending) || 0,
        pendingCount: Number(payoutSummary?.countPending) || 0,
        minimumThreshold: minimumPayoutAmount,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ============================================
// BUSINESS BLOCKING FUNCTIONS
// ============================================

/**
 * Block a business (admin only)
 * PUT /admin/business/:id/block
 */
const blockBusiness = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ message: "Reason is required to block a business" });
    }

    // Check if business exists
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, id))
      .limit(1);

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    if (business.isBlocked) {
      return res.status(400).json({ message: "Business is already blocked" });
    }

    // Block the business
    await db
      .update(businessProfiles)
      .set({
        isBlocked: true,
        blockedReason: reason.trim(),
        blockedAt: new Date(),
        blockedBy: req.token.id,
      })
      .where(eq(businessProfiles.id, id));

    console.log("✅ Business blocked:", {
      businessId: id,
      adminId: req.token.id,
      reason,
    });

    // Send notification to provider
    await notificationTemplates.businessBlocked(
      business.providerId,
      business.businessName,
      reason.trim()
    );

    res.json({
      message: "Business blocked successfully",
      businessId: id,
      reason,
    });
  } catch (error) {
    console.error("Error blocking business:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Unblock a business (admin only)
 * PUT /admin/business/:id/unblock
 */
const unblockBusiness = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { id } = req.params;

    // Check if business exists
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, id))
      .limit(1);

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    if (!business.isBlocked) {
      return res.status(400).json({ message: "Business is not blocked" });
    }

    // Unblock the business
    await db
      .update(businessProfiles)
      .set({
        isBlocked: false,
        blockedReason: null,
        blockedAt: null,
        blockedBy: null,
      })
      .where(eq(businessProfiles.id, id));

    console.log("✅ Business unblocked:", {
      businessId: id,
      adminId: req.token.id,
    });

    // Send notification to provider
    await notificationTemplates.businessUnblocked(
      business.providerId,
      business.businessName
    );

    res.json({
      message: "Business unblocked successfully",
      businessId: id,
    });
  } catch (error) {
    console.error("Error unblocking business:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ============================================
// SERVICE DEACTIVATION FUNCTIONS
// ============================================

/**
 * Deactivate a service (admin only)
 * PUT /admin/services/:id/deactivate
 */
const deactivateService = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ message: "Reason is required to deactivate a service" });
    }

    // Check if service exists
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, id))
      .limit(1);

    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    if (!service.isActive) {
      return res.status(400).json({ message: "Service is already deactivated" });
    }

    // Deactivate the service
    await db
      .update(services)
      .set({
        isActive: false,
        deactivationReason: reason.trim(),
        deactivatedAt: new Date(),
        deactivatedBy: req.token.id,
      })
      .where(eq(services.id, id));

    console.log("✅ Service deactivated:", {
      serviceId: id,
      adminId: req.token.id,
      reason,
    });

    // Get business info to send notification to provider
    const [business] = await db
      .select({ providerId: businessProfiles.providerId })
      .from(businessProfiles)
      .where(eq(businessProfiles.id, service.businessProfileId))
      .limit(1);

    // Send notification to provider
    if (business) {
      await notificationTemplates.serviceDeactivated(
        business.providerId,
        service.name,
        reason.trim()
      );
    }

    res.json({
      message: "Service deactivated successfully",
      serviceId: id,
      reason,
    });
  } catch (error) {
    console.error("Error deactivating service:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Activate a service (admin only)
 * PUT /admin/services/:id/activate
 */
const activateService = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { id } = req.params;

    // Check if service exists
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, id))
      .limit(1);

    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    if (service.isActive) {
      return res.status(400).json({ message: "Service is already active" });
    }

    // Activate the service
    await db
      .update(services)
      .set({
        isActive: true,
        deactivationReason: null,
        deactivatedAt: null,
        deactivatedBy: null,
      })
      .where(eq(services.id, id));

    console.log("✅ Service activated:", {
      serviceId: id,
      adminId: req.token.id,
    });

    // Get business info to send notification to provider
    const [business] = await db
      .select({ providerId: businessProfiles.providerId })
      .from(businessProfiles)
      .where(eq(businessProfiles.id, service.businessProfileId))
      .limit(1);

    // Send notification to provider
    if (business) {
      await notificationTemplates.serviceReactivated(
        business.providerId,
        service.name
      );
    }

    res.json({
      message: "Service activated successfully",
      serviceId: id,
    });
  } catch (error) {
    console.error("Error activating service:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get all services (admin only)
 * GET /admin/services
 * Returns all services including inactive ones
 */
const getAllServicesForAdmin = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const allServices = await db
      .select({
        id: services.id,
        name: services.name,
        description: services.description,
        price: services.price,
        EstimateDuration: services.EstimateDuration,
        image: services.image,
        isActive: services.isActive,
        businessProfileId: services.businessProfileId,
        deactivationReason: services.deactivationReason,
        deactivatedAt: services.deactivatedAt,
        createdAt: services.createdAt,
        // Business info
        businessName: businessProfiles.businessName,
        businessLogo: businessProfiles.logo,
        businessPhone: businessProfiles.phone,
        businessCity: businessProfiles.city,
        businessState: businessProfiles.state,
        businessIsVerified: businessProfiles.isVerified,
        businessIsBlocked: businessProfiles.isBlocked,
        businessCategoryId: businessProfiles.categoryId,
      })
      .from(services)
      .leftJoin(businessProfiles, eq(services.businessProfileId, businessProfiles.id))
      .orderBy(desc(services.createdAt));

    // Map EstimateDuration to duration for frontend compatibility
    const servicesWithDuration = allServices.map(service => ({
      ...service,
      duration: service.EstimateDuration,
      estimateDuration: service.EstimateDuration,
    }));

    res.json({ services: servicesWithDuration });
  } catch (error) {
    console.error("Error fetching services for admin:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  // Settings
  getPlatformSettings,
  updatePlatformSettings,
  getRevenueStats,
  // Dashboard
  getDashboardStats,
  // Payout Management
  getPayouts,
  getPayoutsSummary,
  getPayoutsByProvider,
  payProvider,
  markPayoutAsPaid,
  bulkProcessPayouts,
  // Business Blocking
  blockBusiness,
  unblockBusiness,
  // Service Deactivation
  deactivateService,
  activateService,
  getAllServicesForAdmin,
};
