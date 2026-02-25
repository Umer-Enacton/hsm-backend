const db = require("../config/db");
const { services, businessProfiles, feedback } = require("../models/schema");
const { eq, and, or, ilike, gte, lte, count } = require("drizzle-orm");

const getAllServices = async (req, res) => {
  try {
    // Extract query parameters for filtering
    const {
      state,
      city,
      category_id,
      min_price,
      max_price,
      search
    } = req.query;

    // Build dynamic WHERE conditions
    const conditions = [];

    // Search filter - search in service name OR description (case-insensitive)
    if (search && search.trim()) {
      const searchTerm = search.trim();
      conditions.push(
        or(
          ilike(services.name, `%${searchTerm}%`),
          ilike(services.description, `%${searchTerm}%`)
        )
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

    // Build the query
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
        createdAt: services.createdAt,
        // Business/Provider fields
        provider: {
          id: businessProfiles.id,
          businessName: businessProfiles.businessName,
          description: businessProfiles.description,
          phone: businessProfiles.phone,
          state: businessProfiles.state,
          city: businessProfiles.city,
          logo: businessProfiles.logo,
          isVerified: businessProfiles.isVerified,
        },
      })
      .from(services)
      .leftJoin(businessProfiles, eq(services.businessProfileId, businessProfiles.id));

    // Apply WHERE clause if conditions exist
    if (whereClause) {
      query = query.where(whereClause);
    }

    const allServices = await query;

    res.status(200).json({ services: allServices, total: allServices.length });
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
        createdAt: services.createdAt,
        // Business/Provider fields
        provider: {
          id: businessProfiles.id,
          businessName: businessProfiles.businessName,
          description: businessProfiles.description,
          phone: businessProfiles.phone,
          state: businessProfiles.state,
          city: businessProfiles.city,
          logo: businessProfiles.logo,
          isVerified: businessProfiles.isVerified,
        },
      })
      .from(services)
      .leftJoin(businessProfiles, eq(services.businessProfileId, businessProfiles.id))
      .where(eq(services.id, serviceId));

    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    // Add empty slots and reviews arrays (frontend expects these)
    const serviceDetails = {
      ...service,
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
    const mappedServices = businessServices.map(service => ({
      ...service,
      duration: service.EstimateDuration, // Map backend field to frontend expected field
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
    const { name, description, price, duration, image } = req.body;
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
          eq(businessProfiles.providerId, userId)
        )
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
    const [newService] = await db
      .insert(services)
      .values({
        businessProfileId: businessId,
        name,
        description,
        EstimateDuration: duration,
        price,
        image: image || null,
      })
      .returning();

    // Map EstimateDuration to duration for frontend compatibility
    const serviceResponse = {
      ...newService,
      duration: newService.EstimateDuration,
    };

    res
      .status(201)
      .json({ message: "Service added successfully", service: serviceResponse });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
const updateService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    //const userId = req.params.userId;
    const userId = req.token.id;
    const { name, description, price, duration, image, isActive } = req.body;
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
          eq(businessProfiles.providerId, userId)
        )
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
          eq(businessProfiles.providerId, userId)
        )
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
module.exports = {
  getAllServices,
  getServiceById,
  getServicesByBusiness,
  addService,
  updateService,
  deleteService,
};
