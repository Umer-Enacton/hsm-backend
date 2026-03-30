const db = require("../config/db");
const {
  adminSettings,
  payments,
  bookings,
  businessProfiles,
  services,
  Category,
  users,
} = require("../models/schema");
const { eq, and, sql, desc, innerJoin, gte, lte } = require("drizzle-orm");

/**
 * Get admin setting value by key
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
    return defaultValue;
  }
}

/**
 * Get date range based on period
 */
function getDateRange(period) {
  const now = new Date();
  let startDate = new Date();

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
      // Show last 2 years for "all"
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

  if (period === "7d" || period === "30d") {
    return `${year}-${month}-${day}`;
  }
  return `${year}-${month}`;
}

/**
 * Get revenue and bookings over time (Admin's Platform Fees)
 * GET /admin/analytics/revenue?period=7d|30d|6m|12m|all
 */
const getRevenueAnalytics = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { period = "30d" } = req.query;
    const { startDate, endDate } = getDateRange(period);

    console.log("[Admin Analytics] Fetching revenue for period:", period);

    // Get platform fee percentage
    const platformFeePercentage = Number(
      await getAdminSetting("platform_fee_percentage", "5"),
    );
    const providerSharePercentage = 100 - platformFeePercentage;

    // Get first and last payment dates
    const [firstPayment] = await db
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .orderBy(payments.createdAt)
      .limit(1);

    const [lastPayment] = await db
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .orderBy(desc(payments.createdAt))
      .limit(1);

    console.log(
      "[Admin Analytics] First payment:",
      firstPayment,
      "Last payment:",
      lastPayment,
    );

    // Adjust date range based on actual payment data AND booking data
    // This allows showing future booking dates in the chart (like provider does)
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    if (firstPayment && firstPayment.createdAt) {
      effectiveStartDate = new Date(firstPayment.createdAt);
      effectiveStartDate.setDate(effectiveStartDate.getDate() - 1);
    }

    // ALSO check last BOOKING date (not just payment date) to show future dates
    const [lastBooking] = await db
      .select({ bookingDate: bookings.bookingDate })
      .from(bookings)
      .innerJoin(payments, eq(payments.bookingId, bookings.id))
      .where(eq(payments.status, "paid"))
      .orderBy(desc(bookings.bookingDate))
      .limit(1);

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // Determine effective end date: max(today, last payment date, last booking date)
    let endDateCandidate = today;

    if (lastPayment && lastPayment.createdAt) {
      const lastPaymentDate = new Date(lastPayment.createdAt);
      if (lastPaymentDate > endDateCandidate) {
        endDateCandidate = lastPaymentDate;
      }
    }

    if (lastBooking && lastBooking.bookingDate) {
      // Parse booking date as string and compare
      const lastBookingStr =
        lastBooking.bookingDate instanceof Date
          ? lastBooking.bookingDate.toISOString().split("T")[0]
          : String(lastBooking.bookingDate).split("T")[0];
      const todayStr = today.toISOString().split("T")[0];

      console.log("[Admin Analytics] Date comparison for chart end date:", {
        lastBookingStr,
        todayStr,
        lastBookingIsAfter: lastBookingStr > todayStr,
      });

      // If last booking is in future, use that date
      if (lastBookingStr > todayStr) {
        // Create date from booking date string
        const bookingDate = new Date(lastBookingStr + "T23:59:59.999Z");
        if (bookingDate > endDateCandidate) {
          endDateCandidate = bookingDate;
        }
      }
    }

    effectiveEndDate = endDateCandidate;

    console.log("[Admin Analytics] Adjusted date range:", {
      period,
      start: effectiveStartDate.toISOString().split("T")[0],
      end: effectiveEndDate.toISOString().split("T")[0],
    });

    // Get all paid payments - join with bookings to get booking dates
    // IMPORTANT: Group by BOOKING DATE (not payment date) to match provider behavior
    const startOfDay = new Date(effectiveStartDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(effectiveEndDate);
    endOfDay.setHours(23, 59, 59, 999);

    const allPayments = await db
      .select({
        id: payments.id,
        paymentDate: payments.createdAt,
        bookingDate: bookings.bookingDate,
        amount: payments.amount,
        platformFee: payments.platformFee,
        providerShare: payments.providerShare,
        status: payments.status,
        bookingId: payments.bookingId,
        bookingStatus: bookings.status,
        isRefunded: bookings.isRefunded,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .where(
        and(
          eq(payments.status, "paid"),
          gte(bookings.bookingDate, startOfDay),
          lte(bookings.bookingDate, endOfDay),
          // Include all bookings that have a SUCCESSFUL payment
          // This ensures cancelled bookings with PAID reschedule fees are counted
          sql`(${payments.status} = 'paid')`,
        ),
      )
      .orderBy(bookings.bookingDate);

    console.log("[Admin Analytics] Date filter (by booking date):", {
      start: startOfDay.toISOString(),
      end: endOfDay.toISOString(),
    });
    console.log("[Admin Analytics] Found payments:", allPayments.length);

    // Group data by appropriate interval
    const groupedData = new Map();
    const currentDate = new Date(effectiveStartDate);

    // Initialize all date keys (use effectiveEndDate to include future booking dates)
    while (currentDate <= effectiveEndDate) {
      const key = formatDateForGrouping(new Date(currentDate), period);
      groupedData.set(key, {
        date: key,
        bookings: 0,
        revenue: 0,
        completed: 0,
      });

      if (period === "7d" || period === "30d") {
        currentDate.setDate(currentDate.getDate() + 1);
      } else {
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
    }

    // Fill in actual data from payments - GROUP BY BOOKING DATE
    allPayments.forEach((item) => {
      if (!item.bookingDate) return;
      try {
        const bookingDate = new Date(item.bookingDate);
        const key = formatDateForGrouping(bookingDate, period);
        if (groupedData.has(key)) {
          const existing = groupedData.get(key);
          
          // Only increment booking count if it's not a duplicate for the same booking in the same group?
          // Actually, allPayments might have multiple entries for one booking (original + reschedule).
          // But our query already joins payments and bookings.
          // Let's use a Set to track unique bookings per group for the count.
          if (!existing.uniqueBookings) existing.uniqueBookings = new Set();
          existing.uniqueBookings.add(item.bookingId);
          existing.bookings = existing.uniqueBookings.size;

          // Only add revenue if the booking is NOT cancelled/rejected/refunded
          // This keeps the "Revenue" (Platform Fees) correct: it should NOT include fees from cancelled bookings
          // EXCEPT if we wanted to keep the platform fee for cancellations, but the user said they don't want reschedule fee there.
          const isEligibleForPlatformFee = 
            item.bookingStatus !== 'cancelled' && 
            item.bookingStatus !== 'rejected' && 
            item.bookingStatus !== 'refunded' && 
            item.isRefunded === false;

          if (isEligibleForPlatformFee) {
            if (item.platformFee) {
              existing.revenue += Number(item.platformFee) / 100;
            } else {
              const fee = Math.round(((Number(item.amount) || 0) * platformFeePercentage) / 100);
              existing.revenue += fee / 100;
            }
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
        completed: item.bookings, // For admin, all paid payments count as "completed"
        cumulativeRevenue,
      };
    });

    // Calculate totals
    const uniqueBookingIds = new Set(allPayments.map(p => p.bookingId));
    const totalBookings = uniqueBookingIds.size;

    // Filter payments for total revenue and platform fee calculations
    // Exclude those originally rejected/cancelled unless it's a reschedule fee? 
    // Actually, user said platform fee should NOT include reschedule fee.
    // And platform fee typically comes from regular bookings.
    const eligiblePayments = allPayments.filter(item => 
      item.bookingStatus !== 'cancelled' && 
      item.bookingStatus !== 'rejected' && 
      item.bookingStatus !== 'refunded' && 
      item.isRefunded === false
    );

    const totalRevenue = eligiblePayments.reduce(
      (sum, item) => sum + (Number(item.amount) || 0),
      0,
    );
    const totalPlatformFees = eligiblePayments.reduce((sum, item) => {
      if (item.platformFee) {
        return sum + Number(item.platformFee);
      }
      return (
        sum +
        Math.round(((Number(item.amount) || 0) * platformFeePercentage) / 100)
      );
    }, 0);
    const totalProviderPayouts = eligiblePayments.reduce((sum, item) => {
      if (item.providerShare) {
        return sum + Number(item.providerShare);
      }
      return (
        sum +
        Math.round(((Number(item.amount) || 0) * providerSharePercentage) / 100)
      );
    }, 0);

    res.json({
      period,
      startDate: effectiveStartDate.toISOString().split("T")[0],
      endDate: effectiveEndDate.toISOString().split("T")[0],
      summary: {
        totalBookings,
        totalRevenue, // Total bookings value in paise
        platformFees: totalPlatformFees / 100, // Admin's 5% in rupees
        providerPayouts: totalProviderPayouts / 100, // Provider's 95% in rupees
        completionRate: "100", // All paid payments
      },
      chartData,
    });
  } catch (error) {
    console.error("Error fetching admin revenue analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get category performance data
 * GET /admin/analytics/categories?period=7d|30d|6m|12m|all
 */
const getCategoryAnalytics = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { period = "30d" } = req.query;
    const { startDate, endDate } = getDateRange(period);

    const platformFeePercentage = Number(
      await getAdminSetting("platform_fee_percentage", "5"),
    );

    // Get first and last payment dates
    const [firstPayment] = await db
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .orderBy(payments.createdAt)
      .limit(1);

    const [lastPayment] = await db
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .orderBy(desc(payments.createdAt))
      .limit(1);

    // Adjust date range
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    if (firstPayment && firstPayment.createdAt) {
      effectiveStartDate = new Date(firstPayment.createdAt);
      effectiveStartDate.setDate(effectiveStartDate.getDate() - 1);
    }

    if (lastPayment && lastPayment.createdAt) {
      const lastPaymentDate = new Date(lastPayment.createdAt);
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const lastPaymentStr = lastPaymentDate.toISOString().split("T")[0];
      effectiveEndDate = lastPaymentStr > todayStr ? lastPaymentDate : today;
    }

    // Use proper date comparison with gte/lte
    const startOfDay = new Date(effectiveStartDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(effectiveEndDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all payments with category info, excluding refunded bookings
    // Use booking date instead of payment date for consistency
    // NOTE: categoryId is on businessProfiles, not services
    const allPayments = await db
      .select({
        categoryId: Category.id,
        categoryName: Category.name,
        amount: payments.amount,
        platformFee: payments.platformFee,
        bookingDate: bookings.bookingDate,
        bookingStatus: bookings.status,
        isRefunded: bookings.isRefunded,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .innerJoin(
        businessProfiles,
        eq(services.businessProfileId, businessProfiles.id),
      )
      .innerJoin(Category, eq(businessProfiles.categoryId, Category.id))
      .where(
        and(
          eq(payments.status, "paid"),
          gte(bookings.bookingDate, startOfDay),
          lte(bookings.bookingDate, endOfDay),
          // Include all bookings with a paid payment
          sql`${payments.status} = 'paid'`,
        ),
      )
      .orderBy(bookings.bookingDate);

    if (allPayments.length === 0) {
      return res.json({
        period,
        categories: [],
        totalBookings: 0,
        totalRevenue: 0,
        totalPlatformFees: 0,
      });
    }

    // Group by category
    const categoryMap = new Map();

    allPayments.forEach((item) => {
      if (!item.categoryId) return;

      if (!categoryMap.has(item.categoryId)) {
        categoryMap.set(item.categoryId, {
          categoryId: item.categoryId,
          categoryName: item.categoryName || "Unknown Category",
          bookingCount: 0,
          totalRevenue: 0,
          platformFees: 0,
        });
      }

      const category = categoryMap.get(item.categoryId);

      const amount = Number(item.amount) || 0;
      
      // Only count revenue/fees for non-cancelled bookings
      // (Unless it's a reschedule fee, but user said those shouldn't be in platform fees)
      // Since it's Category Analytics, we want to know how much the CATEGORY earned for admin
      const isEligible = 
        item.bookingStatus !== 'cancelled' && 
        item.bookingStatus !== 'rejected' && 
        item.bookingStatus !== 'refunded' && 
        item.isRefunded === false;

      if (isEligible) {
        category.totalRevenue += amount;

        // Use stored platform fee or calculate
        if (item.platformFee) {
          category.platformFees += Number(item.platformFee);
        } else {
          category.platformFees += (amount * platformFeePercentage) / 100;
        }
      }
      
      // Always count the booking if it had a paid payment (like reschedule)
      // Wait, we need to track unique bookings to avoid double counting if multiple payments exist
      if (!category.uniqueBookingIds) category.uniqueBookingIds = new Set();
      if (!category.uniqueBookingIds.has(item.bookingId)) {
        category.bookingCount += 1;
        category.uniqueBookingIds.add(item.bookingId);
      }
    });

    // Convert to array
    const categoriesList = Array.from(categoryMap.values()).map((c) => ({
      ...c,
      totalRevenue: c.totalRevenue / 100, // Convert to rupees
      platformFees: c.platformFees / 100, // Convert to rupees
    }));

    // Sort by platform fees (admin's earnings)
    categoriesList.sort((a, b) => b.platformFees - a.platformFees);

    const totalBookings = allPayments.length;
    const totalRevenue =
      allPayments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) /
      100;
    const totalPlatformFees = categoriesList.reduce(
      (sum, cat) => sum + cat.platformFees,
      0,
    );

    res.json({
      period,
      categories: categoriesList.map((c) => ({
        ...c,
        percentage:
          totalPlatformFees > 0
            ? ((c.platformFees / totalPlatformFees) * 100).toFixed(1)
            : "0",
      })),
      totalBookings,
      totalRevenue,
      totalPlatformFees,
    });
  } catch (error) {
    console.error("Error fetching category analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get booking status breakdown
 * GET /admin/analytics/status?period=7d|30d|6m|12m|all
 */
const getStatusAnalytics = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { period = "30d" } = req.query;
    const { startDate, endDate } = getDateRange(period);

    const platformFeePercentage = Number(
      await getAdminSetting("platform_fee_percentage", "5"),
    );

    // Get first and last payment dates
    const [firstPayment] = await db
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .orderBy(payments.createdAt)
      .limit(1);

    const [lastPayment] = await db
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .orderBy(desc(payments.createdAt))
      .limit(1);

    // Adjust date range
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    if (firstPayment && firstPayment.createdAt) {
      effectiveStartDate = new Date(firstPayment.createdAt);
      effectiveStartDate.setDate(effectiveStartDate.getDate() - 1);
    }

    if (lastPayment && lastPayment.createdAt) {
      const lastPaymentDate = new Date(lastPayment.createdAt);
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const lastPaymentStr = lastPaymentDate.toISOString().split("T")[0];
      effectiveEndDate = lastPaymentStr > todayStr ? lastPaymentDate : today;
    }

    // Use proper date comparison with gte/lte
    const startOfDay = new Date(effectiveStartDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(effectiveEndDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all bookings with status within date range (based on payment date)
    const allBookings = await db
      .select({
        status: bookings.status,
        isRefunded: bookings.isRefunded,
        totalPrice: bookings.totalPrice,
        amount: payments.amount,
        platformFee: payments.platformFee,
      })
      .from(bookings)
      .innerJoin(payments, eq(payments.bookingId, bookings.id))
      .where(
        and(
          eq(payments.status, "paid"),
          gte(payments.createdAt, startOfDay),
          lte(payments.createdAt, endOfDay),
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
    const uniqueBookingsPerStatus = new Map(); // status -> Set(bookingId)

    allBookings.forEach((item) => {
      const status = item.status || "unknown";
      const isRefunded = item.isRefunded || false;

      // Skip refunded bookings from the status breakdown as requested
      if (isRefunded || status === 'refunded') return;

      const effectiveStatus = status;
      const bookingId = item.id;

      if (!statusMap.has(effectiveStatus)) {
        statusMap.set(effectiveStatus, {
          count: 0,
          revenue: 0,
          platformFees: 0,
        });
        uniqueBookingsPerStatus.set(effectiveStatus, new Set());
      }
      
      const s = statusMap.get(effectiveStatus);
      const uniqueSet = uniqueBookingsPerStatus.get(effectiveStatus);

      // Only increment count for unique bookings
      if (!uniqueSet.has(bookingId)) {
        s.count += 1;
        uniqueSet.add(bookingId);
      }

      const amount = Number(item.amount) || 0;
      s.revenue += amount;

      // Only add platform fees for bookings that are NOT cancelled/rejected/refunded
      if (
        status !== "cancelled" &&
        status !== "rejected" &&
        status !== "refunded" &&
        !isRefunded
      ) {
        if (item.platformFee) {
          s.platformFees += Number(item.platformFee);
        } else {
          // If it's a reschedule fee (amount 10000), platform fee is 0
          if (amount !== 10000) {
            s.platformFees += (amount * platformFeePercentage) / 100;
          }
        }
      }
    });

    // Color mapping
    const statusColors = {
      completed: "hsl(142, 76%, 36%)", // Green
      confirmed: "hsl(217, 91%, 60%)", // Blue
      pending: "hsl(38, 92%, 50%)", // Orange
      cancelled: "hsl(0, 84%, 60%)", // Red
      rejected: "hsl(240, 5%, 26%)", // Dark gray
      refunded: "hsl(280, 60%, 50%)", // Purple
      unknown: "hsl(0, 0%, 50%)", // Gray
    };

    const totalBookings = allBookings.length;
    const statusBreakdown = Array.from(statusMap.entries()).map(
      ([status, data]) => ({
        status,
        count: data.count,
        revenue: data.revenue / 100, // Convert to rupees
        platformFees: data.platformFees / 100, // Convert to rupees
        percentage:
          totalBookings > 0
            ? ((data.count / totalBookings) * 100).toFixed(1)
            : "0",
        fill: statusColors[status] || statusColors.unknown,
      }),
    );

    // Sort by count descending
    statusBreakdown.sort((a, b) => b.count - a.count);

    const totalPlatformFees = Array.from(statusMap.values()).reduce(
      (sum, data) => sum + data.platformFees,
      0,
    ) / 100;

    const totalRevenue = Array.from(statusMap.values()).reduce(
      (sum, data) => sum + data.revenue,
      0,
    ) / 100;
    res.json({
      period,
      totalBookings,
      statusBreakdown,
      totalRevenue,
      totalPlatformFees,
    });
  } catch (error) {
    console.error("Error fetching status analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get top providers by platform fee contribution
 * GET /admin/analytics/providers?period=7d|30d|6m|12m|all
 */
const getTopProvidersAnalytics = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { period = "30d" } = req.query;
    const { startDate, endDate } = getDateRange(period);

    const platformFeePercentage = Number(
      await getAdminSetting("platform_fee_percentage", "5"),
    );

    // Get first and last payment dates
    const [firstPayment] = await db
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .orderBy(payments.createdAt)
      .limit(1);

    const [lastPayment] = await db
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .orderBy(desc(payments.createdAt))
      .limit(1);

    // Adjust date range
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    if (firstPayment && firstPayment.createdAt) {
      effectiveStartDate = new Date(firstPayment.createdAt);
      effectiveStartDate.setDate(effectiveStartDate.getDate() - 1);
    }

    if (lastPayment && lastPayment.createdAt) {
      const lastPaymentDate = new Date(lastPayment.createdAt);
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const lastPaymentStr = lastPaymentDate.toISOString().split("T")[0];
      effectiveEndDate = lastPaymentStr > todayStr ? lastPaymentDate : today;
    }

    // Use proper date comparison with gte/lte
    const startOfDay = new Date(effectiveStartDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(effectiveEndDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all payments with provider info, excluding refunded bookings
    const allPayments = await db
      .select({
        providerId: businessProfiles.providerId,
        providerName: users.name,
        businessName: businessProfiles.businessName,
        amount: payments.amount,
        platformFee: payments.platformFee,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .innerJoin(
        businessProfiles,
        eq(bookings.businessProfileId, businessProfiles.id),
      )
      .innerJoin(users, eq(businessProfiles.providerId, users.id))
      .where(
        and(
          eq(payments.status, "paid"),
          gte(payments.createdAt, startOfDay),
          lte(payments.createdAt, endOfDay),
          // Exclude refunded/cancelled/rejected bookings
          sql`(${bookings.status} NOT IN ('cancelled', 'rejected', 'refunded') AND ${bookings.isRefunded} = false)`,
        ),
      );

    if (allPayments.length === 0) {
      return res.json({
        period,
        providers: [],
        totalBookings: 0,
        totalPlatformFees: 0,
      });
    }

    // Group by provider
    const providerMap = new Map();

    allPayments.forEach((item) => {
      if (!item.providerId) return;

      if (!providerMap.has(item.providerId)) {
        providerMap.set(item.providerId, {
          providerId: item.providerId,
          providerName: item.providerName || "Unknown Provider",
          businessName: item.businessName || "Unknown Business",
          bookingCount: 0,
          totalRevenue: 0,
          platformFees: 0,
        });
      }

      const provider = providerMap.get(item.providerId);
      provider.bookingCount += 1;
      const amount = Number(item.amount) || 0;
      provider.totalRevenue += amount;

      // Use stored platform fee or calculate
      if (item.platformFee) {
        provider.platformFees += Number(item.platformFee);
      } else {
        provider.platformFees += (amount * platformFeePercentage) / 100;
      }
    });

    // Convert to array and sort by platform fees
    const providersList = Array.from(providerMap.values())
      .map((p) => ({
        ...p,
        totalRevenue: p.totalRevenue / 100, // Convert to rupees
        platformFees: p.platformFees / 100, // Convert to rupees
      }))
      .sort((a, b) => b.platformFees - a.platformFees)
      .slice(0, 10); // Top 10 providers

    const totalBookings = allPayments.length;
    const totalPlatformFees = providersList.reduce(
      (sum, p) => sum + p.platformFees,
      0,
    );

    res.json({
      period,
      providers: providersList.map((p) => ({
        ...p,
        percentage:
          totalPlatformFees > 0
            ? ((p.platformFees / totalPlatformFees) * 100).toFixed(1)
            : "0",
      })),
      totalBookings,
      totalPlatformFees,
    });
  } catch (error) {
    console.error("Error fetching top providers analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get payment status breakdown (paid, pending, failed)
 * GET /admin/analytics/payment-status?period=7d|30d|6m|12m|all
 */
const getPaymentStatusAnalytics = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { period = "30d" } = req.query;
    const { startDate, endDate } = getDateRange(period);

    const platformFeePercentage = Number(
      await getAdminSetting("platform_fee_percentage", "5"),
    );

    // Get first and last payment dates
    const [firstPayment] = await db
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .orderBy(payments.createdAt)
      .limit(1);

    const [lastPayment] = await db
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .orderBy(desc(payments.createdAt))
      .limit(1);

    // Adjust date range
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    if (firstPayment && firstPayment.createdAt) {
      effectiveStartDate = new Date(firstPayment.createdAt);
      effectiveStartDate.setDate(effectiveStartDate.getDate() - 1);
    }

    if (lastPayment && lastPayment.createdAt) {
      const lastPaymentDate = new Date(lastPayment.createdAt);
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const lastPaymentStr = lastPaymentDate.toISOString().split("T")[0];
      effectiveEndDate = lastPaymentStr > todayStr ? lastPaymentDate : today;
    }

    // Use proper date comparison with gte/lte
    const startOfDay = new Date(effectiveStartDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(effectiveEndDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all payments within date range
    const allPayments = await db
      .select({
        status: payments.status,
        amount: payments.amount,
        platformFee: payments.platformFee,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(
        and(
          gte(payments.createdAt, startOfDay),
          lte(payments.createdAt, endOfDay),
        ),
      );

    if (allPayments.length === 0) {
      return res.json({
        period,
        totalPayments: 0,
        statusBreakdown: [],
        totalAmount: 0,
        totalPlatformFees: 0,
      });
    }

    // Group by payment status
    const statusMap = new Map();

    allPayments.forEach((item) => {
      const status = item.status || "unknown";
      if (!statusMap.has(status)) {
        statusMap.set(status, { count: 0, amount: 0, platformFees: 0 });
      }
      const s = statusMap.get(status);
      s.count += 1;
      const amount = Number(item.amount) || 0;
      s.amount += amount;

      // Use stored platform fee or calculate
      if (item.platformFee) {
        s.platformFees += Number(item.platformFee);
      } else {
        s.platformFees += Math.round((amount * platformFeePercentage) / 100);
      }
    });

    // Color mapping for payment status
    const statusColors = {
      paid: "hsl(142, 76%, 36%)", // Green
      pending: "hsl(38, 92%, 50%)", // Orange
      failed: "hsl(0, 84%, 60%)", // Red
      refunded: "hsl(280, 60%, 50%)", // Purple
      unknown: "hsl(0, 0%, 50%)", // Gray
    };

    // Format status names for display
    const statusLabels = {
      paid: "Paid",
      pending: "Pending",
      failed: "Failed",
      refunded: "Refunded",
      unknown: "Unknown",
    };

    const totalPayments = allPayments.length;
    const statusBreakdown = Array.from(statusMap.entries()).map(
      ([status, data]) => ({
        status,
        statusLabel: statusLabels[status] || status,
        count: data.count,
        amount: data.amount / 100, // Convert paise to rupees
        platformFees: data.platformFees / 100, // Convert to rupees
        percentage:
          totalPayments > 0
            ? ((data.count / totalPayments) * 100).toFixed(1)
            : "0",
        fill: statusColors[status] || statusColors.unknown,
      }),
    );

    // Sort: paid first, then pending, then failed, then refunded
    const sortOrder = {
      paid: 1,
      pending: 2,
      failed: 3,
      refunded: 4,
      unknown: 5,
    };
    statusBreakdown.sort(
      (a, b) => (sortOrder[a.status] || 99) - (sortOrder[b.status] || 99),
    );

    const totalAmount =
      allPayments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) /
      100;
    const totalPlatformFees =
      allPayments.reduce((sum, item) => {
        if (item.platformFee) {
          return sum + Number(item.platformFee);
        }
        return (
          sum +
          Math.round(((Number(item.amount) || 0) * platformFeePercentage) / 100)
        );
      }, 0) / 100;

    res.json({
      period,
      totalPayments,
      statusBreakdown,
      totalAmount,
      totalPlatformFees,
    });
  } catch (error) {
    console.error("Error fetching payment status analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get average order value trend
 * GET /admin/analytics/average-order-value?period=7d|30d|6m|12m|all
 */
const getAverageOrderValueAnalytics = async (req, res) => {
  try {
    if (req.token.roleId !== 3) {
      return res.status(403).json({ message: "Access denied: Admin only" });
    }

    const { period = "30d" } = req.query;
    const { startDate, endDate } = getDateRange(period);

    console.log("[Admin AOV] Fetching average order value for period:", period);
    console.log("[Admin AOV] Date range:", {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    // Get first and last payment dates
    const [firstPayment] = await db
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .orderBy(payments.createdAt)
      .limit(1);

    const [lastPayment] = await db
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .orderBy(desc(payments.createdAt))
      .limit(1);

    // Adjust date range
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    if (firstPayment && firstPayment.createdAt) {
      effectiveStartDate = new Date(firstPayment.createdAt);
      effectiveStartDate.setDate(effectiveStartDate.getDate() - 1);
    }

    if (lastPayment && lastPayment.createdAt) {
      const lastPaymentDate = new Date(lastPayment.createdAt);
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const lastPaymentStr = lastPaymentDate.toISOString().split("T")[0];
      effectiveEndDate = lastPaymentStr > todayStr ? lastPaymentDate : today;
    }

    // Use proper date comparison with gte/lte
    const startOfDay = new Date(effectiveStartDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(effectiveEndDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all payments within date range, excluding refunded bookings
    const allPayments = await db
      .select({
        bookingDate: bookings.bookingDate,
        amount: payments.amount,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .where(
        and(
          eq(payments.status, "paid"),
          gte(bookings.bookingDate, startOfDay),
          lte(bookings.bookingDate, endOfDay),
          // Exclude refunded/cancelled/rejected bookings
          sql`(${bookings.status} NOT IN ('cancelled', 'rejected', 'refunded') AND ${bookings.isRefunded} = false)`,
        ),
      )
      .orderBy(bookings.bookingDate);

    if (allPayments.length === 0) {
      return res.json({
        period,
        overallAvg: 0,
        chartData: [],
      });
    }

    // Group by appropriate interval
    const groupedData = new Map();
    const currentDate = new Date(effectiveStartDate);

    // Initialize all date keys
    while (currentDate <= effectiveEndDate) {
      const key = formatDateForGrouping(new Date(currentDate), period);
      groupedData.set(key, { date: key, totalAmount: 0, bookingCount: 0 });

      if (period === "7d" || period === "30d") {
        currentDate.setDate(currentDate.getDate() + 1);
      } else {
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
    }

    // Fill in actual data - group by booking date
    allPayments.forEach((item) => {
      if (!item.bookingDate) return;
      try {
        const bookingDate = new Date(item.bookingDate);
        const key = formatDateForGrouping(bookingDate, period);
        if (groupedData.has(key)) {
          const existing = groupedData.get(key);
          existing.bookingCount += 1;
          existing.totalAmount += Number(item.amount) || 0;
        }
      } catch (e) {
        console.warn("Invalid date:", item.bookingDate);
      }
    });

    // Calculate average order value for each period
    const chartData = Array.from(groupedData.values()).map((item) => ({
      date: item.date,
      avgOrderValue:
        item.bookingCount > 0 ? item.totalAmount / item.bookingCount / 100 : 0, // Convert paise to rupees
      bookingCount: item.bookingCount,
    }));

    // Calculate overall average
    const overallAvg =
      allPayments.length > 0
        ? allPayments.reduce(
            (sum, item) => sum + (Number(item.amount) || 0),
            0,
          ) /
          allPayments.length /
          100
        : 0;

    console.log("[Admin AOV] Results:", {
      period,
      overallAvg,
      chartDataLength: chartData.length,
      chartData: chartData.slice(0, 3), // Log first 3 entries for debugging
    });

    res.json({
      period,
      overallAvg,
      chartData,
    });
  } catch (error) {
    console.error("Error fetching average order value analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getRevenueAnalytics,
  getCategoryAnalytics,
  getStatusAnalytics,
  getTopProvidersAnalytics,
  getPaymentStatusAnalytics,
  getAverageOrderValueAnalytics,
};
