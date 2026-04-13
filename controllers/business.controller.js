const db = require("../config/db");
const {
  businessProfiles,
  users,
  Category,
  services,
  subscriptionPlans,
  providerSubscriptions,
  paymentDetails,
} = require("../models/schema");
const { eq, and, or, sql, ilike, inArray } = require("drizzle-orm");
const { feedback: feedbackTable } = require("../models/schema");
const { sanitizeString, sanitizeName } = require("../helper/sanitize");

const getAllBusinesses = async (req, res) => {
  try {
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Filter parameters
    const status = req.query.status; // 'all', 'verified', 'pending', 'blocked'
    const search = req.query.search?.trim(); // search in name, category, city, provider name

    // Build where conditions
    const conditions = [];

    // Status filter
    if (status === "verified") {
      conditions.push(eq(businessProfiles.isVerified, true));
    } else if (status === "pending") {
      conditions.push(
        and(
          eq(businessProfiles.isVerified, false),
          eq(businessProfiles.isBlocked, false)
        )
      );
    } else if (status === "blocked") {
      conditions.push(eq(businessProfiles.isBlocked, true));
    }

    // Search filter - search in business name, category, city, provider name
    if (search) {
      const searchTerm = `%${search}%`;
      conditions.push(
        or(
          ilike(businessProfiles.businessName, searchTerm),
          ilike(Category.name, searchTerm),
          ilike(businessProfiles.city, searchTerm),
          ilike(users.name, searchTerm)
        )
      );
    }

    // Combine conditions
    const whereClause = conditions.length > 0
      ? conditions.length === 1 ? conditions[0] : and(...conditions)
      : undefined;

    // Get total count for pagination (with filters applied)
    let countQuery = db
      .select({ count: sql`count(*)` })
      .from(businessProfiles)
      .leftJoin(users, eq(businessProfiles.providerId, users.id))
      .leftJoin(Category, eq(businessProfiles.categoryId, Category.id));

    if (whereClause) {
      countQuery = countQuery.where(whereClause);
    }

    const [{ count }] = await countQuery;

    // Join with users and categories to get complete business data
    let businessesQuery = db
      .select({
        // Business fields
        id: businessProfiles.id,
        providerId: businessProfiles.providerId,
        userId: businessProfiles.providerId,
        businessName: businessProfiles.businessName,
        name: businessProfiles.businessName,
        description: businessProfiles.description,
        categoryId: businessProfiles.categoryId,
        category: Category.name,
        phone: businessProfiles.phone, // Business phone
        state: businessProfiles.state, // State/Province
        city: businessProfiles.city, // City
        website: businessProfiles.website,
        logo: businessProfiles.logo,
        coverImage: businessProfiles.coverImage,
        isVerified: businessProfiles.isVerified,
        isBlocked: businessProfiles.isBlocked,
        blockedReason: businessProfiles.blockedReason,
        blockedAt: businessProfiles.blockedAt,
        hasPaymentDetails: businessProfiles.hasPaymentDetails,
        createdAt: businessProfiles.createdAt,
        // Provider fields
        providerName: users.name,
        providerEmail: users.email,
        providerPhone: users.phone,
      })
      .from(businessProfiles)
      .leftJoin(users, eq(businessProfiles.providerId, users.id))
      .leftJoin(Category, eq(businessProfiles.categoryId, Category.id));

    // Apply filters to the main query
    if (whereClause) {
      businessesQuery = businessesQuery.where(whereClause);
    }

    const businesses = await businessesQuery
      .limit(limit)
      .offset(offset);

    if (businesses.length === 0) {
      return res.status(200).json({
        businesses: [],
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
        },
      });
    }

    // OPTIMIZED: Fetch all services for these businesses in one query
    const businessIds = businesses.map((b) => b.id);
    const allServices = await db
      .select({ id: services.id, businessProfileId: services.businessProfileId })
      .from(services)
      .where(inArray(services.businessProfileId, businessIds));

    // Group services by business ID
    const servicesByBusiness = new Map();
    for (const service of allServices) {
      if (!servicesByBusiness.has(service.businessProfileId)) {
        servicesByBusiness.set(service.businessProfileId, []);
      }
      const arr = servicesByBusiness.get(service.businessProfileId);
      if (arr) arr.push(service.id);
    }

    // OPTIMIZED: Batch fetch ratings for all services at once
    const allServiceIds = allServices.map((s) => s.id);
    let ratingMap = new Map();

    if (allServiceIds.length > 0) {
      const ratingStats = await db
        .select({
          serviceId: feedbackTable.serviceId,
          avgRating: sql`avg(${feedbackTable.rating})`,
          count: sql`count(*)`,
        })
        .from(feedbackTable)
        .where(inArray(feedbackTable.serviceId, allServiceIds))
        .groupBy(feedbackTable.serviceId);

      ratingMap = new Map(
        ratingStats.map((r) => [
          r.serviceId,
          { avgRating: Number(r.avgRating) || 0, count: Number(r.count) || 0 },
        ]),
      );
    }

    // Combine ratings by business (aggregate all services' ratings)
    const businessRatings = new Map();
    for (const businessId of businessIds) {
      const serviceIdsForBusiness = servicesByBusiness.get(businessId) || [];
      let totalRating = 0;
      let totalReviews = 0;

      for (const serviceId of serviceIdsForBusiness) {
        const stats = ratingMap.get(serviceId);
        if (stats) {
          totalRating += stats.avgRating * stats.count;
          totalReviews += stats.count;
        }
      }

      const avgRating = totalReviews > 0 ? totalRating / totalReviews : 0;
      businessRatings.set(businessId, {
        rating: Math.round(avgRating * 10) / 10, // Round to 1 decimal
        totalReviews,
      });
    }

    // Map businesses with their stats
    const businessesWithStats = businesses.map((business) => {
      const stats = businessRatings.get(business.id) || { rating: 0, totalReviews: 0 };
      return {
        ...business,
        status: business.isVerified ? "active" : "pending",
        rating: stats.rating,
        totalReviews: stats.totalReviews,
        email: business.providerEmail,
      };
    });

    res.status(200).json({
      businesses: businessesWithStats,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error("Error in getAllBusinesses:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get business by provider ID (PUBLIC - for viewing provider profiles)
const getBusinessByProviderId = async (req, res) => {
  try {
    const providerId = Number(req.params.userId);

    if (!providerId) {
      return res.status(400).json({ message: "Provider ID is required" });
    }

    // Join with users and categories to get complete business data
    // Note: Provider (user) and Business are separate entities
    const result = await db
      .select({
        // Business fields
        id: businessProfiles.id,
        providerId: businessProfiles.providerId,
        userId: businessProfiles.providerId, // Alias for frontend compatibility
        businessName: businessProfiles.businessName,
        name: businessProfiles.businessName, // Map businessName to name for frontend
        description: businessProfiles.description,
        categoryId: businessProfiles.categoryId,
        category: Category.name,
        phone: businessProfiles.phone, // Business phone (separate from provider's personal phone)
        state: businessProfiles.state, // State/Province
        city: businessProfiles.city, // City
        website: businessProfiles.website,
        logo: businessProfiles.logo,
        coverImage: businessProfiles.coverImage,
        isVerified: businessProfiles.isVerified,
        hasPaymentDetails: businessProfiles.hasPaymentDetails,
        createdAt: businessProfiles.createdAt,
        // Provider (user) fields - for reference only
        providerName: users.name, // Provider's personal name
        providerEmail: users.email, // Provider's personal email
        providerPhone: users.phone, // Provider's personal phone
      })
      .from(businessProfiles)
      .leftJoin(users, eq(businessProfiles.providerId, users.id))
      .leftJoin(Category, eq(businessProfiles.categoryId, Category.id))
      .where(eq(businessProfiles.providerId, providerId));

    if (!result || result.length === 0) {
      return res
        .status(404)
        .json({ message: "Business profile not found for this provider" });
    }

    const business = result[0];
    
    // Add computed fields
    business.status = business.isVerified ? "active" : "pending";
    business.email = business.providerEmail;

    // Calculate real rating and total reviews from feedback table
    const serviceData = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessProfileId, business.id));
    
    const serviceIds = serviceData.map(s => s.id);
    
    if (serviceIds.length > 0) {
      const [stats] = await db
        .select({
          avgRating: sql`avg(${feedbackTable.rating})`,
          count: sql`count(*)`
        })
        .from(feedbackTable)
        .where(inArray(feedbackTable.serviceId, serviceIds));
      
      business.rating = Number(stats?.avgRating) || 0;
      business.totalReviews = Number(stats?.count) || 0;
    } else {
      business.rating = 0;
      business.totalReviews = 0;
    }

    res.status(200).json({ business });
  } catch (error) {
    console.error("Error in getBusinessByProviderId:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get single business by ID
const getBusinessById = async (req, res) => {
  try {
    const businessId = Number(req.params.id);

    if (!businessId) {
      return res.status(400).json({ message: "Business ID is required" });
    }

    // Join with users and categories to get complete business data
    const result = await db
      .select({
        // Business fields
        id: businessProfiles.id,
        providerId: businessProfiles.providerId,
        userId: businessProfiles.providerId,
        businessName: businessProfiles.businessName,
        name: businessProfiles.businessName,
        description: businessProfiles.description,
        categoryId: businessProfiles.categoryId,
        category: Category.name,
        phone: businessProfiles.phone, // Business phone
        state: businessProfiles.state, // State/Province
        city: businessProfiles.city, // City
        website: businessProfiles.website,
        logo: businessProfiles.logo,
        coverImage: businessProfiles.coverImage,
        isVerified: businessProfiles.isVerified,
        isBlocked: businessProfiles.isBlocked,
        blockedReason: businessProfiles.blockedReason,
        blockedAt: businessProfiles.blockedAt,
        hasPaymentDetails: businessProfiles.hasPaymentDetails,
        createdAt: businessProfiles.createdAt,
        // Provider fields
        providerName: users.name,
        providerEmail: users.email,
        providerPhone: users.phone,
      })
      .from(businessProfiles)
      .leftJoin(users, eq(businessProfiles.providerId, users.id))
      .leftJoin(Category, eq(businessProfiles.categoryId, Category.id))
      .where(eq(businessProfiles.id, businessId));

    if (!result || result.length === 0) {
      return res.status(404).json({ message: "Business not found" });
    }

    const business = result[0];
    business.status = business.isVerified ? "active" : "pending";
    business.email = business.providerEmail;

    // Calculate real rating and total reviews from feedback table
    const serviceData = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessProfileId, business.id));
    
    const serviceIds = serviceData.map(s => s.id);
    
    if (serviceIds.length > 0) {
      const [stats] = await db
        .select({
          avgRating: sql`avg(${feedbackTable.rating})`,
          count: sql`count(*)`
        })
        .from(feedbackTable)
        .where(inArray(feedbackTable.serviceId, serviceIds));
      
      business.rating = Number(stats?.avgRating) || 0;
      business.totalReviews = Number(stats?.count) || 0;
    } else {
      business.rating = 0;
      business.totalReviews = 0;
    }

    res.status(200).json({ business });
  } catch (error) {
    console.error("Error in getBusinessById:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
//verify business update is_verfied true by admin
const verifyBusiness = async (req, res) => {
  try {
    const businessId = Number(req.params.id);

    if (!businessId) {
      return res.status(400).json({ message: "Business ID is required" });
    }

    // update verification status
    const [updatedBusiness] = await db
      .update(businessProfiles)
      .set({ isVerified: true })
      .where(eq(businessProfiles.id, businessId))
      .returning();

    if (!updatedBusiness) {
      return res.status(404).json({ message: "Business not found" });
    }

    return res.status(200).json({
      message: "Business verified successfully",
      business: updatedBusiness,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

//add business profile by user id
const addBusiness = async (req, res) => {
  try {
    const userId = req.token.id;
    const {
      name,
      description,
      categoryId,
      logo,
      coverImage,
      website,
      phone,
      state,
      city,
    } = req.body;

    if (!name || !description || !categoryId || !state || !city) {
      return res
        .status(400)
        .json({
          message:
            "All fields are required (name, description, category, state, city)",
        });
    }

    // Sanitize inputs to prevent XSS
    const sanitizedName = sanitizeName(name);
    const sanitizedDescription = sanitizeString(description, { maxLength: 500 });
    const sanitizedState = sanitizeString(state, { maxLength: 100 });
    const sanitizedCity = sanitizeString(city, { maxLength: 100 });

    // Check if business already exists
    const businessExists = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, userId));
    if (businessExists.length > 0) {
      return res
        .status(400)
        .json({ message: "Business profile already exists for this user" });
    }

    // Use business phone if provided, otherwise use provider's phone as fallback
    let businessPhone = phone;
    if (!businessPhone) {
      const phoneResult = await db
        .select({ phone: users.phone })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (phoneResult.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      businessPhone = phoneResult[0].phone;
    }

    // Create new business profile
    const [newBusiness] = await db
      .insert(businessProfiles)
      .values({
        providerId: userId,
        businessName: sanitizedName,
        description: sanitizedDescription,
        categoryId,
        phone: businessPhone, // Business phone (can be different from provider's personal phone)
        state: sanitizedState, // State/Province
        city: sanitizedCity, // City within state
        logo: logo || null,
        coverImage: coverImage || null,
        website: website || null,
      })
      .returning();

    // Fetch complete business data with joins
    const result = await db
      .select({
        // Business fields
        id: businessProfiles.id,
        providerId: businessProfiles.providerId,
        userId: businessProfiles.providerId,
        businessName: businessProfiles.businessName,
        name: businessProfiles.businessName,
        description: businessProfiles.description,
        categoryId: businessProfiles.categoryId,
        category: Category.name,
        phone: businessProfiles.phone, // Business phone
        state: businessProfiles.state,
        city: businessProfiles.city,
        website: businessProfiles.website,
        logo: businessProfiles.logo,
        coverImage: businessProfiles.coverImage,
        isVerified: businessProfiles.isVerified,
        hasPaymentDetails: businessProfiles.hasPaymentDetails,
        createdAt: businessProfiles.createdAt,
        // Provider fields
        providerName: users.name,
        providerEmail: users.email,
        providerPhone: users.phone,
      })
      .from(businessProfiles)
      .leftJoin(users, eq(businessProfiles.providerId, users.id))
      .leftJoin(Category, eq(businessProfiles.categoryId, Category.id))
      .where(eq(businessProfiles.id, newBusiness.id));

    const business = result[0];
    business.status = business.isVerified ? "active" : "pending";
    business.rating = 0;
    business.totalReviews = 0;
    business.email = business.providerEmail; // For contact purposes

    res.status(201).json({
      message: "Business profile added successfully",
      business,
    });

    // ============================================
    // AUTO-ASSIGN FREE PLAN TO NEW PROVIDERS
    // ============================================
    try {
      const [freePlan] = await db
        .select()
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.name, "Free"))
        .limit(1);

      if (freePlan) {
        // Check if provider already has a subscription
        const [existingSubscription] = await db
          .select()
          .from(providerSubscriptions)
          .where(eq(providerSubscriptions.providerId, userId))
          .limit(1);

        if (!existingSubscription) {
          await db.insert(providerSubscriptions).values({
            providerId: userId,
            planId: freePlan.id,
            status: "active",
            razorpaySubscriptionId: `free_sub_${userId}_${Date.now()}`,
            startDate: new Date(),
            endDate: new Date("2099-12-31"), // Indefinite for Free plan
            billingCycle: "monthly",
            autoRenew: false,
            amountPaid: 0,
            platformFeeAtPurchase: freePlan.platformFeePercentage,
          });
          console.log("Free plan auto-assigned to provider:", userId);
        }
      }
    } catch (subscriptionError) {
      console.error("Error auto-assigning Free plan:", subscriptionError);
      // Don't fail the request if subscription assignment fails
    }

    res.status(201).json({
      message: "Business profile added successfully",
      business,
    });
  } catch (error) {
    console.error("Error in addBusiness:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
const updateBusiness = async (req, res) => {
  try {
    const businessId = req.params.id;
    const userId = req.token.id;
    const {
      name,
      description,
      categoryId,
      logo,
      coverImage,
      website,
      phone,
      state,
      city,
    } = req.body;

    // Build update object dynamically with sanitization
    const updateData = {};
    if (name !== undefined) updateData.businessName = sanitizeName(name);
    if (description !== undefined) updateData.description = sanitizeString(description, { maxLength: 500 });
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (logo !== undefined) updateData.logo = logo;
    if (coverImage !== undefined) updateData.coverImage = coverImage;
    if (website !== undefined) updateData.website = website;
    if (phone !== undefined) updateData.phone = phone; // Business phone update
    if (state !== undefined) updateData.state = sanitizeString(state, { maxLength: 100 }); // State update
    if (city !== undefined) updateData.city = sanitizeString(city, { maxLength: 100 }); // City update

    // Verify business exists and belongs to user
    const existingBusiness = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, businessId));

    if (existingBusiness.length === 0) {
      return res.status(404).json({ message: "Business profile not found" });
    }

    const user = await db.select().from(users).where(eq(users.id, userId));
    if (user.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update business
    const [updatedBusiness] = await db
      .update(businessProfiles)
      .set(updateData)
      .where(
        and(
          eq(businessProfiles.id, businessId),
          eq(businessProfiles.providerId, userId),
        ),
      )
      .returning();

    if (!updatedBusiness) {
      return res.status(404).json({ message: "Business profile not found" });
    }

    // Fetch complete business data with joins
    const result = await db
      .select({
        // Business fields
        id: businessProfiles.id,
        providerId: businessProfiles.providerId,
        userId: businessProfiles.providerId,
        businessName: businessProfiles.businessName,
        name: businessProfiles.businessName,
        description: businessProfiles.description,
        categoryId: businessProfiles.categoryId,
        category: Category.name,
        phone: businessProfiles.phone, // Business phone
        state: businessProfiles.state, // State/Province
        city: businessProfiles.city, // City
        website: businessProfiles.website,
        logo: businessProfiles.logo,
        coverImage: businessProfiles.coverImage,
        isVerified: businessProfiles.isVerified,
        hasPaymentDetails: businessProfiles.hasPaymentDetails,
        createdAt: businessProfiles.createdAt,
        // Provider fields
        providerName: users.name,
        providerEmail: users.email,
        providerPhone: users.phone,
      })
      .from(businessProfiles)
      .leftJoin(users, eq(businessProfiles.providerId, users.id))
      .leftJoin(Category, eq(businessProfiles.categoryId, Category.id))
      .where(eq(businessProfiles.id, updatedBusiness.id));

    const businessData = result[0];
    businessData.status = businessData.isVerified ? "active" : "pending";
    businessData.email = businessData.providerEmail;

    // Calculate real rating and total reviews from feedback table
    const serviceData = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessProfileId, businessData.id));
    
    const serviceIds = serviceData.map(s => s.id);
    
    if (serviceIds.length > 0) {
      const [stats] = await db
        .select({
          avgRating: sql`avg(${feedbackTable.rating})`,
          count: sql`count(*)`
        })
        .from(feedbackTable)
        .where(inArray(feedbackTable.serviceId, serviceIds));
      
      businessData.rating = Number(stats?.avgRating) || 0;
      businessData.totalReviews = Number(stats?.count) || 0;
    } else {
      businessData.rating = 0;
      businessData.totalReviews = 0;
    }

    res.status(200).json({
      message: "Business profile updated successfully",
      business: businessData,
    });
    res.status(200).json({
      message: "Business profile updated successfully",
      business: businessData,
    });
  } catch (error) {
    console.error("Error in updateBusiness:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
const deleteBusiness = async (req, res) => {
  try {
    const businessId = req.params.id;
    const userId = req.token.id;

    // Check if business exists
    const existingBusiness = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, businessId));

    if (existingBusiness.length === 0) {
      return res.status(404).json({ message: "Business profile not found" });
    }

    // Verify user exists
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (user.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Delete business
    const deletedCount = await db
      .delete(businessProfiles)
      .where(
        and(
          eq(businessProfiles.id, businessId),
          eq(businessProfiles.providerId, userId),
        ),
      )
      .returning();

    if (deletedCount.length === 0) {
      return res.status(404).json({ message: "Business profile not found" });
    }

    res.status(200).json({ message: "Business profile deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get provider's business and service status
 * GET /provider/status
 * Returns blocked business info and deactivated services
 */
const getProviderStatus = async (req, res) => {
  try {
    const userId = req.token.id;

    // Get business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, userId))
      .limit(1);

    if (!business) {
      return res.json({
        hasBusiness: false,
        business: null,
        deactivatedServices: [],
      });
    }

    // Get all services for this business
    const allServices = await db
      .select()
      .from(services)
      .where(eq(services.businessProfileId, business.id));

    // Get deactivated services
    const deactivatedServices = allServices
      .filter((s) => !s.isActive)
      .map((s) => ({
        id: s.id,
        name: s.name,
        deactivationReason: s.deactivationReason,
        deactivatedAt: s.deactivatedAt,
      }));

    // Check if provider has active payment details (direct check, not cached flag)
    const [paymentDetail] = await db
      .select()
      .from(paymentDetails)
      .where(eq(paymentDetails.userId, userId))
      .limit(1);

    const hasActivePaymentDetails = paymentDetail?.isActive || false;

    res.json({
      hasBusiness: true,
      business: {
        id: business.id,
        isBlocked: business.isBlocked || false,
        blockedReason: business.blockedReason,
        blockedAt: business.blockedAt,
        isVerified: business.isVerified || false,
        hasPaymentDetails: hasActivePaymentDetails,
        businessName: business.businessName,
      },
      deactivatedServices,
    });
  } catch (error) {
    console.error("Error in getProviderStatus:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getAllBusinesses,
  getBusinessByProviderId,
  getBusinessById,
  addBusiness,
  verifyBusiness,
  updateBusiness,
  deleteBusiness,
  getProviderStatus,
};
