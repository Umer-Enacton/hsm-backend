const db = require("../config/db");
const { services, businessProfiles } = require("../models/schema");
const { eq, and } = require("drizzle-orm");

const getAllServices = async (req, res) => {
  try {
    const allServices = await db.select().from(services);
    res.status(200).json({ services: allServices });
  } catch (error) {
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

    res.status(200).json({ services: businessServices });
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
    res
      .status(201)
      .json({ message: "Service added successfully", service: newService });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
const updateService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    //const userId = req.params.userId;
    const userId = req.token.id;
    const { name, description, price, duration, image } = req.body;
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
    res.status(200).json({
      message: "Service updated successfully",
      service: updatedService,
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
  getServicesByBusiness,
  addService,
  updateService,
  deleteService,
};
