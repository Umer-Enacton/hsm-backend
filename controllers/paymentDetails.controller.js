const db = require("../config/db");
const {
  users,
  businessProfiles,
  paymentDetails,
  adminSettings,
  payments,
  bookings,
} = require("../models/schema");
const { eq, and, desc, sql } = require("drizzle-orm");
const {
  createContact,
  createUPIFundAccount,
  createBankFundAccount,
} = require("../utils/razorpay");

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
 * Save payment details (admin or provider)
 * POST /payment-details
 */
const savePaymentDetails = async (req, res) => {
  try {
    const { paymentType, upiId, bankAccount, ifscCode, accountHolderName } =
      req.body;
    const userId = req.token.id;
    const userRoleId = req.token.roleId;

    // Only admin (roleId: 3) and providers (roleId: 2) can add payment details
    if (userRoleId !== 3 && userRoleId !== 2) {
      return res.status(403).json({
        message:
          "Access denied: Only admin and providers can add payment details",
      });
    }

    // Validate based on payment type
    if (paymentType === "upi" && !upiId) {
      return res
        .status(400)
        .json({ message: "UPI ID is required for UPI type" });
    }
    if (
      paymentType === "bank" &&
      (!bankAccount || !ifscCode || !accountHolderName)
    ) {
      return res
        .status(400)
        .json({
          message:
            "Bank account, IFSC code, and account holder name are required for bank type",
        });
    }

    // Get user details for Razorpay contact
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Create Razorpay contact
    const contact = await createContact(
      user.name,
      user.email,
      user.phone || "+919999999999",
    );

    let fundAccount;

    // Create Razorpay fund account based on payment type
    if (paymentType === "upi") {
      fundAccount = await createUPIFundAccount(upiId, contact.id);
    } else {
      fundAccount = await createBankFundAccount(
        bankAccount,
        ifscCode,
        accountHolderName,
        contact.id,
      );
    }

    // Deactivate all existing payment details for this user
    await db
      .update(paymentDetails)
      .set({ isActive: false })
      .where(eq(paymentDetails.userId, userId));

    // Save new payment details
    const [saved] = await db
      .insert(paymentDetails)
      .values({
        userId,
        paymentType,
        upiId: paymentType === "upi" ? upiId : null,
        bankAccount: paymentType === "bank" ? bankAccount : null,
        ifscCode: paymentType === "bank" ? ifscCode : null,
        accountHolderName: paymentType === "bank" ? accountHolderName : null,
        razorpayContactId: contact.id,
        razorpayFundAccountId: fundAccount.id,
        isActive: true,
      })
      .returning();

    // If provider, update business profile hasPaymentDetails flag
    if (userRoleId === 2) {
      await db
        .update(businessProfiles)
        .set({ hasPaymentDetails: true })
        .where(eq(businessProfiles.providerId, userId));
    }

    res.status(201).json({
      message: "Payment details saved successfully",
      data: {
        id: saved.id,
        paymentType: saved.paymentType,
        upiId: saved.upiId,
        bankAccount: saved.bankAccount
          ? `********${saved.bankAccount.slice(-4)}`
          : null,
        isActive: saved.isActive,
      },
    });
  } catch (error) {
    console.error("Error saving payment details:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Get user's payment details
 * GET /payment-details
 */
const getPaymentDetails = async (req, res) => {
  try {
    const userId = req.token.id;

    const details = await db
      .select()
      .from(paymentDetails)
      .where(eq(paymentDetails.userId, userId));

    // Mask sensitive information
    const maskedDetails = details.map((detail) => ({
      id: detail.id,
      paymentType: detail.paymentType,
      upiId: detail.upiId,
      bankAccount: detail.bankAccount
        ? `********${detail.bankAccount.slice(-4)}`
        : null,
      ifscCode: detail.ifscCode,
      accountHolderName: detail.accountHolderName,
      razorpayFundAccountId: detail.razorpayFundAccountId,
      isActive: detail.isActive,
      createdAt: detail.createdAt,
    }));

    res.json({ details: maskedDetails });
  } catch (error) {
    console.error("Error fetching payment details:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Set active payment method
 * PUT /payment-details/:id/set-active
 */
const setActivePaymentMethod = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.token.id;

    // Verify the payment detail belongs to this user
    const [paymentDetail] = await db
      .select()
      .from(paymentDetails)
      .where(and(eq(paymentDetails.id, id), eq(paymentDetails.userId, userId)))
      .limit(1);

    if (!paymentDetail) {
      return res.status(404).json({ message: "Payment detail not found" });
    }

    // Deactivate all for this user
    await db
      .update(paymentDetails)
      .set({ isActive: false })
      .where(eq(paymentDetails.userId, userId));

    // Activate selected one
    await db
      .update(paymentDetails)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(paymentDetails.id, id));

    res.json({ message: "Payment method activated successfully" });
  } catch (error) {
    console.error("Error activating payment method:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Update payment details
 * PUT /payment-details/:id
 */
const updatePaymentDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentType, upiId, bankAccount, ifscCode, accountHolderName } =
      req.body;
    const userId = req.token.id;
    const userRoleId = req.token.roleId;

    // Only admin (roleId: 3) and providers (roleId: 2) can update payment details
    if (userRoleId !== 3 && userRoleId !== 2) {
      return res.status(403).json({
        message:
          "Access denied: Only admin and providers can update payment details",
      });
    }

    // Verify the payment detail belongs to this user
    const [paymentDetail] = await db
      .select()
      .from(paymentDetails)
      .where(and(eq(paymentDetails.id, id), eq(paymentDetails.userId, userId)))
      .limit(1);

    if (!paymentDetail) {
      return res.status(404).json({ message: "Payment detail not found" });
    }

    // Get user details for Razorpay contact
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Validate based on payment type
    if (paymentType === "upi" && !upiId) {
      return res
        .status(400)
        .json({ message: "UPI ID is required for UPI type" });
    }
    if (
      paymentType === "bank" &&
      (!bankAccount || !ifscCode || !accountHolderName)
    ) {
      return res
        .status(400)
        .json({
          message:
            "Bank account, IFSC code, and account holder name are required for bank type",
        });
    }

    // Create Razorpay contact
    const contact = await createContact(
      user.name,
      user.email,
      user.phone || "+919999999999",
    );

    let fundAccount;

    // Create Razorpay fund account based on payment type
    if (paymentType === "upi") {
      fundAccount = await createUPIFundAccount(upiId, contact.id);
    } else {
      fundAccount = await createBankFundAccount(
        bankAccount,
        ifscCode,
        accountHolderName,
        contact.id,
      );
    }

    // Build update object
    const updateData = {
      paymentType,
      upiId: paymentType === "upi" ? upiId : null,
      bankAccount: paymentType === "bank" ? bankAccount : null,
      ifscCode: paymentType === "bank" ? ifscCode : null,
      accountHolderName: paymentType === "bank" ? accountHolderName : null,
      razorpayContactId: contact.id,
      razorpayFundAccountId: fundAccount.id,
      updatedAt: new Date(),
    };

    // Update payment details
    const [updated] = await db
      .update(paymentDetails)
      .set(updateData)
      .where(eq(paymentDetails.id, id))
      .returning();

    res.status(200).json({
      message: "Payment details updated successfully",
      data: {
        id: updated.id,
        paymentType: updated.paymentType,
        upiId: updated.upiId,
        bankAccount: updated.bankAccount
          ? `********${updated.bankAccount.slice(-4)}`
          : null,
        isActive: updated.isActive,
      },
    });
  } catch (error) {
    console.error("Error updating payment details:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Delete payment details
 * DELETE /payment-details/:id
 */
const deletePaymentDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.token.id;
    const userRoleId = req.token.roleId;

    // Verify the payment detail belongs to this user
    const [paymentDetail] = await db
      .select()
      .from(paymentDetails)
      .where(and(eq(paymentDetails.id, id), eq(paymentDetails.userId, userId)))
      .limit(1);

    if (!paymentDetail) {
      return res.status(404).json({ message: "Payment detail not found" });
    }

    // Delete the payment detail
    await db.delete(paymentDetails).where(eq(paymentDetails.id, id));

    // Check if user still has payment details
    const [remaining] = await db
      .select()
      .from(paymentDetails)
      .where(eq(paymentDetails.userId, userId))
      .limit(1);

    // If provider and no details left, update flag
    if (userRoleId === 2 && !remaining) {
      await db
        .update(businessProfiles)
        .set({ hasPaymentDetails: false })
        .where(eq(businessProfiles.providerId, userId));
    }

    res.json({ message: "Payment method deleted successfully" });
  } catch (error) {
    console.error("Error deleting payment details:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Check if admin has payment details (system health check)
 * GET /admin/check-payment-details
 */
const checkAdminPaymentDetails = async (req, res) => {
  try {
    // Find admin user (roleId: 3)
    const [admin] = await db
      .select()
      .from(users)
      .where(eq(users.roleId, 3))
      .limit(1);

    if (!admin) {
      return res.status(404).json({ message: "Admin user not found" });
    }

    // Check admin's payment details
    const adminPaymentDetails = await db
      .select()
      .from(paymentDetails)
      .where(eq(paymentDetails.userId, admin.id));

    res.json({
      hasPaymentDetails: adminPaymentDetails.length > 0,
      paymentCount: adminPaymentDetails.length,
      activeDetails: adminPaymentDetails.filter((d) => d.isActive).length,
    });
  } catch (error) {
    console.error("Error checking admin payment details:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get platform settings
 * GET /admin/settings
 */
const getPlatformSettings = async (req, res) => {
  try {
    // Only admin (roleId: 3) can access settings
    if (req.token.roleId !== 3) {
      return res
        .status(403)
        .json({ message: "Access denied: Admin access required" });
    }

    const platformFeePercentage = await getAdminSetting(
      "platform_fee_percentage",
      "5",
    );
    const minimumPayoutAmount = await getAdminSetting(
      "minimum_payout_amount",
      "100000",
    );

    res.json({
      platformFeePercentage: Number(platformFeePercentage),
      minimumPayoutAmount: Number(minimumPayoutAmount), // in paise
    });
  } catch (error) {
    console.error("Error fetching platform settings:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Update platform settings
 * PUT /admin/settings
 */
const updatePlatformSettings = async (req, res) => {
  try {
    // Only admin (roleId: 3) can update settings
    if (req.token.roleId !== 3) {
      return res
        .status(403)
        .json({ message: "Access denied: Admin access required" });
    }

    const { platformFeePercentage, minimumPayoutAmount } = req.body;

    // Validate platform fee percentage (1-50%)
    if (
      platformFeePercentage !== undefined &&
      (platformFeePercentage < 1 || platformFeePercentage > 50)
    ) {
      return res
        .status(400)
        .json({ message: "Platform fee must be between 1 and 50 percent" });
    }

    // Validate minimum payout amount (at least ₹100 = 10000 paise)
    if (minimumPayoutAmount !== undefined && minimumPayoutAmount < 10000) {
      return res
        .status(400)
        .json({ message: "Minimum payout must be at least ₹100" });
    }

    // Update settings if provided
    if (platformFeePercentage !== undefined) {
      await setAdminSetting(
        "platform_fee_percentage",
        String(platformFeePercentage),
        "Platform fee percentage charged on each booking",
      );
    }

    if (minimumPayoutAmount !== undefined) {
      await setAdminSetting(
        "minimum_payout_amount",
        String(minimumPayoutAmount),
        "Minimum payout amount in paise",
      );
    }

    res.json({
      message: "Settings updated successfully",
      platformFeePercentage: 5, // Hardcoded at 5%
      minimumPayoutAmount:
        minimumPayoutAmount !== undefined
          ? Number(minimumPayoutAmount)
          : Number(await getAdminSetting("minimum_payout_amount", "100000")),
    });
  } catch (error) {
    console.error("Error updating platform settings:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get platform revenue statistics
 * GET /admin/revenue
 */
const getRevenueStats = async (req, res) => {
  try {
    // Only admin (roleId: 3) can access revenue stats
    if (req.token.roleId !== 3) {
      return res
        .status(403)
        .json({ message: "Access denied: Admin access required" });
    }

    const { startDate, endDate, groupBy } = req.query;

    // Calculate total revenue from completed payments
    const [revenueData] = await db
      .select({
        totalRevenue: sql`COALESCE(SUM(${payments.amount}), 0)`,
        platformFees: sql`COALESCE(SUM(${payments.platformFee}), 0)`,
        providerPayouts: sql`COALESCE(SUM(${payments.providerShare}), 0)`,
        totalBookings: sql`COUNT(*)`,
      })
      .from(payments)
      .where(eq(payments.status, "paid"));

    // Get monthly breakdown for the current year
    const currentYear = new Date().getFullYear();
    const monthlyBreakdown = await db
      .select({
        period: sql`TO_CHAR(${payments.createdAt}, 'Mon')`,
        revenue: sql`COALESCE(SUM(${payments.amount}), 0)`,
        platformFees: sql`COALESCE(SUM(${payments.platformFee}), 0)`,
        bookings: sql`COUNT(*)`,
      })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .where(sql`EXTRACT(YEAR FROM ${payments.createdAt}) = ${currentYear}`)
      .groupBy(sql`TO_CHAR(${payments.createdAt}, 'Mon')`)
      .orderBy(sql`TO_CHAR(${payments.createdAt}, 'Mon')`);

    // Format the breakdown
    const breakdown = monthlyBreakdown.map((item) => ({
      period: item.period,
      revenue: Number(item.revenue),
      platformFees: Number(item.platformFees),
      bookings: Number(item.bookings),
    }));

    res.json({
      totalRevenue: Number(revenueData.totalRevenue) || 0,
      platformFees: Number(revenueData.platformFees) || 0,
      providerPayouts: Number(revenueData.providerPayouts) || 0,
      totalBookings: Number(revenueData.totalBookings) || 0,
      breakdown,
    });
  } catch (error) {
    console.error("Error fetching revenue stats:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get provider's revenue/earnings stats
 * GET /provider/revenue
 */
const getProviderRevenueStats = async (req, res) => {
  try {
    const providerId = req.token.id;
    console.log("📊 Fetching provider revenue for providerId:", providerId);

    // Get provider's business profile
    const businessList = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, providerId));

    if (businessList.length === 0) {
      console.log("❌ Business profile not found for provider:", providerId);
      return res.status(404).json({
        message: "Business profile not found",
        debug: {
          providerId,
          hint: "Your account may not be linked to a business profile",
        },
      });
    }
    const business = businessList[0];
    console.log("✅ Found business:", {
      id: business.id,
      name: business.businessName,
    });

    // Get ALL bookings for this provider's business
    const allBookings = await db
      .select()
      .from(bookings)
      .where(eq(bookings.businessProfileId, business.id));

    // Get provider's subscription to determine platform fee percentage (for fallback calculation only)
    let providerSharePercentage = 95; // Default fallback
    try {
      const { getProviderActiveSubscription } = require("./providerSubscription.controller");
      const providerSubscription = await getProviderActiveSubscription(providerId);
      if (providerSubscription && providerSubscription.planPlatformFeePercentage !== undefined) {
        providerSharePercentage = 100 - providerSubscription.planPlatformFeePercentage;
      }
      console.log('📊 Provider subscription for revenue:', {
        planName: providerSubscription?.planName,
        platformFeePercentage: providerSubscription?.planPlatformFeePercentage,
        providerSharePercentage
      });
    } catch (error) {
      console.error("Error fetching provider subscription for revenue stats:", error);
    }

    // Filter out cancelled, rejected, and refunded bookings for base earnings
    const earningsBookings = allBookings.filter(
      (b) =>
        b.status !== "cancelled" &&
        b.status !== "rejected" &&
        b.status !== "refunded" &&
        !b.isRefunded,
    );

    // Fetch all successful payments for this business up front (for reschedule fee calculation)
    const allPaidPayments = await db
      .select()
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.businessProfileId, business.id),
          eq(payments.status, "paid")
        )
      );

    // Calculate total earnings from bookings (providerEarning already includes reschedule fees)
    let totalEarnings = 0;

    allBookings.forEach(booking => {
      // Use providerEarning if available (already includes service earnings + reschedule fees)
      if (booking.providerEarning !== null && booking.providerEarning !== undefined) {
        totalEarnings += Number(booking.providerEarning) / 100;
      }
      // Fallback to providerPayoutAmount for cancelled bookings with payouts
      else if (booking.providerPayoutAmount) {
        totalEarnings += Number(booking.providerPayoutAmount);
      }
      // Final fallback for very old bookings without providerEarning
      else if (booking.status !== "cancelled" && booking.status !== "rejected" && booking.status !== "refunded" && !booking.isRefunded) {
        totalEarnings += Math.round(((booking.totalPrice || 0) * providerSharePercentage) / 100);
      }
    });

    // Calculate reschedule revenue separately (just for display breakdown)
    let totalRescheduleRevenue = 0;
    allPaidPayments.forEach(p => {
      // payment info is in p.payments due to innerJoin
      if (p.payments.amount === 10000) {
        // For reschedule fees, the provider gets the full share or partial based on split
        if (p.payments.providerShare) {
          totalRescheduleRevenue += Math.round(p.payments.providerShare / 100);
        } else {
          totalRescheduleRevenue += 100;
        }
      }
    });

    // Calculate base earnings (total - reschedule fees) for display
    const baseEarnings = totalEarnings - totalRescheduleRevenue;

    console.log(
      "💰 Calculation: Total Earnings = ₹" +
        totalEarnings +
        ", Base Earnings = ₹" +
        baseEarnings +
        ", Reschedule Fees = ₹" +
        totalRescheduleRevenue,
    );

    // Count by status (from all bookings)
    const stats = {
      totalBookings: allBookings.length,
      completedBookings: allBookings.filter(b => b.status === "completed").length,
      pendingBookings: allBookings.filter(b => b.status === "pending").length,
      confirmedBookings: allBookings.filter(b => b.status === "confirmed").length,
      cancelledBookings: allBookings.filter(b => b.status === "cancelled").length,
      rejectedBookings: allBookings.filter(b => b.status === "rejected").length,
      refundedBookings: allBookings.filter(b => b.status === "refunded" || b.isRefunded).length,
    };

    // Calculate payout totals
    const pendingPayouts = allPaidPayments.reduce((sum, p) => {
      return p.payments.providerPayoutStatus === "pending"
        ? sum + (Number(p.payments.providerShare) || 0)
        : sum;
    }, 0) / 100;

    const paidPayouts = allPaidPayments.reduce((sum, p) => {
      return p.payments.providerPayoutStatus === "paid"
        ? sum + (Number(p.payments.providerShare) || 0)
        : sum;
    }, 0) / 100;

    const response = {
      totalEarnings: Number(totalEarnings) || 0,
      baseEarnings: Number(baseEarnings) || 0,
      rescheduleRevenue: Number(totalRescheduleRevenue) || 0,
      pendingPayouts: Number(pendingPayouts) || 0,
      paidPayouts: Number(paidPayouts) || 0,
      ...stats,
      breakdown: [] // Will be populated if needed
    };

    // Monthly breakdown current year
    const currentYear = new Date().getFullYear();
    const monthlyBreakdown = await db
      .select({
        period: sql`TO_CHAR(${bookings.bookingDate}, 'Mon')`,
        totalRevenue: sql`COALESCE(SUM(${bookings.totalPrice}), 0)`,
        bookings: sql`COUNT(*)`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessProfileId, business.id),
          sql`EXTRACT(YEAR FROM ${bookings.bookingDate}) = ${currentYear}`,
          sql`${bookings.status} NOT IN ('cancelled', 'rejected', 'refunded')`,
          sql`${bookings.isRefunded} = false`
        )
      )
      .groupBy(sql`TO_CHAR(${bookings.bookingDate}, 'Mon')`)
      .orderBy(sql`TO_CHAR(${bookings.bookingDate}, 'Mon')`);

    response.breakdown = monthlyBreakdown.map((item) => ({
      period: item.period,
      earnings: Math.round(((Number(item.totalRevenue) || 0) * providerSharePercentage) / 100),
      bookings: Number(item.bookings),
    }));

    console.log("📊 Sending provider revenue response:", response);
    res.json(response);
  } catch (error) {
    console.error("Error fetching provider revenue stats:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  savePaymentDetails,
  getPaymentDetails,
  updatePaymentDetails,
  setActivePaymentMethod,
  deletePaymentDetails,
  checkAdminPaymentDetails,
  getAdminSetting,
  setAdminSetting,
  getPlatformSettings,
  updatePlatformSettings,
  getRevenueStats,
  getProviderRevenueStats,
};
