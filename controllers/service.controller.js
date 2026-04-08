const db = require("../config/db");
const {
  services,
  businessProfiles,
  feedback,
  users,
  bookings,
  payments,
} = require("../models/schema");
const {
  eq,
  and,
  or,
  ilike,
  gte,
  lte,
  count,
  sql,
  inArray,
} = require("drizzle-orm");
const {
  getProviderActiveSubscription,
  getMonthlyBookingCount,
} = require("./providerSubscription.controller");

// Cache for providers at booking limit (refresh every 5 minutes)
let providersAtLimitCache = new Map();
let cacheExpiry = null;

/**
 * Get providers who have reached their monthly booking limit
 * Uses caching to avoid repeated database queries
 */
async function getProvidersAtBookingLimit() {
  const now = Date.now();

  // Return cached result if still valid
  if (cacheExpiry && now < cacheExpiry && providersAtLimitCache.size > 0) {
    return Array.from(providersAtLimitCache.keys());
  }

  // Clear cache and rebuild
  providersAtLimitCache.clear();
  const providersAtLimit = [];

  try {
    // Get all active subscriptions with booking limits
    const db = require("../config/db");
    const {
      providerSubscriptions,
      subscriptionPlans,
    } = require("../models/schema");
    const { desc } = require("drizzle-orm");

    const subscriptions = await db
      .select({
        providerId: providerSubscriptions.providerId,
        planId: providerSubscriptions.planId,
        planMaxBookingsPerMonth: subscriptionPlans.maxBookingsPerMonth,
        planName: subscriptionPlans.name,
      })
      .from(providerSubscriptions)
      .innerJoin(
        subscriptionPlans,
        eq(providerSubscriptions.planId, subscriptionPlans.id),
      )
      .where(
        and(
          eq(providerSubscriptions.status, "active"),
          sql`${subscriptionPlans.maxBookingsPerMonth} IS NOT NULL`,
          sql`${subscriptionPlans.maxBookingsPerMonth} > 0`,
        ),
      );

    // Check each provider's booking count
    for (const sub of subscriptions) {
      const currentCount = await getMonthlyBookingCount(sub.providerId);
      if (currentCount >= sub.planMaxBookingsPerMonth) {
        providersAtLimitCache.set(sub.providerId, true);
        providersAtLimit.push(sub.providerId);
      }
    }

    // Set cache expiry (5 minutes)
    cacheExpiry = now + 5 * 60 * 1000;

    return providersAtLimit;
  } catch (error) {
    console.error("Error getting providers at limit:", error);
    return [];
  }
}

