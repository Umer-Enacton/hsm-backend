const db = require("../config/db");
const {
  bookings,
  payments,
  services,
  businessProfiles,
  slots,
} = require("../models/schema");
const { eq, and, sql, desc, gte, lte, innerJoin } = require("drizzle-orm");
const { getProviderActiveSubscription } = require("./providerSubscription.controller");

/**
 * Get date range based on period
 */
function getDateRange(period) {
  const now = new Date();
  let startDate = new Date(); // Default to now

  switch (period) {
    case "7d":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
    case "1m":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "6m":
      startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
      break;
    case "12m":
    case "1y":
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      break;
    case "all":
    default:
      // Show last 2 years for "all" to avoid too many data points
      startDate = new Date(now.getFullYear() - 2, now.getMonth(), 1);
      break;
  }

  return { startDate, endDate: now };
}

/**
 * Format date for grouping (YYYY-MM-DD for daily, YYYY-MM for monthly)
 */
function formatDateForGrouping(date, period) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  // For short periods, use daily grouping (YYYY-MM-DD)
  // For long periods, use monthly grouping (YYYY-MM)
  if (period === "7d" || period === "30d") {
    return `${year}-${month}-${day}`;
  }
  // For 6m, 12m, all - use monthly grouping
  return `${year}-${month}`;
}

/**
 * Get revenue and bookings over time
 * GET /provider/analytics/revenue?period=7d|30d|6m|12m|all
 */
