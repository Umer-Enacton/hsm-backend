const db = require("../config/db");
const { businessProfiles, users, Category } = require("../models/schema");
const { eq, and } = require("drizzle-orm");

const getAllBusinesses = async (req, res) => {
  try {
    // Join with users and categories to get complete business data
    const businesses = await db
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
        rating: businessProfiles.rating,
        isVerified: businessProfiles.isVerified,
        createdAt: businessProfiles.createdAt,
        // Provider fields
        providerName: users.name,
        providerEmail: users.email,
        providerPhone: users.phone,
      })
      .from(businessProfiles)
      .leftJoin(users, eq(businessProfiles.providerId, users.id))
      .leftJoin(Category, eq(businessProfiles.categoryId, Category.id));

    // Add computed fields to each business
    const businessesWithStatus = businesses.map(business => ({
      ...business,
      status: business.isVerified ? "active" : "pending",
      totalReviews: 0, // TODO: Calculate from feedback table
      email: business.providerEmail, // For contact purposes
    }));

    res.status(200).json({ businesses: businessesWithStatus });
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
        rating: businessProfiles.rating,
        isVerified: businessProfiles.isVerified,
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
      return res.status(404).json({ message: "Business profile not found for this provider" });
    }

    const business = result[0];
    // Add computed fields
    business.status = business.isVerified ? "active" : "pending";
    business.totalReviews = 0; // TODO: Calculate from feedback table

    // Email is provider's email (for contact)
    business.email = business.providerEmail;

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
        rating: businessProfiles.rating,
        isVerified: businessProfiles.isVerified,
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
    business.totalReviews = 0;
    business.email = business.providerEmail;

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
    const { name, description, categoryId, logo, coverImage, website, phone, state, city } = req.body;

    if (!name || !description || !categoryId || !state || !city) {
      return res.status(400).json({ message: "All fields are required (name, description, category, state, city)" });
    }

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
        businessName: name,
        description,
        categoryId,
        phone: businessPhone, // Business phone (can be different from provider's personal phone)
        state, // State/Province
        city, // City within state
        logo: logo || null,
        coverImage: coverImage || null,
        website: website || null,
      })
      .returning();

    console.log("Business created:", newBusiness);

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
        website: businessProfiles.website,
        logo: businessProfiles.logo,
        coverImage: businessProfiles.coverImage,
        rating: businessProfiles.rating,
        isVerified: businessProfiles.isVerified,
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
    business.totalReviews = 0;
    business.email = business.providerEmail; // For contact purposes

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
    const { name, description, categoryId, logo, coverImage, website, phone, state, city } = req.body;

    // Build update object dynamically
    const updateData = {};
    if (name !== undefined) updateData.businessName = name;
    if (description !== undefined) updateData.description = description;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (logo !== undefined) updateData.logo = logo;
    if (coverImage !== undefined) updateData.coverImage = coverImage;
    if (website !== undefined) updateData.website = website;
    if (phone !== undefined) updateData.phone = phone; // Business phone update
    if (state !== undefined) updateData.state = state; // State update
    if (city !== undefined) updateData.city = city; // City update

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
          eq(businessProfiles.providerId, userId)
        )
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
        rating: businessProfiles.rating,
        isVerified: businessProfiles.isVerified,
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
    businessData.totalReviews = 0;
    businessData.email = businessData.providerEmail; // For contact purposes

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
          eq(businessProfiles.providerId, userId)
        )
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
module.exports = {
  getAllBusinesses,
  getBusinessByProviderId,
  getBusinessById,
  addBusiness,
  verifyBusiness,
  updateBusiness,
  deleteBusiness,
};