const getAllServices = async (req, res) => {
  try {
    // Extract query parameters for filtering
    const {
      state,
      city,
      category_id,
      min_price,
      max_price,
      search,
      page,
      limit,
    } = req.query;

    // Pagination parameters
    const currentPage = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;
    const offset = (currentPage - 1) * pageSize;

    // Build dynamic WHERE conditions
    const conditions = [];

    // CRITICAL: Always filter out blocked businesses and inactive services for customers
    // Customers cannot see services from blocked businesses
    conditions.push(eq(businessProfiles.isBlocked, false));
    // Customers cannot see deactivated services
    conditions.push(eq(services.isActive, true));

    // Search filter - search in service name OR description (case-insensitive)
    if (search && search.trim()) {
      const searchTerm = search.trim();
      conditions.push(
        or(
          ilike(services.name, `%${searchTerm}%`),
          ilike(services.description, `%${searchTerm}%`),
        ),
      );
    }

    // Location filters - from business profile
    if (state && state.trim()) {
      conditions.push(eq(businessProfiles.state, state.trim()));
    }
    if (city && city.trim()) {
      conditions.push(eq(businessProfiles.city, city.trim()));
    }

    // Category filter - NOTE: categoryId is on business_profiles table, not services
    if (category_id) {
      conditions.push(eq(businessProfiles.categoryId, Number(category_id)));
    }

    // Price range filters
    if (min_price) {
      const minPrice = Number(min_price);
      if (!isNaN(minPrice)) {
        conditions.push(gte(services.price, minPrice));
      }
    }
    if (max_price) {
      const maxPrice = Number(max_price);
      if (!isNaN(maxPrice)) {
        conditions.push(lte(services.price, maxPrice));
      }
    }

    // Combine all conditions with AND
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count for pagination
    const countQuery = db
      .select({ count: sql`count(*)` })
      .from(services)
      .leftJoin(
        businessProfiles,
        eq(services.businessProfileId, businessProfiles.id),
      );

    if (whereClause) {
      countQuery.where(whereClause);
    }

    const [{ count }] = await countQuery;

    // Build the main query
    let query = db
      .select({
        // Service fields
        id: services.id,
        name: services.name,
        description: services.description,
        price: services.price,
        EstimateDuration: services.EstimateDuration,
        image: services.image,
        isActive: services.isActive,
        businessProfileId: services.businessProfileId,
        rating: services.rating,
        totalReviews: services.totalReviews,
        maxAllowBooking: services.maxAllowBooking,
        createdAt: services.createdAt,
        // Business/Provider fields
        provider: {
          id: businessProfiles.id,
          businessName: businessProfiles.businessName,
          description: businessProfiles.description,
          email: users.email,
          phone: businessProfiles.phone,
          state: businessProfiles.state,
          city: businessProfiles.city,
          logo: businessProfiles.logo,
          isVerified: businessProfiles.isVerified,
        },
      })
      .from(services)
      .leftJoin(
        businessProfiles,
        eq(services.businessProfileId, businessProfiles.id),
      )
      .leftJoin(users, eq(businessProfiles.providerId, users.id));

    // Apply WHERE clause if conditions exist
    if (whereClause) {
      query = query.where(whereClause);
    }

    // Apply pagination
    query = query.limit(pageSize).offset(offset);

    const allServices = await query;

    // ============================================
    // FILTER: Hide services from providers at booking limit
    // ============================================
    const providersAtLimit = await getProvidersAtBookingLimit();
    const providerIdsAtLimit = new Set(providersAtLimit);

    // Get provider ID for each service (from business profile)
    // Need to fetch provider IDs for all services
    const businessIds = allServices.map((s) => s.businessProfileId);
    let providerIdMap = new Map();

    if (businessIds.length > 0) {
      const businesses = await db
        .select({
          id: businessProfiles.id,
          providerId: businessProfiles.providerId,
        })
        .from(businessProfiles)
        .where(inArray(businessProfiles.id, businessIds));

      providerIdMap = new Map(businesses.map((b) => [b.id, b.providerId]));
    }

    // Filter out services from providers at their booking limit
    const filteredServices = allServices.filter((service) => {
      const providerId = providerIdMap.get(service.businessProfileId);
      // Keep service if provider not at limit
      return !providerId || !providerIdsAtLimit.has(providerId);
    });

    // Map EstimateDuration to estimateDuration and duration for frontend compatibility
    const mappedServices = filteredServices.map((service) => ({
      ...service,
      estimateDuration: service.EstimateDuration,
      duration: service.EstimateDuration,
    }));

    // Update pagination count to reflect filtered results
    // For simplicity, we use the filtered count which may not match total pages perfectly
    // but ensures customers don't see services they can't book
    const filteredCount = Math.max(0, count - providersAtLimit.length);

    res.status(200).json({
      services: mappedServices,
      pagination: {
        page: currentPage,
        limit: pageSize,
        total: filteredCount,
        totalPages: Math.ceil(filteredCount / pageSize),
      },
    });
  } catch (error) {
    console.error("Error fetching services:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get service by ID
const getServiceById = async (req, res) => {
  try {
    const serviceId = Number(req.params.id);

    if (!serviceId) {
      return res.status(400).json({ message: "Service ID is required" });
    }

    const [service] = await db
      .select({
        // Service fields
        id: services.id,
        name: services.name,
        description: services.description,
        price: services.price,
        EstimateDuration: services.EstimateDuration,
        image: services.image,
        isActive: services.isActive,
        businessProfileId: services.businessProfileId,
        rating: services.rating,
        totalReviews: services.totalReviews,
        maxAllowBooking: services.maxAllowBooking,
        createdAt: services.createdAt,
        // Business/Provider fields
        provider: {
          id: businessProfiles.id,
          businessName: businessProfiles.businessName,
          description: businessProfiles.description,
          email: users.email, // ✅ Added email from users table
          phone: businessProfiles.phone,
          state: businessProfiles.state,
          city: businessProfiles.city,
          logo: businessProfiles.logo,
          isVerified: businessProfiles.isVerified,
        },
      })
      .from(services)
      .leftJoin(
        businessProfiles,
        eq(services.businessProfileId, businessProfiles.id),
      )
      .leftJoin(users, eq(businessProfiles.providerId, users.id))
      .where(eq(services.id, serviceId));

    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    // Add empty slots and reviews arrays (frontend expects these)
    const serviceDetails = {
      ...service,
      estimateDuration: service.EstimateDuration, // Map backend field to frontend expected field
      duration: service.EstimateDuration, // Also map to duration for compatibility
      slots: [], // Frontend will fetch these separately
      reviews: [], // Frontend will fetch these separately
    };

    res.status(200).json(serviceDetails);
  } catch (error) {
    console.error("Error fetching service:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get services by business ID
const getServicesByBusiness = async (req, res) => {
  try {
    const businessId = Number(req.params.businessId);

    if (!businessId) {
      return res.status(400).json({ message: "Business ID is required" });
    }

    const businessServices = await db
      .select()
      .from(services)
      .where(eq(services.businessProfileId, businessId));

    // Map EstimateDuration to duration for frontend compatibility
    const mappedServices = businessServices.map((service) => ({
      ...service,
      estimateDuration: service.EstimateDuration,
      duration: service.EstimateDuration,
    }));

    res.status(200).json({ services: mappedServices });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

//add new service with businessid and userid
const addService = async (req, res) => {
  try {
    const { businessId } = req.params;
    const userId = req.token.id;
    const { name, description, price, duration, image, maxAllowBooking } =
      req.body;
    console.log(userId);
    if (!userId) {
      return res
        .status(400)
        .json({ message: "Business ID and User ID are required" });
    }
    if (!name || !description || !price || !duration) {
      return res.status(400).json({ message: "All fields are required" });
    }
    //find businessid in businessProfiles table and for that id check if providerId is equal to userid
    const business = await db
      .select()
      .from(businessProfiles)
      .where(
        and(
          eq(businessProfiles.id, businessId),
          eq(businessProfiles.providerId, userId),
        ),
      );
    if (business.length === 0) {
      return res
        .status(404)
        .json({ message: "Business profile not found for this user" });
    }
    if (!business[0].isVerified) {
      return res
        .status(403)
        .json({ message: "Business profile is not verified" });
    }

    // ============================================
    // SERVICE LIMIT CHECK (Subscription-based)
    // ============================================
    const subscription = await getProviderActiveSubscription(userId);

    if (subscription && subscription.planMaxServices >= 0) {
      const [serviceCount] = await db
        .select({ count: count() })
        .from(services)
        .where(eq(services.businessProfileId, businessId));

      if (serviceCount.count >= subscription.planMaxServices) {
        return res.status(403).json({
          message: `Service limit reached (${subscription.planMaxServices}). Upgrade your plan to add more services.`,
          code: "SERVICE_LIMIT_EXCEEDED",
          currentServices: serviceCount.count,
          maxServices: subscription.planMaxServices,
          planName: subscription.planName,
        });
      }
    }

    const [newService] = await db
      .insert(services)
      .values({
        businessProfileId: businessId,
        name,
        description,
        EstimateDuration: duration,
        price,
        maxAllowBooking: maxAllowBooking || 1,
        image: image || null,
      })
      .returning();

    // Map EstimateDuration to duration for frontend compatibility
    const serviceResponse = {
      ...newService,
      estimateDuration: newService.EstimateDuration,
      duration: newService.EstimateDuration,
    };

    res.status(201).json({
      message: "Service added successfully",
      service: serviceResponse,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
const updateService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    //const userId = req.params.userId;
    const userId = req.token.id;
    const {
      name,
      description,
      price,
      duration,
      image,
      isActive,
      maxAllowBooking,
    } = req.body;
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Build update object dynamically
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = price;
    if (duration !== undefined) updateData.EstimateDuration = duration;
    if (image !== undefined) updateData.image = image;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (maxAllowBooking !== undefined)
      updateData.maxAllowBooking = maxAllowBooking;

    const service = await db
      .select()
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);
    if (service.length === 0) {
      return res.status(404).json({ message: "Service not found" });
    }
    const businessProfile = await db
      .select()
      .from(businessProfiles)
      .where(
        and(
          eq(businessProfiles.id, service[0].businessProfileId),
          eq(businessProfiles.providerId, userId),
        ),
      );
    if (businessProfile.length === 0) {
      return res
        .status(403)
        .json({ message: "You do not have permission to update this service" });
    }
    if (!businessProfile[0].isVerified) {
      return res
        .status(403)
        .json({ message: "Business profile is not verified" });
    }
    const [updatedService] = await db
      .update(services)
      .set(updateData)
      .where(eq(services.id, serviceId))
      .returning();

    // Map EstimateDuration to duration for frontend compatibility
    const serviceResponse = {
      ...updatedService,
      estimateDuration: updatedService.EstimateDuration,
      duration: updatedService.EstimateDuration,
    };

    res.status(200).json({
      message: "Service updated successfully",
      service: serviceResponse,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
const deleteService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const userId = req.token.id;
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    // Find the service and join with businessProfiles to verify ownership
    const service = await db
      .select()
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);
    if (service.length === 0) {
      return res.status(404).json({ message: "Service not found" });
    }
    const businessProfile = await db
      .select()
      .from(businessProfiles)
      .where(
        and(
          eq(businessProfiles.id, service[0].businessProfileId),
          eq(businessProfiles.providerId, userId),
        ),
      );
    if (businessProfile.length === 0) {
      return res
        .status(403)
        .json({ message: "You do not have permission to delete this service" });
    }
    await db.delete(services).where(eq(services.id, serviceId));
    res.status(200).json({ message: "Service deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get service statistics for a business
 * GET /services/business/:businessId/stats
 */
const getServiceStatsForBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;

    // Get all services for this business
    const allServices = await db
      .select()
      .from(services)
      .where(eq(services.businessProfileId, businessId));

    const activeServices = allServices.filter((s) => s.isActive || s.is_active);
    const inactiveServices = allServices.filter(
      (s) => !s.isActive && !s.is_active,
    );

    // Calculate average price
    const totalPrice = allServices.reduce((sum, s) => sum + (s.price || 0), 0);
    const averagePrice =
      allServices.length > 0 ? Math.round(totalPrice / allServices.length) : 0;

    // Calculate stats per service
    const serviceStatsArray = await Promise.all(
      allServices.map(async (service) => {
        // Get booking counts for this service
        const [bookingCounts] = await db
          .select({
            totalBookings: count(),
            completedBookings: count(bookings.id),
          })
          .from(bookings)
          .where(eq(bookings.serviceId, service.id));

        // Get revenue for this service (provider's 95% share)
        // IMPORTANT: Must filter by businessProfileId to avoid counting other providers' revenue
        const [revenueData] = await db
          .select({
            totalRevenue: sql`COALESCE(SUM(${payments.providerShare}), 0)`,
          })
          .from(payments)
          .innerJoin(bookings, eq(payments.bookingId, bookings.id))
          .where(
            and(
              eq(bookings.serviceId, service.id),
              eq(bookings.businessProfileId, businessId), // Critical: only count this business's bookings
              eq(payments.status, "paid"),
            ),
          );

        return {
          id: service.id,
          name: service.name,
          isActive: service.isActive || service.is_active || false,
          price: service.price,
          totalBookings: bookingCounts?.totalBookings || 0,
          completedBookings: bookingCounts?.completedBookings || 0,
          revenue: Number(revenueData?.totalRevenue) || 0, // in paise
        };
      }),
    );

    // Calculate totals
    const totalBookings = serviceStatsArray.reduce(
      (sum, s) => sum + s.totalBookings,
      0,
    );
    const totalRevenue = serviceStatsArray.reduce(
      (sum, s) => sum + s.revenue,
      0,
    );

    res.json({
      total: allServices.length,
      active: activeServices.length,
      inactive: inactiveServices.length,
      averagePrice,
      totalBookings,
      totalRevenue, // in paise
      services: serviceStatsArray,
    });
  } catch (error) {
    console.error("Error fetching service stats:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  getAllServices,
  getServiceById,
  getServicesByBusiness,
  addService,
  updateService,
  deleteService,
  getServiceStatsForBusiness,
};