const getRevenueAnalytics = async (req, res) => {
  try {
    if (req.token.roleId !== 2) {
      return res.status(403).json({ message: "Access denied: Provider only" });
    }

    // ============================================
    // SUBSCRIPTION-BASED ANALYTICS ACCESS CONTROL
    // ============================================
    const subscription = await getProviderActiveSubscription(req.token.id);

    // Check if provider has analytics access
    if (!subscription || !subscription.planAnalyticsAccess) {
      return res.status(403).json({
        message: "Analytics not available on your plan. Upgrade to Pro or Premium.",
        code: "ANALYTICS_ACCESS_DENIED",
        currentPlan: subscription?.planName || "Free",
      });
    }

    // Get allowed graphs from subscription features
    const planFeatures = subscription.planFeatures || {};
    const allowedGraphs = planFeatures.allowedGraphs || ["revenue_chart"];

    const { period = "30d" } = req.query;
    const { startDate, endDate } = getDateRange(period);

    console.log(
      "[Analytics] Fetching revenue for providerId:",
      req.token.id,
      "period:",
      period,
    );

    // Get provider's business profile
    const businessList = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    console.log(
      "[Analytics] Found business profiles:",
      businessList.length,
      "for providerId:",
      req.token.id,
    );

    if (businessList.length === 0) {
      console.log(
        "[Analytics] No business profile found for providerId:",
        req.token.id,
      );
      return res.status(404).json({
        message: "Business profile not found",
        debug: {
          providerId: req.token.id,
          hint: "Your account may not be linked to a business profile",
        },
      });
    }

    const business = businessList[0];
    console.log(
      "[Analytics] Using business ID:",
      business.id,
      "name:",
      business.businessName,
    );

    // For ALL periods, use actual booking date range (first to last booking)
    // This avoids showing empty data for new providers
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    // Get first and last booking dates for this provider
    const [firstBooking] = await db
      .select({ bookingDate: bookings.bookingDate })
      .from(bookings)
      .where(eq(bookings.businessProfileId, business.id))
      .orderBy(bookings.bookingDate)
      .limit(1);

    const [lastBooking] = await db
      .select({ bookingDate: bookings.bookingDate })
      .from(bookings)
      .where(eq(bookings.businessProfileId, business.id))
      .orderBy(sql`booking_date DESC`)
      .limit(1);

    console.log(
      "[Analytics] Date adjustment - First booking:",
      firstBooking,
      "Last booking:",
      lastBooking,
    );

    // For startDate: keep original to show past context (dates with 0 bookings)
    // For endDate: use max(today, lastBookingDate) - show up to today OR last booking if future
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (lastBooking && lastBooking.bookingDate) {
      // Parse booking date as string and compare dates (not datetimes)
      const lastBookingStr =
        lastBooking.bookingDate instanceof Date
          ? lastBooking.bookingDate.toISOString().split("T")[0]
          : String(lastBooking.bookingDate).split("T")[0];
      const todayStr = today.toISOString().split("T")[0];

      console.log("[Analytics] Date comparison:", {
        lastBookingStr,
        todayStr,
        lastBookingIsAfter: lastBookingStr > todayStr,
      });

      // Use whichever is later: today or last booking date (string comparison works for YYYY-MM-DD)
      effectiveEndDate =
        lastBookingStr > todayStr
          ? new Date(lastBookingStr + "T23:59:59.999Z")
          : today;
    } else {
      effectiveEndDate = today;
    }

    console.log("[Analytics] Adjusted date range:", {
      period,
      start: effectiveStartDate.toISOString().split("T")[0],
      end: effectiveEndDate.toISOString().split("T")[0],
    });

    // Get all bookings within date range
    const allBookings = await db
      .select({
        id: bookings.id,
        date: bookings.bookingDate,
        totalPrice: bookings.totalPrice,
        status: bookings.status,
        providerPayoutAmount: bookings.providerPayoutAmount,
        providerEarning: bookings.providerEarning,
        staffEarning: bookings.staffEarning,
        assignedStaffId: bookings.assignedStaffId,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessProfileId, business.id),
          sql`${bookings.bookingDate} >= ${effectiveStartDate.toISOString().split("T")[0]}`,
          sql`${bookings.bookingDate} <= ${effectiveEndDate.toISOString()}`,
        ),
      )
      .orderBy(bookings.bookingDate);

    console.log(
      "[Analytics] Found bookings:",
      allBookings.length,
      "for business ID:",
      business.id,
      "between",
      effectiveStartDate.toISOString().split("T")[0],
      "and",
      effectiveEndDate.toISOString().split("T")[0],
    );

    // Get paid payments to know which bookings have payouts
    // Include both regular booking payments and reschedule fee payments
    const paidPayments = await db
      .select({
        id: payments.id,
        bookingId: payments.bookingId,
        amount: payments.amount,
        platformFee: payments.platformFee,
        providerShare: payments.providerShare,
        providerPayoutStatus: payments.providerPayoutStatus,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.businessProfileId, business.id),
          eq(payments.status, "paid")
        )
      );

    // Create a map of booking IDs that have payments
    // A booking can have multiple payments (original + reschedule fees)
    const bookingPaymentsMap = new Map();
    paidPayments.forEach((p) => {
      const existing = bookingPaymentsMap.get(p.bookingId) || [];
      bookingPaymentsMap.set(p.bookingId, [...existing, {
        id: p.id,
        amount: Number(p.amount) || 0,
        platformFee: Number(p.platformFee) || 0,
        providerShare: Number(p.providerShare) || 0,
        status: p.providerPayoutStatus,
        createdAt: p.createdAt
      }]);
    });

    console.log(
      "[Analytics] Found payments:",
      paidPayments.length,
      "for bookings",
    );

    // Get provider's subscription plan for correct platform fee percentage
    let providerSharePercentage = 95; // Default fallback
    if (subscription && subscription.planPlatformFeePercentage !== undefined) {
      providerSharePercentage = 100 - subscription.planPlatformFeePercentage;
    }
    console.log("[Analytics] Provider share percentage:", providerSharePercentage);

    // Group data by appropriate interval
    const groupedData = new Map();
    const currentDate = new Date(effectiveStartDate);

    // Initialize all date keys (use effectiveEndDate to include all booking dates)
    while (currentDate <= effectiveEndDate) {
      const key = formatDateForGrouping(new Date(currentDate), period);
      groupedData.set(key, {
        date: key,
        bookings: 0,
        grossTotal: 0,
        providerPayout: 0, // Track actual payouts (including from cancellations)
        staffDeduction: 0, // Total amount paid to staff (to be subtracted from provider earnings)
        rescheduleRevenue: 0,
        completed: 0,
      });

      if (period === "7d" || period === "30d") {
        currentDate.setDate(currentDate.getDate() + 1);
      } else {
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
    }

    // Debug: log all initialized keys
    console.log("[Analytics] Initialized groupedData keys:", Array.from(groupedData.keys()));

    // Fill in actual data from bookings and payments
    allBookings.forEach((item) => {
      if (!item.date) return;
      try {
        const bookingDate = new Date(item.date);
        const key = formatDateForGrouping(bookingDate, period);
        const hasKey = groupedData.has(key);
        console.log(`[Analytics] Booking #${item.id}: date=${item.date}, key=${key}, hasKey=${hasKey}, status=${item.status}, totalPrice=${item.totalPrice}`);
        
        if (hasKey) {
          const existing = groupedData.get(key);
          existing.bookings += 1;

          // Calculate provider share for this booking
          let bookingProviderPayout = 0;

          // Use providerEarning if available (backend-calculated based on subscription plan)
          if (item.providerEarning !== null && item.providerEarning !== undefined) {
            bookingProviderPayout = Number(item.providerEarning) / 100; // Convert paise to rupees
          }
          // Use providerPayoutAmount for cancellations with specific payouts
          else if (item.providerPayoutAmount) {
            bookingProviderPayout = Number(item.providerPayoutAmount);
          }
          // Fallback to providerSharePercentage for old bookings without providerEarning
          else if (
            item.status !== "cancelled" &&
            item.status !== "rejected" &&
            item.status !== "refunded"
          ) {
            bookingProviderPayout = Math.round(((item.totalPrice || 0) * providerSharePercentage) / 100);
          }

          // Subtract staff earning if staff is assigned (staffEarning is in paise)
          const staffEarningPaise = item.staffEarning || 0;
          const staffEarningRupees = staffEarningPaise / 100;
          const netProviderPayout = Math.max(0, bookingProviderPayout - staffEarningRupees);

          existing.providerPayout += netProviderPayout;
          existing.staffDeduction += staffEarningRupees;

          // For backward compatibility and gross calculations
          if (
            item.status !== "cancelled" &&
            item.status !== "rejected" &&
            item.status !== "refunded"
          ) {
            existing.grossTotal += (item.totalPrice || 0);
          }

          if (item.status === "completed") {
            existing.completed += 1;
          }

          // Reschedule revenue from payments
          const bookingPayments = bookingPaymentsMap.get(item.id) || [];
          bookingPayments.forEach(p => {
            if (p.amount === 10000 && p.platformFee === 0) {
               existing.rescheduleRevenue += (p.providerShare / 100);
            } else if (p.amount === 10000 && p.platformFee === 10000) {
               existing.rescheduleRevenue += (p.amount / 100);
            }
          });
        } else {
          console.warn(`[Analytics] SKIPPED booking #${item.id}: key ${key} not in groupedData!`);
        }
      } catch (e) {
        console.warn("Invalid date:", item.date);
      }
    });

    // Convert to array and calculate cumulative values
    let cumulativeRevenue = 0;
    const chartData = Array.from(groupedData.values()).map((item) => {
      const baseRevenue = item.providerPayout || 0;
      const totalPeriodRevenue = baseRevenue + (item.rescheduleRevenue || 0);
      cumulativeRevenue += totalPeriodRevenue;
      
      return {
        date: item.date,
        bookings: item.bookings,
        revenue: baseRevenue,
        rescheduleRevenue: item.rescheduleRevenue || 0,
        totalRevenue: totalPeriodRevenue,
        completed: item.completed,
        cumulativeRevenue,
      };
    });

    // Calculate totals
    const totalBookings = allBookings.length;

    // Calculate total staff deduction across all bookings
    const totalStaffDeduction = allBookings.reduce((sum, item) => {
      const staffEarning = item.staffEarning || 0;
      return sum + staffEarning;
    }, 0);

    const totalProviderPayout = allBookings.reduce((sum, item) => {
      let bookingPayout = 0;

      // Use providerEarning if available (backend-calculated based on subscription plan)
      if (item.providerEarning !== null && item.providerEarning !== undefined) {
        bookingPayout = Number(item.providerEarning) / 100; // Convert paise to rupees
      }
      // Use providerPayoutAmount for cancellations with specific payouts
      else if (item.providerPayoutAmount) {
        bookingPayout = Number(item.providerPayoutAmount);
      }
      // Fallback to providerSharePercentage for old bookings without providerEarning
      else if (
        item.status !== "cancelled" &&
        item.status !== "rejected" &&
        item.status !== "refunded"
      ) {
        bookingPayout = Math.round(((item.totalPrice || 0) * providerSharePercentage) / 100);
      }

      // Subtract staff earning from provider payout
      const staffEarning = item.staffEarning || 0;
      return sum + Math.max(0, bookingPayout - (staffEarning / 100));
    }, 0);

    const baseTotalRevenue = totalProviderPayout;
    
    // Add ALL reschedule fees from paidPayments to total revenue
    const totalRescheduleRevenue = paidPayments.reduce((sum, p) => {
      if (p.amount === 10000) {
        return sum + 100; // All 100rs reschedule fees
      }
      return sum;
    }, 0);

    const totalRevenue = baseTotalRevenue + totalRescheduleRevenue;
    const totalCompleted = allBookings.filter(
      (item) => item.status === "completed",
    ).length;

    // Define all available charts with their IDs
    const availableCharts = {
      revenue_chart: "Revenue Trends",
      bookings_chart: "Bookings Overview",
      status_chart: "Booking Status",
      customer_ratings: "Customer Ratings",
      category_performance: "Category Performance",
      trends: "Service Trends",
    };

    // Build response with allowed charts
    const responseCharts = allowedGraphs.map((g) => ({
      id: g,
      name: availableCharts[g] || g,
    }));

    res.json({
      period,
      startDate: effectiveStartDate.toISOString().split("T")[0],
      endDate: effectiveEndDate.toISOString().split("T")[0],
      allowedGraphs, // Include allowed graphs so frontend knows which charts to show
      availableCharts: responseCharts,
      summary: {
        totalBookings,
        totalRevenue,
        rescheduleRevenue: totalRescheduleRevenue,
        totalCompleted,
        completionRate:
          totalBookings > 0
            ? ((totalCompleted / totalBookings) * 100).toFixed(1)
            : "0",
      },
      chartData,
    });
  } catch (error) {
    console.error("Error fetching revenue analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get service performance data
 * GET /provider/analytics/services?period=7d|30d|6m|12m|all
 */
const getServiceAnalytics = async (req, res) => {
  try {
    if (req.token.roleId !== 2) {
      return res.status(403).json({ message: "Access denied: Provider only" });
    }

    // ============================================
    // SUBSCRIPTION-BASED ANALYTICS ACCESS CONTROL
    // ============================================
    const subscription = await getProviderActiveSubscription(req.token.id);

    // Check if provider has analytics access
    if (!subscription || !subscription.planAnalyticsAccess) {
      return res.status(403).json({
        message: "Analytics not available on your plan. Upgrade to Pro or Premium.",
        code: "ANALYTICS_ACCESS_DENIED",
        currentPlan: subscription?.planName || "Free",
      });
    }

    const { period = "30d" } = req.query;
    const { startDate, endDate } = getDateRange(period);

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id))
      .limit(1);

    if (!business) {
      return res.status(404).json({ message: "Business profile not found" });
    }

    // For ALL periods, use actual booking date range (first to last booking)
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    // Get first and last booking dates for this provider
    const [firstBooking] = await db
      .select({ bookingDate: bookings.bookingDate })
      .from(bookings)
      .where(eq(bookings.businessProfileId, business.id))
      .orderBy(bookings.bookingDate)
      .limit(1);

    const [lastBooking] = await db
      .select({ bookingDate: bookings.bookingDate })
      .from(bookings)
      .where(eq(bookings.businessProfileId, business.id))
      .orderBy(sql`booking_date DESC`)
      .limit(1);

    console.log("[Service Analytics] Adjusted date range:", {
      period,
      start: effectiveStartDate.toISOString().split("T")[0],
      end: effectiveEndDate.toISOString().split("T")[0],
    });

    // For startDate: keep original to show past context
    // For endDate: use max(today, lastBookingDate) - show up to today OR last booking if future
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (lastBooking && lastBooking.bookingDate) {
      const lastBookingStr =
        lastBooking.bookingDate instanceof Date
          ? lastBooking.bookingDate.toISOString().split("T")[0]
          : String(lastBooking.bookingDate).split("T")[0];
      const todayStr = today.toISOString().split("T")[0];

      console.log("[Service Analytics] Date comparison:", {
        lastBookingStr,
        todayStr,
        lastBookingIsAfter: lastBookingStr > todayStr,
      });

      effectiveEndDate =
        lastBookingStr > todayStr
          ? new Date(lastBookingStr + "T23:59:59.999Z")
          : today;
    } else {
      effectiveEndDate = today;
    }

    console.log("[Service Analytics] Adjusted date range:", {
      period,
      originalStart: startDate.toISOString().split("T")[0],
      originalEnd: endDate.toISOString().split("T")[0],
      effectiveStart: effectiveStartDate.toISOString().split("T")[0],
      effectiveEnd: effectiveEndDate.toISOString().split("T")[0],
    });

    // Get all bookings with service info within EFFECTIVE date range
    const allBookings = await db
      .select({
        serviceId: bookings.serviceId,
        serviceName: services.name,
        serviceRating: services.rating,
        totalPrice: bookings.totalPrice,
        status: bookings.status,
        providerEarning: bookings.providerEarning,
        staffEarning: bookings.staffEarning,
        assignedStaffId: bookings.assignedStaffId,
        providerPayoutAmount: bookings.providerPayoutAmount,
      })
      .from(bookings)
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(
        and(
          eq(bookings.businessProfileId, business.id),
          sql`${bookings.bookingDate} >= ${effectiveStartDate.toISOString().split("T")[0]}`,
          sql`${bookings.bookingDate} <= ${effectiveEndDate.toISOString().split("T")[0]}`,
        ),
      );

    if (allBookings.length === 0) {
      return res.json({
        period,
        services: [],
        totalBookings: 0,
        totalRevenue: 0,
      });
    }

    // Group by service
    const serviceMap = new Map();

    // Get provider's subscription plan for correct platform fee percentage
    let providerSharePercentage = 95; // Default fallback
    if (subscription && subscription.planPlatformFeePercentage !== undefined) {
      providerSharePercentage = 100 - subscription.planPlatformFeePercentage;
    }

    allBookings.forEach((item) => {
      if (!item.serviceId) return;

      if (!serviceMap.has(item.serviceId)) {
        serviceMap.set(item.serviceId, {
          serviceId: item.serviceId,
          serviceName: item.serviceName || "Unknown Service",
          bookingCount: 0,
          totalRevenue: 0,
          staffDeduction: 0,
          completedCount: 0,
        });
      }

      // Only count eligible bookings (not cancelled/rejected/refunded) for revenue
      const isEligible =
        item.status !== "cancelled" &&
        item.status !== "rejected" &&
        item.status !== "refunded";

      const service = serviceMap.get(item.serviceId);
      service.bookingCount += 1;
      // Calculate provider's share only for eligible bookings
      if (isEligible) {
        let providerShare = 0;

        // Use providerEarning if available (backend-calculated based on subscription plan)
        if (item.providerEarning !== null && item.providerEarning !== undefined) {
          providerShare = Number(item.providerEarning) / 100; // Convert paise to rupees
        }
        // Fallback to providerSharePercentage for old bookings
        else {
          providerShare = Math.round(
            ((item.totalPrice || 0) * providerSharePercentage) / 100,
          );
        }

        // Subtract staff earning if assigned (staffEarning is in paise)
        const staffEarningPaise = item.staffEarning || 0;
        const staffEarningRupees = staffEarningPaise / 100;
        const netRevenue = Math.max(0, providerShare - staffEarningRupees);
        service.totalRevenue += netRevenue;
        service.staffDeduction = (service.staffDeduction || 0) + staffEarningRupees;
      }
      if (item.status === "completed") {
        service.completedCount += 1;
      }
    });

    // Convert to array and add service rating
    const servicesList = Array.from(serviceMap.values()).map((s) => {
      // Find rating from the original bookings data
      const serviceBooking = allBookings.find(
        (b) => b.serviceId === s.serviceId,
      );
      const rating = serviceBooking?.serviceRating;
      // Rating is stored as string like "0.00", just use it directly
      return {
        ...s,
        avgRating: rating ? rating : "0",
      };
    });

    // Sort by booking count
    servicesList.sort((a, b) => b.bookingCount - a.bookingCount);

    const totalBookings = allBookings.length;
    // Provider's share of ELIGIBLE bookings (excluding cancelled/rejected/refunded)
    // MINUS staff deductions
    const eligibleBookings = allBookings.filter(
      (item) =>
        item.status !== "cancelled" &&
        item.status !== "rejected" &&
        item.status !== "refunded",
    );
    const totalRevenue = eligibleBookings.reduce(
      (sum, item) => {
        let providerShare = 0;
        // Use providerEarning if available
        if (item.providerEarning !== null && item.providerEarning !== undefined) {
          providerShare = Number(item.providerEarning) / 100;
        } else {
          providerShare = Math.round(((item.totalPrice || 0) * providerSharePercentage) / 100);
        }
        const staffEarningPaise = item.staffEarning || 0;
        const staffEarningRupees = staffEarningPaise / 100;
        return sum + Math.max(0, providerShare - staffEarningRupees);
      },
      0,
    );

    res.json({
      period,
      services: servicesList.map((s) => ({
        ...s,
        percentage:
          totalBookings > 0
            ? ((s.bookingCount / totalBookings) * 100).toFixed(1)
            : "0",
      })),
      totalBookings,
      totalRevenue,
    });
  } catch (error) {
    console.error("Error fetching service analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get booking status breakdown
 * GET /provider/analytics/status?period=7d|30d|6m|12m|all
 */
const getStatusAnalytics = async (req, res) => {
  try {
    if (req.token.roleId !== 2) {
      return res.status(403).json({ message: "Access denied: Provider only" });
    }

    // ============================================
    // SUBSCRIPTION-BASED ANALYTICS ACCESS CONTROL
    // ============================================
    const subscription = await getProviderActiveSubscription(req.token.id);

    // Check if provider has analytics access
    if (!subscription || !subscription.planAnalyticsAccess) {
      return res.status(403).json({
        message: "Analytics not available on your plan. Upgrade to Pro or Premium.",
        code: "ANALYTICS_ACCESS_DENIED",
        currentPlan: subscription?.planName || "Free",
      });
    }

    const { period = "30d" } = req.query;
    const { startDate, endDate } = getDateRange(period);

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id))
      .limit(1);

    if (!business) {
      return res.status(404).json({ message: "Business profile not found" });
    }

    // For ALL periods, use actual booking date range (first to last booking)
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    // Get first and last booking dates for this provider
    const [firstBooking] = await db
      .select({ bookingDate: bookings.bookingDate })
      .from(bookings)
      .where(eq(bookings.businessProfileId, business.id))
      .orderBy(bookings.bookingDate)
      .limit(1);

    const [lastBooking] = await db
      .select({ bookingDate: bookings.bookingDate })
      .from(bookings)
      .where(eq(bookings.businessProfileId, business.id))
      .orderBy(sql`booking_date DESC`)
      .limit(1);

    console.log("[Status Analytics] Adjusted date range:", {
      period,
      originalStart: startDate.toISOString().split("T")[0],
      originalEnd: endDate.toISOString().split("T")[0],
      effectiveStart: effectiveStartDate.toISOString().split("T")[0],
      effectiveEnd: effectiveEndDate.toISOString().split("T")[0],
    });

    // For startDate: keep original to show past context
    // For endDate: use max(today, lastBookingDate) - show up to today OR last booking if future
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (lastBooking && lastBooking.bookingDate) {
      const lastBookingStr =
        lastBooking.bookingDate instanceof Date
          ? lastBooking.bookingDate.toISOString().split("T")[0]
          : String(lastBooking.bookingDate).split("T")[0];
      const todayStr = today.toISOString().split("T")[0];

      console.log("[Status Analytics] Date comparison:", {
        lastBookingStr,
        todayStr,
        lastBookingIsAfter: lastBookingStr > todayStr,
      });

      effectiveEndDate =
        lastBookingStr > todayStr
          ? new Date(lastBookingStr + "T23:59:59.999Z")
          : today;
    } else {
      effectiveEndDate = today;
    }

    // Get all bookings within EFFECTIVE date range
    const allBookings = await db
      .select({
        status: bookings.status,
        totalPrice: bookings.totalPrice,
        providerEarning: bookings.providerEarning,
        staffEarning: bookings.staffEarning,
        assignedStaffId: bookings.assignedStaffId,
        providerPayoutAmount: bookings.providerPayoutAmount,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessProfileId, business.id),
          sql`${bookings.bookingDate} >= ${effectiveStartDate.toISOString().split("T")[0]}`,
          sql`${bookings.bookingDate} <= ${effectiveEndDate.toISOString().split("T")[0]}`,
        ),
      );

    if (allBookings.length === 0) {
      return res.json({
        period,
        totalBookings: 0,
        statusBreakdown: [],
        totalRevenue: 0,
      });
    }

    // Group by status
    const statusMap = new Map();

    // Get provider's subscription plan for correct platform fee percentage
    let providerSharePercentage = 95; // Default fallback
    if (subscription && subscription.planPlatformFeePercentage !== undefined) {
      providerSharePercentage = 100 - subscription.planPlatformFeePercentage;
    }

    allBookings.forEach((item) => {
      const status = item.status || "unknown";
      if (!statusMap.has(status)) {
        statusMap.set(status, { count: 0, revenue: 0 });
      }
      const s = statusMap.get(status);
      s.count += 1;
      // Calculate provider's share only for eligible statuses
      // For cancelled/rejected/refunded, show revenue as 0 since it was refunded
      // Subtract staff earning if staff is assigned
      if (
        status !== "cancelled" &&
        status !== "rejected" &&
        status !== "refunded"
      ) {
        let providerShare = 0;
        // Use providerEarning if available
        if (item.providerEarning !== null && item.providerEarning !== undefined) {
          providerShare = Number(item.providerEarning) / 100;
        } else {
          providerShare = Math.round(
            ((item.totalPrice || 0) * providerSharePercentage) / 100,
          );
        }
        const staffEarningPaise = item.staffEarning || 0;
        const staffEarningRupees = staffEarningPaise / 100;
        s.revenue += Math.max(0, providerShare - staffEarningRupees);
      }
    });

    // Color mapping
    const statusColors = {
      completed: "hsl(142, 76%, 36%)", // Green
      confirmed: "hsl(217, 91%, 60%)", // Blue
      pending: "hsl(38, 92%, 50%)", // Orange
      cancelled: "hsl(0, 84%, 60%)", // Red
      rejected: "hsl(240, 5%, 26%)", // Dark gray
      unknown: "hsl(0, 0%, 50%)", // Gray
    };

    const totalBookings = allBookings.length;
    const statusBreakdown = Array.from(statusMap.entries()).map(
      ([status, data]) => ({
        status,
        count: data.count,
        revenue: data.revenue,
        percentage:
          totalBookings > 0
            ? ((data.count / totalBookings) * 100).toFixed(1)
            : "0",
        fill: statusColors[status] || statusColors.unknown,
      }),
    );

    // Sort by count descending
    statusBreakdown.sort((a, b) => b.count - a.count);

    res.json({
      period,
      totalBookings,
      statusBreakdown,
      totalRevenue: allBookings.reduce((sum, item) => {
        if (
          item.status !== "cancelled" &&
          item.status !== "rejected" &&
          item.status !== "refunded"
        ) {
          let providerShare = 0;
          // Use providerEarning if available
          if (item.providerEarning !== null && item.providerEarning !== undefined) {
            providerShare = Number(item.providerEarning) / 100;
          } else {
            providerShare = Math.round(((item.totalPrice || 0) * providerSharePercentage) / 100);
          }
          const staffEarningPaise = item.staffEarning || 0;
          const staffEarningRupees = staffEarningPaise / 100;
          return sum + Math.max(0, providerShare - staffEarningRupees);
        }
        return sum;
      }, 0),
    });
  } catch (error) {
    console.error("Error fetching status analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get time patterns analytics (hourly and daily distribution)
 * GET /provider/analytics/time-patterns?period=7d|30d|6m|12m|all
 */
const getTimePatternsAnalytics = async (req, res) => {
  try {
    if (req.token.roleId !== 2) {
      return res.status(403).json({ message: "Access denied: Provider only" });
    }

    // ============================================
    // SUBSCRIPTION-BASED ANALYTICS ACCESS CONTROL
    // ============================================
    const subscription = await getProviderActiveSubscription(req.token.id);

    // Check if provider has analytics access
    if (!subscription || !subscription.planAnalyticsAccess) {
      return res.status(403).json({
        message: "Analytics not available on your plan. Upgrade to Pro or Premium.",
        code: "ANALYTICS_ACCESS_DENIED",
        currentPlan: subscription?.planName || "Free",
      });
    }

    // Check if time_patterns is in allowed graphs
    const planFeatures = subscription.planFeatures || {};
    const allowedGraphs = planFeatures.allowedGraphs || [];
    if (!allowedGraphs.includes("time_patterns")) {
      return res.status(403).json({
        message: "Time Patterns analytics is only available on Premium plan.",
        code: "ANALYTICS_ACCESS_DENIED",
        currentPlan: subscription?.planName || "Free",
      });
    }

    const { period = "30d" } = req.query;
    const { startDate, endDate } = getDateRange(period);

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id))
      .limit(1);

    if (!business) {
      return res.status(404).json({ message: "Business profile not found" });
    }

    // For ALL periods, use actual booking date range
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    const [lastBooking] = await db
      .select({ bookingDate: bookings.bookingDate })
      .from(bookings)
      .where(eq(bookings.businessProfileId, business.id))
      .orderBy(sql`booking_date DESC`)
      .limit(1);

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (lastBooking && lastBooking.bookingDate) {
      const lastBookingStr =
        lastBooking.bookingDate instanceof Date
          ? lastBooking.bookingDate.toISOString().split("T")[0]
          : String(lastBooking.bookingDate).split("T")[0];
      const todayStr = today.toISOString().split("T")[0];

      effectiveEndDate =
        lastBookingStr > todayStr
          ? new Date(lastBookingStr + "T23:59:59.999Z")
          : today;
    } else {
      effectiveEndDate = today;
    }

    // Get all bookings within EFFECTIVE date range with slot info
    const rawBookings = await db
      .select()
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .where(
        and(
          eq(bookings.businessProfileId, business.id),
          sql`${bookings.bookingDate} >= ${effectiveStartDate.toISOString().split("T")[0]}`,
          sql`${bookings.bookingDate} <= ${effectiveEndDate.toISOString().split("T")[0]}`,
        ),
      );

    const allBookings = rawBookings.map(row => ({
      bookingDate: row.bookings.bookingDate,
      startTime: row.slots.startTime
    }));

    const totalBookings = allBookings.length;

    // Initialize hourly data (0-23)
    const hourlyData = [];
    const hourColors = [
      "hsl(240, 5%, 26%)",  // 12-5 AM (Night) - Dark
      "hsl(240, 5%, 26%)",
      "hsl(240, 5%, 26%)",
      "hsl(240, 5%, 26%)",
      "hsl(240, 5%, 26%)",
      "hsl(240, 5%, 26%)",
      "hsl(45, 93%, 47%)",  // 6-11 AM (Morning) - Amber
      "hsl(45, 93%, 47%)",
      "hsl(45, 93%, 47%)",
      "hsl(45, 93%, 47%)",
      "hsl(45, 93%, 47%)",
      "hsl(45, 93%, 47%)",
      "hsl(263, 70%, 50%)", // 12-5 PM (Afternoon) - Purple
      "hsl(263, 70%, 50%)",
      "hsl(263, 70%, 50%)",
      "hsl(263, 70%, 50%)",
      "hsl(263, 70%, 50%)",
      "hsl(263, 70%, 50%)",
      "hsl(217, 91%, 60%)", // 6-11 PM (Evening) - Blue
      "hsl(217, 91%, 60%)",
      "hsl(217, 91%, 60%)",
      "hsl(217, 91%, 60%)",
      "hsl(217, 91%, 60%)",
      "hsl(217, 91%, 60%)",
    ];

    for (let i = 0; i < 24; i++) {
      const hourStr = i.toString().padStart(2, "0");
      let hourLabel;
      if (i === 0) hourLabel = "12AM";
      else if (i < 12) hourLabel = `${i}AM`;
      else if (i === 12) hourLabel = "12PM";
      else hourLabel = `${i - 12}PM`;

      hourlyData.push({
        hour: hourStr,
        hourLabel,
        bookingCount: 0,
        fill: hourColors[i],
      });
    }

    // Initialize daily data (Mon-Sun)
    const dayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const dayColors = {
      Mon: "hsl(263, 70%, 50%)",   // Monday - Purple
      Tue: "hsl(217, 91%, 60%)",   // Tuesday - Blue
      Wed: "hsl(142, 76%, 36%)",   // Wednesday - Green
      Thu: "hsl(45, 93%, 47%)",    // Thursday - Amber
      Fri: "hsl(38, 92%, 50%)",    // Friday - Orange
      Sat: "hsl(0, 84%, 60%)",     // Saturday - Red
      Sun: "hsl(280, 60%, 45%)",   // Sunday - Pink
    };

    const dailyData = dayOrder.map((day) => ({
      day,
      dayLabel: day.substring(0, 3),
      bookingCount: 0,
      fill: dayColors[day],
    }));

    // Process bookings to extract hour and day of week
    allBookings.forEach((booking) => {
      if (booking.startTime) {
        // Parse time slot (e.g., "09:00-10:00") to get hour
        const timeMatch = booking.startTime.match(/(\d{2}):(\d{2})/);
        if (timeMatch) {
          const hour = parseInt(timeMatch[1]);
          if (hour >= 0 && hour < 24) {
            hourlyData[hour].bookingCount += 1;
          }
        }
      }

      // Get day of week from booking date
      if (booking.bookingDate) {
        const bookingDate =
          booking.bookingDate instanceof Date
            ? booking.bookingDate
            : new Date(booking.bookingDate);
        const dayIndex = bookingDate.getDay();
        // Convert JS day (0=Sun, 1=Mon) to our order (Mon=0, Sun=6)
        const dayKey = dayOrder[dayIndex === 0 ? 6 : dayIndex - 1];
        const dayData = dailyData.find((d) => d.day === dayKey);
        if (dayData) {
          dayData.bookingCount += 1;
        }
      }
    });

    // Find peak hour and day
    let peakHour = { hour: "N/A", count: 0 };
    hourlyData.forEach((h) => {
      if (h.bookingCount > peakHour.count) {
        peakHour = { hour: h.hourLabel, count: h.bookingCount };
      }
    });

    let peakDay = { day: "N/A", count: 0 };
    dailyData.forEach((d) => {
      if (d.bookingCount > peakDay.count) {
        peakDay = { day: d.day, count: d.bookingCount };
      }
    });

    res.json({
      period,
      totalBookings,
      hourlyData,
      dailyData,
      peakHour,
      peakDay,
    });
  } catch (error) {
    console.error("Error fetching time patterns analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getRevenueAnalytics,
  getServiceAnalytics,
  getStatusAnalytics,
  getTimePatternsAnalytics,
};
