const db = require("../config/db");
const {
  staffPayouts,
  staff,
  users,
  businessProfiles,
  bookings,
  paymentDetails,
} = require("../models/schema");
const { eq, and, sql, desc, count, sum, inArray } = require("drizzle-orm");

// ============================================
// STAFF EARNINGS & PAYOUTS CONTROLLERS
// ============================================

/**
 * Calculate staff earning for a booking
 * @param {Object} booking - Booking object with staff earning configuration
 * @returns {number} - Earning amount in paise
 */
function calculateStaffEarning(booking) {
  const { providerEarning, totalPrice, staffEarningType, staffCommissionPercent, staffFixedAmount } = booking;

  if (staffEarningType === "commission") {
    // Commission-based: % of provider earning (not total price)
    // This ensures staff gets percentage of what provider actually earns
    const baseAmount = providerEarning || totalPrice;
    return Math.round((baseAmount * (staffCommissionPercent || 10)) / 100);
  } else if (staffEarningType === "fixed") {
    // Fixed amount per booking
    return staffFixedAmount || 0;
  }
  // No earning type set
  return 0;
}

/**
 * Get staff earnings (Staff only)
 * GET /api/staff-payouts/my-earnings
 */
const getStaffEarnings = async (req, res) => {
  try {
    const { period } = req.query; // week, month, year, all

    // Get staff record for this user
    const [staffMember] = await db
      .select()
      .from(staff)
      .where(eq(staff.userId, req.token.id));

    if (!staffMember) {
      return res.status(400).json({ message: "Staff record not found" });
    }

    // Build date filter
    let dateFilter;
    const now = new Date();
    switch (period) {
      case "week":
        dateFilter = sql`DATE(${staffPayouts.createdAt}) >= DATE(NOW() - INTERVAL '7 days')`;
        break;
      case "month":
        dateFilter = sql`DATE_TRUNC('month', ${staffPayouts.createdAt}) = DATE_TRUNC('month', NOW())`;
        break;
      case "year":
        dateFilter = sql`DATE_TRUNC('year', ${staffPayouts.createdAt}) = DATE_TRUNC('year', NOW())`;
        break;
      default:
        dateFilter = undefined;
    }

    // Get earnings breakdown
    let earningsQuery = db
      .select({
        id: staffPayouts.id,
        amount: staffPayouts.amount,
        payoutStatus: staffPayouts.payoutStatus,
        calculationType: staffPayouts.calculationType,
        hoursWorked: staffPayouts.hoursWorked,
        notes: staffPayouts.notes,
        createdAt: staffPayouts.createdAt,
        payoutDate: staffPayouts.payoutDate,
        // Booking info
        bookingId: staffPayouts.bookingId,
      })
      .from(staffPayouts)
      .where(eq(staffPayouts.staffId, staffMember.id));

    if (dateFilter) {
      earningsQuery = earningsQuery.where(dateFilter);
    }

    const earnings = await earningsQuery.orderBy(desc(staffPayouts.createdAt));

    // Calculate totals
    // Calculate totals - include completed bookings count from bookings table
    const [totals] = await db
      .select({
        totalEarnings: sql`COALESCE(SUM(${staffPayouts.amount}), 0)`,
        pendingPayout: sql`COALESCE(SUM(CASE WHEN ${staffPayouts.payoutStatus} = 'pending' THEN ${staffPayouts.amount} ELSE 0 END), 0)`,
        paidAmount: sql`COALESCE(SUM(CASE WHEN ${staffPayouts.payoutStatus} = 'paid' THEN ${staffPayouts.amount} ELSE 0 END), 0)`,
      })
      .from(staffPayouts)
      .where(eq(staffPayouts.staffId, staffMember.id));

    // Count completed bookings separately (from bookings table, not payouts)
    const completedBookingsConditions = [
      eq(bookings.assignedStaffId, staffMember.id),
      eq(bookings.status, 'completed'),
    ];

    // Apply same date filter to completed bookings count
    if (dateFilter) {
      completedBookingsConditions.push(
        sql`DATE_TRUNC('month', ${bookings.createdAt}) = DATE_TRUNC('month', NOW())`
      );
    }

    const [{ count: completedBookingsCount }] = await db
      .select({ count: count() })
      .from(bookings)
      .where(and(...completedBookingsConditions));

    res.json({
      message: "Earnings retrieved successfully",
      data: {
        earnings,
        totals: {
          totalEarnings: parseInt(totals.totalEarnings) || 0,
          pendingPayout: parseInt(totals.pendingPayout) || 0,
          paidAmount: parseInt(totals.paidAmount) || 0,
          completedBookings: parseInt(completedBookingsCount) || 0,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching staff earnings:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get staff payout history (Staff only)
 * GET /api/staff-payouts/my-payouts
 */
const getStaffPayouts = async (req, res) => {
  try {
    const { status } = req.query; // pending, processing, paid, failed

    // Get staff record for this user
    const [staffMember] = await db
      .select()
      .from(staff)
      .where(eq(staff.userId, req.token.id));

    if (!staffMember) {
      return res.status(400).json({ message: "Staff record not found" });
    }

    // Build query
    let query = db
      .select({
        id: staffPayouts.id,
        amount: staffPayouts.amount,
        payoutStatus: staffPayouts.payoutStatus,
        payoutId: staffPayouts.payoutId,
        payoutDate: staffPayouts.payoutDate,
        calculationType: staffPayouts.calculationType,
        hoursWorked: staffPayouts.hoursWorked,
        notes: staffPayouts.notes,
        createdAt: staffPayouts.createdAt,
        // Booking info
        bookingId: staffPayouts.bookingId,
      })
      .from(staffPayouts)
      .where(eq(staffPayouts.staffId, staffMember.id));

    // Apply status filter
    if (status) {
      query = query.where(eq(staffPayouts.payoutStatus, status));
    }

    const payouts = await query.orderBy(desc(staffPayouts.createdAt));

    res.json({
      message: "Payouts retrieved successfully",
      data: payouts,
    });
  } catch (error) {
    console.error("Error fetching staff payouts:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get all staff earnings for a business (Provider only)
 * GET /api/staff-payouts/business
 */
const getBusinessStaffEarnings = async (req, res) => {
  try {
    const { startDate, endDate, staffId } = req.query;

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    // Build query with joins
    let query = db
      .select({
        id: staffPayouts.id,
        amount: staffPayouts.amount,
        payoutStatus: staffPayouts.payoutStatus,
        calculationType: staffPayouts.calculationType,
        hoursWorked: staffPayouts.hoursWorked,
        createdAt: staffPayouts.createdAt,
        payoutDate: staffPayouts.payoutDate,
        // Staff info
        staffId: staffPayouts.staffId,
        staffName: users.name,
        staffEmail: users.email,
        employeeId: staff.employeeId,
        // Booking info
        bookingId: staffPayouts.bookingId,
      })
      .from(staffPayouts)
      .leftJoin(staff, eq(staffPayouts.staffId, staff.id))
      .leftJoin(users, eq(staff.userId, users.id))
      .where(eq(staffPayouts.businessProfileId, business.id));

    // Apply filters
    if (staffId) {
      query = query.where(eq(staffPayouts.staffId, parseInt(staffId)));
    }

    if (startDate && endDate) {
      query = query.where(
        sql`DATE(${staffPayouts.createdAt}) >= ${startDate} AND DATE(${staffPayouts.createdAt}) <= ${endDate}`
      );
    }

    const payouts = await query.orderBy(desc(staffPayouts.createdAt));

    // Calculate totals by staff
    const staffTotals = await db
      .select({
        staffId: staffPayouts.staffId,
        staffName: users.name,
        employeeId: staff.employeeId,
        totalEarnings: sql`SUM(${staffPayouts.amount})`,
        pendingPayout: sql`SUM(CASE WHEN ${staffPayouts.payoutStatus} = 'pending' THEN ${staffPayouts.amount} ELSE 0 END)`,
        paidAmount: sql`SUM(CASE WHEN ${staffPayouts.payoutStatus} = 'paid' THEN ${staffPayouts.amount} ELSE 0 END)`,
        bookingCount: sql`COUNT(DISTINCT ${staffPayouts.bookingId})`,
      })
      .from(staffPayouts)
      .leftJoin(staff, eq(staffPayouts.staffId, staff.id))
      .leftJoin(users, eq(staff.userId, users.id))
      .where(eq(staffPayouts.businessProfileId, business.id))
      .groupBy(staffPayouts.staffId, users.name, staff.employeeId);

    res.json({
      message: "Staff earnings retrieved successfully",
      data: {
        payouts,
        staffTotals,
      },
    });
  } catch (error) {
    console.error("Error fetching business staff earnings:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get payout summary for processing (Provider only)
 * GET /api/staff-payouts/summary
 */
const getPayoutSummary = async (req, res) => {
  try {
    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    // Get staff with pending payouts
    const pendingPayouts = await db
      .select({
        staffId: staffPayouts.staffId,
        staffName: users.name,
        staffEmail: users.email,
        employeeId: staff.employeeId,
        upiId: staff.upiId,
        totalPending: sql`SUM(${staffPayouts.amount})`,
        payoutCount: sql`COUNT(*)`,
      })
      .from(staffPayouts)
      .leftJoin(staff, eq(staffPayouts.staffId, staff.id))
      .leftJoin(users, eq(staff.userId, users.id))
      .where(
        and(
          eq(staffPayouts.businessProfileId, business.id),
          eq(staffPayouts.payoutStatus, "pending")
        )
      )
      .groupBy(staffPayouts.staffId, users.name, users.email, staff.employeeId, staff.upiId);

    // Get overall totals
    const [totals] = await db
      .select({
        totalPendingAmount: sql`COALESCE(SUM(CASE WHEN ${staffPayouts.payoutStatus} = 'pending' THEN ${staffPayouts.amount} ELSE 0 END), 0)`,
        totalPaidAmount: sql`COALESCE(SUM(CASE WHEN ${staffPayouts.payoutStatus} = 'paid' THEN ${staffPayouts.amount} ELSE 0 END), 0)`,
        pendingCount: sql`COUNT(CASE WHEN ${staffPayouts.payoutStatus} = 'pending' THEN 1 END)`,
      })
      .from(staffPayouts)
      .where(eq(staffPayouts.businessProfileId, business.id));

    res.json({
      message: "Payout summary retrieved successfully",
      data: {
        pendingPayouts,
        totals: {
          totalPendingAmount: parseInt(totals.totalPendingAmount) || 0,
          totalPaidAmount: parseInt(totals.totalPaidAmount) || 0,
          pendingCount: parseInt(totals.pendingCount) || 0,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching payout summary:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Process payout to staff (Provider only)
 * POST /api/staff-payouts/process
 */
const processPayout = async (req, res) => {
  try {
    const { staffId, payoutIds } = req.body; // Either specific staff or specific payout IDs

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    // Build query to find pending payouts
    let query = db
      .select()
      .from(staffPayouts)
      .where(
        and(
          eq(staffPayouts.businessProfileId, business.id),
          eq(staffPayouts.payoutStatus, "pending")
        )
      );

    if (staffId) {
      query = query.where(eq(staffPayouts.staffId, parseInt(staffId)));
    }

    if (payoutIds && Array.isArray(payoutIds)) {
      query = query.where(inArray(staffPayouts.id, payoutIds));
    }

    const pendingPayouts = await query;

    if (pendingPayouts.length === 0) {
      return res.status(400).json({ message: "No pending payouts found" });
    }

    // Update payouts to processing
    const payoutIdsToUpdate = pendingPayouts.map((p) => p.id);
    await db
      .update(staffPayouts)
      .set({ payoutStatus: "processing" })
      .where(inArray(staffPayouts.id, payoutIdsToUpdate));

    // TODO: Integrate with Razorpay for actual payout
    // For now, mark as paid
    const payoutId = `PAYOUT_${Date.now()}`;

    await db
      .update(staffPayouts)
      .set({
        payoutStatus: "paid",
        payoutId,
        payoutDate: new Date(),
      })
      .where(inArray(staffPayouts.id, payoutIdsToUpdate));

    // Update staff totals
    const totalAmount = pendingPayouts.reduce(
      (sum, p) => sum + parseInt(p.amount),
      0
    );

    // Group by staffId and update their totals
    const staffGroups = {};
    pendingPayouts.forEach((p) => {
      if (!staffGroups[p.staffId]) {
        staffGroups[p.staffId] = 0;
      }
      staffGroups[p.staffId] += parseInt(p.amount);
    });

    for (const [sid, amount] of Object.entries(staffGroups)) {
      await db
        .update(staff)
        .set({
          pendingPayout: sql`${staff.pendingPayout} - ${amount}`,
          totalPaid: sql`${staff.totalPaid} + ${amount}`,
        })
        .where(eq(staff.id, parseInt(sid)));
    }

    res.json({
      message: "Payout processed successfully",
      data: {
        payoutId,
        amount: totalAmount,
        count: pendingPayouts.length,
      },
    });
  } catch (error) {
    console.error("Error processing payout:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Create payout record when booking is completed
 * Called internally by booking controller
 * @param {number} bookingId - Booking ID
 * @param {number} staffId - Staff ID
 * @param {number} amount - Earning amount
 */
const createStaffPayout = async (bookingId, staffId, amount) => {
  try {
    // Get booking details to get earning type
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      console.error("Booking not found for payout creation");
      return;
    }

    // Get staff details
    const [staffMember] = await db
      .select()
      .from(staff)
      .where(eq(staff.id, staffId));

    if (!staffMember) {
      console.error("Staff not found for payout creation");
      return;
    }

    // Create payout record with booking's earning type
    await db.insert(staffPayouts).values({
      staffId,
      businessProfileId: staffMember.businessProfileId,
      bookingId,
      amount,
      commissionPercentage: booking.staffCommissionPercent,
      payoutStatus: "pending",
      calculationType: booking.staffEarningType || "commission",
    });

    // Update staff pending payout
    await db
      .update(staff)
      .set({
        totalEarnings: sql`${staff.totalEarnings} + ${amount}`,
        pendingPayout: sql`${staff.pendingPayout} + ${amount}`,
      })
      .where(eq(staff.id, staffId));

    console.log(
      `Staff payout created: Booking ${bookingId}, Staff ${staffId}, Amount ${amount} paise (₹${amount / 100})`
    );
  } catch (error) {
    console.error("Error creating staff payout:", error);
  }
};

/**
 * Get staff payout summary for provider (Provider only)
 * GET /api/staff-payouts/provider-summary
 */
const getProviderStaffPayoutSummary = async (req, res) => {
  try {
    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    // Get staff with pending payouts (grouped by staff)
    const pendingPayouts = await db
      .select({
        staffId: staffPayouts.staffId,
        staffName: users.name,
        staffEmail: users.email,
        staffAvatar: users.avatar,
        employeeId: staff.employeeId,
        upiId: paymentDetails.upiId,
        bankAccount: paymentDetails.bankAccount,
        totalPending: sql`SUM(${staffPayouts.amount})`,
        payoutCount: sql`COUNT(*)`,
      })
      .from(staffPayouts)
      .leftJoin(staff, eq(staffPayouts.staffId, staff.id))
      .leftJoin(users, eq(staff.userId, users.id))
      .leftJoin(paymentDetails, and(
        eq(paymentDetails.userId, users.id),
        eq(paymentDetails.isActive, true)
      ))
      .where(
        and(
          eq(staffPayouts.businessProfileId, business.id),
          eq(staffPayouts.payoutStatus, "pending")
        )
      )
      .groupBy(staffPayouts.staffId, users.name, users.email, users.avatar, staff.employeeId, paymentDetails.upiId, paymentDetails.bankAccount);

    // Get overall totals
    const [totals] = await db
      .select({
        totalPendingAmount: sql`COALESCE(SUM(CASE WHEN ${staffPayouts.payoutStatus} = 'pending' THEN ${staffPayouts.amount} ELSE 0 END), 0)`,
        totalPaidAmount: sql`COALESCE(SUM(CASE WHEN ${staffPayouts.payoutStatus} = 'paid' THEN ${staffPayouts.amount} ELSE 0 END), 0)`,
        pendingCount: sql`COUNT(CASE WHEN ${staffPayouts.payoutStatus} = 'pending' THEN 1 END)`,
      })
      .from(staffPayouts)
      .where(eq(staffPayouts.businessProfileId, business.id));

    res.json({
      message: "Payout summary retrieved successfully",
      data: {
        pendingPayouts,
        totals: {
          totalPendingAmount: parseInt(totals.totalPendingAmount) || 0,
          totalPaidAmount: parseInt(totals.totalPaidAmount) || 0,
          pendingCount: parseInt(totals.pendingCount) || 0,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching payout summary:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Process staff payout (Provider only) - Manual payout
 * POST /api/staff-payouts/provider-process
 */
const processProviderStaffPayout = async (req, res) => {
  try {
    const { staffId } = req.body;

    if (!staffId) {
      return res.status(400).json({ message: "Staff ID is required" });
    }

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    // Get pending payouts for this staff
    const pendingPayouts = await db
      .select()
      .from(staffPayouts)
      .where(
        and(
          eq(staffPayouts.businessProfileId, business.id),
          eq(staffPayouts.staffId, parseInt(staffId)),
          eq(staffPayouts.payoutStatus, "pending")
        )
      );

    if (pendingPayouts.length === 0) {
      return res.status(400).json({ message: "No pending payouts found for this staff" });
    }

    const payoutIds = pendingPayouts.map((p) => p.id);
    const totalAmount = pendingPayouts.reduce((sum, p) => sum + parseInt(p.amount), 0);

    // Mark all as paid (manual payout)
    const payoutId = `STAFF_PAYOUT_${Date.now()}`;

    await db
      .update(staffPayouts)
      .set({ payoutStatus: "paid", payoutId, payoutDate: new Date() })
      .where(inArray(staffPayouts.id, payoutIds));

    // Update staff totals
    await db
      .update(staff)
      .set({
        pendingPayout: sql`${staff.pendingPayout} - ${totalAmount}`,
        totalPaid: sql`${staff.totalPaid} + ${totalAmount}`,
      })
      .where(eq(staff.id, parseInt(staffId)));

    // Notify staff about payout
    const [staffMember] = await db
      .select()
      .from(staff)
      .leftJoin(users, eq(staff.userId, users.id))
      .where(eq(staff.id, parseInt(staffId)))
      .limit(1);

    if (staffMember) {
      try {
        await notificationTemplates.staffPayoutReceived(staffMember.userId, {
          amount: totalAmount,
          payoutId,
          bookingCount: pendingPayouts.length,
        });
      } catch (notifError) {
        console.error("Failed to send payout notification:", notifError);
      }
    }

    res.json({
      message: "Payout marked as paid successfully",
      data: {
        payoutId,
        amount: totalAmount,
        count: pendingPayouts.length,
      },
    });
  } catch (error) {
    console.error("Error processing payout:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getStaffEarnings,
  getStaffPayouts,
  getBusinessStaffEarnings,
  getPayoutSummary,
  processPayout,
  createStaffPayout, // Exported for use by booking controller
  calculateStaffEarning,
  getProviderStaffPayoutSummary, // Provider-specific payouts
  processProviderStaffPayout, // Provider-specific payout processing
};
