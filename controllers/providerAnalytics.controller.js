const db = require("../config/db");
const { bookings, payments, services, businessProfiles } = require("../models/schema");
const { eq, and, sql, desc, gte, lte, innerJoin } = require("drizzle-orm");

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
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

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

    const { period = "30d" } = req.query;
    const { startDate, endDate } = getDateRange(period);

    console.log("[Analytics] Fetching revenue for providerId:", req.token.id, "period:", period);

    // Get provider's business profile
    const businessList = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    console.log("[Analytics] Found business profiles:", businessList.length, "for providerId:", req.token.id);

    if (businessList.length === 0) {
      console.log("[Analytics] No business profile found for providerId:", req.token.id);
      return res.status(404).json({
        message: "Business profile not found",
        debug: { providerId: req.token.id, hint: "Your account may not be linked to a business profile" }
      });
    }

    const business = businessList[0];
    console.log("[Analytics] Using business ID:", business.id, "name:", business.businessName);

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
      .orderBy(desc(bookings.bookingDate))
      .limit(1);

    console.log("[Analytics] Date adjustment - First booking:", firstBooking, "Last booking:", lastBooking);

    // For startDate: keep original to show past context (dates with 0 bookings)
    // For endDate: use max(today, lastBookingDate) - show up to today OR last booking if future
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (lastBooking && lastBooking.bookingDate) {
      // Parse booking date as string and compare dates (not datetimes)
      const lastBookingStr = lastBooking.bookingDate instanceof Date
        ? lastBooking.bookingDate.toISOString().split("T")[0]
        : String(lastBooking.bookingDate).split("T")[0];
      const todayStr = today.toISOString().split("T")[0];

      console.log("[Analytics] Date comparison:", {
        lastBookingStr,
        todayStr,
        lastBookingIsAfter: lastBookingStr > todayStr
      });

      // Use whichever is later: today or last booking date (string comparison works for YYYY-MM-DD)
      effectiveEndDate = lastBookingStr > todayStr ? new Date(lastBookingStr + "T23:59:59.999Z") : today;
    } else {
      effectiveEndDate = today;
    }

    console.log("[Analytics] Adjusted date range:", {
      period,
      start: effectiveStartDate.toISOString().split("T")[0],
      end: effectiveEndDate.toISOString().split("T")[0]
    });

    // Get all bookings within date range
    const allBookings = await db
      .select({
        id: bookings.id,
        date: bookings.bookingDate,
        totalPrice: bookings.totalPrice,
        status: bookings.status,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessProfileId, business.id),
          sql`${bookings.bookingDate} >= ${effectiveStartDate.toISOString().split("T")[0]}`,
          sql`${bookings.bookingDate} <= ${effectiveEndDate.toISOString().split("T")[0]}`
        )
      )
      .orderBy(bookings.bookingDate);

    console.log("[Analytics] Found bookings:", allBookings.length, "for business ID:", business.id, "between", effectiveStartDate.toISOString().split("T")[0], "and", effectiveEndDate.toISOString().split("T")[0]);

    // Get paid payments to know which bookings have payouts
    const paidPayments = await db
      .select({
        bookingId: payments.bookingId,
        providerShare: payments.providerShare,
        providerPayoutStatus: payments.providerPayoutStatus,
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, "paid"),
          sql`${payments.bookingId} IS NOT NULL`
        )
      );

    // Create a map of booking IDs that have payments
    const bookingPaymentsMap = new Map();
    paidPayments.forEach(p => {
      bookingPaymentsMap.set(p.bookingId, {
        providerShare: Number(p.providerShare) || 0, // in paise
        status: p.providerPayoutStatus
      });
    });

    console.log("[Analytics] Found payments:", paidPayments.length, "for bookings");

    // Platform fee percentage (default 5%)
    const platformFeePercentage = 5;
    const providerSharePercentage = 100 - platformFeePercentage; // 95%

    // Group data by appropriate interval
    const groupedData = new Map();
    const currentDate = new Date(effectiveStartDate);

    // Initialize all date keys (use effectiveEndDate to include all booking dates)
    while (currentDate <= effectiveEndDate) {
      const key = formatDateForGrouping(new Date(currentDate), period);
      groupedData.set(key, { date: key, bookings: 0, revenue: 0, completed: 0 });

      if (period === "7d" || period === "30d") {
        currentDate.setDate(currentDate.getDate() + 1);
      } else {
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
    }

    // Fill in actual data from bookings
    allBookings.forEach((item) => {
      if (!item.date) return;
      try {
        const bookingDate = new Date(item.date);
        const key = formatDateForGrouping(bookingDate, period);
        if (groupedData.has(key)) {
          const existing = groupedData.get(key);
          existing.bookings += 1; // Count ALL bookings

          // Only add revenue if this booking has a payment
          const paymentData = bookingPaymentsMap.get(item.id);
          if (paymentData) {
            // providerShare is in paise, convert to rupees
            existing.revenue += paymentData.providerShare / 100;
          }

          if (item.status === "completed") {
            existing.completed += 1;
          }
        }
      } catch (e) {
        console.warn("Invalid date:", item.date);
      }
    });

    // Convert to array and calculate cumulative values
    let cumulativeRevenue = 0;
    const chartData = Array.from(groupedData.values()).map((item) => {
      cumulativeRevenue += item.revenue;
      return {
        date: item.date,
        bookings: item.bookings,
        revenue: item.revenue,
        completed: item.completed,
        cumulativeRevenue,
      };
    });

    // Calculate totals
    const totalBookings = allBookings.length;
    // Provider's 95% share of all bookings
    const totalRevenue = allBookings.reduce((sum, item) => sum + Math.round((item.totalPrice || 0) * providerSharePercentage / 100), 0);
    const totalCompleted = allBookings.filter((item) => item.status === "completed").length;

    res.json({
      period,
      startDate: effectiveStartDate.toISOString().split("T")[0],
      endDate: effectiveEndDate.toISOString().split("T")[0],
      summary: {
        totalBookings,
        totalRevenue,
        totalCompleted,
        completionRate: totalBookings > 0 ? ((totalCompleted / totalBookings) * 100).toFixed(1) : "0",
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
      .orderBy(desc(bookings.bookingDate))
      .limit(1);

    console.log("[Service Analytics] Adjusted date range:", {
      period,
      start: effectiveStartDate.toISOString().split("T")[0],
      end: effectiveEndDate.toISOString().split("T")[0]
    });

    // For startDate: keep original to show past context
    // For endDate: use max(today, lastBookingDate) - show up to today OR last booking if future
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (lastBooking && lastBooking.bookingDate) {
      const lastBookingStr = lastBooking.bookingDate instanceof Date
        ? lastBooking.bookingDate.toISOString().split("T")[0]
        : String(lastBooking.bookingDate).split("T")[0];
      const todayStr = today.toISOString().split("T")[0];

      console.log("[Service Analytics] Date comparison:", {
        lastBookingStr,
        todayStr,
        lastBookingIsAfter: lastBookingStr > todayStr
      });

      effectiveEndDate = lastBookingStr > todayStr ? new Date(lastBookingStr + "T23:59:59.999Z") : today;
    } else {
      effectiveEndDate = today;
    }

    console.log("[Service Analytics] Adjusted date range:", {
      period,
      originalStart: startDate.toISOString().split("T")[0],
      originalEnd: endDate.toISOString().split("T")[0],
      effectiveStart: effectiveStartDate.toISOString().split("T")[0],
      effectiveEnd: effectiveEndDate.toISOString().split("T")[0]
    });

    // Get all bookings with service info within EFFECTIVE date range
    const allBookings = await db
      .select({
        serviceId: bookings.serviceId,
        serviceName: services.name,
        serviceRating: services.rating,
        totalPrice: bookings.totalPrice,
        status: bookings.status,
      })
      .from(bookings)
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(
        and(
          eq(bookings.businessProfileId, business.id),
          sql`${bookings.bookingDate} >= ${effectiveStartDate.toISOString().split("T")[0]}`,
          sql`${bookings.bookingDate} <= ${effectiveEndDate.toISOString().split("T")[0]}`
        )
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

    // Platform fee percentage (default 5%)
    const platformFeePercentage = 5;
    const providerSharePercentage = 100 - platformFeePercentage; // 95%

    allBookings.forEach((item) => {
      if (!item.serviceId) return;

      if (!serviceMap.has(item.serviceId)) {
        serviceMap.set(item.serviceId, {
          serviceId: item.serviceId,
          serviceName: item.serviceName || "Unknown Service",
          bookingCount: 0,
          totalRevenue: 0,
          completedCount: 0,
        });
      }

      const service = serviceMap.get(item.serviceId);
      service.bookingCount += 1;
      // Calculate provider's 95% share
      const providerShare = Math.round((item.totalPrice || 0) * providerSharePercentage / 100);
      service.totalRevenue += providerShare;
      if (item.status === "completed") {
        service.completedCount += 1;
      }
    });

    // Convert to array and add service rating
    const servicesList = Array.from(serviceMap.values()).map((s) => {
      // Find rating from the original bookings data
      const serviceBooking = allBookings.find((b) => b.serviceId === s.serviceId);
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
    // Provider's 95% share of all bookings
    const totalRevenue = allBookings.reduce((sum, item) => sum + Math.round((item.totalPrice || 0) * 95 / 100), 0);

    res.json({
      period,
      services: servicesList.map((s) => ({
        ...s,
        percentage: totalBookings > 0 ? ((s.bookingCount / totalBookings) * 100).toFixed(1) : "0",
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
      .orderBy(desc(bookings.bookingDate))
      .limit(1);

    console.log("[Status Analytics] Adjusted date range:", {
      period,
      originalStart: startDate.toISOString().split("T")[0],
      originalEnd: endDate.toISOString().split("T")[0],
      effectiveStart: effectiveStartDate.toISOString().split("T")[0],
      effectiveEnd: effectiveEndDate.toISOString().split("T")[0]
    });

    // For startDate: keep original to show past context
    // For endDate: use max(today, lastBookingDate) - show up to today OR last booking if future
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (lastBooking && lastBooking.bookingDate) {
      const lastBookingStr = lastBooking.bookingDate instanceof Date
        ? lastBooking.bookingDate.toISOString().split("T")[0]
        : String(lastBooking.bookingDate).split("T")[0];
      const todayStr = today.toISOString().split("T")[0];

      console.log("[Status Analytics] Date comparison:", {
        lastBookingStr,
        todayStr,
        lastBookingIsAfter: lastBookingStr > todayStr
      });

      effectiveEndDate = lastBookingStr > todayStr ? new Date(lastBookingStr + "T23:59:59.999Z") : today;
    } else {
      effectiveEndDate = today;
    }

    // Get all bookings within EFFECTIVE date range
    const allBookings = await db
      .select({
        status: bookings.status,
        totalPrice: bookings.totalPrice,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessProfileId, business.id),
          sql`${bookings.bookingDate} >= ${effectiveStartDate.toISOString().split("T")[0]}`,
          sql`${bookings.bookingDate} <= ${effectiveEndDate.toISOString().split("T")[0]}`
        )
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

    // Platform fee percentage (default 5%)
    const platformFeePercentage = 5;
    const providerSharePercentage = 100 - platformFeePercentage; // 95%

    allBookings.forEach((item) => {
      const status = item.status || "unknown";
      if (!statusMap.has(status)) {
        statusMap.set(status, { count: 0, revenue: 0 });
      }
      const s = statusMap.get(status);
      s.count += 1;
      // Calculate provider's 95% share
      const providerShare = Math.round((item.totalPrice || 0) * providerSharePercentage / 100);
      s.revenue += providerShare;
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
    const statusBreakdown = Array.from(statusMap.entries()).map(([status, data]) => ({
      status,
      count: data.count,
      revenue: data.revenue,
      percentage: totalBookings > 0 ? ((data.count / totalBookings) * 100).toFixed(1) : "0",
      fill: statusColors[status] || statusColors.unknown,
    }));

    // Sort by count descending
    statusBreakdown.sort((a, b) => b.count - a.count);

    res.json({
      period,
      totalBookings,
      statusBreakdown,
      totalRevenue: allBookings.reduce((sum, item) => sum + Math.round((item.totalPrice || 0) * 95 / 100), 0),
    });
  } catch (error) {
    console.error("Error fetching status analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getRevenueAnalytics,
  getServiceAnalytics,
  getStatusAnalytics,
};
