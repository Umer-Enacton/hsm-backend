const db = require("../config/db");
const { businessProfiles, users, Category } = require("../models/schema");
const { eq, and } = require("drizzle-orm");

const getAllBusinesses = async (req, res) => {
  try {
    const businesses = await db.select().from(businessProfiles);
    res.status(200).json({ businesses });
  } catch (error) {
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

    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, providerId));

    if (!business) {
      return res.status(404).json({ message: "Business profile not found for this provider" });
    }

    res.status(200).json({ business });
  } catch (error) {
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

    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, businessId));

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    res.status(200).json({ business });
  } catch (error) {
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
    //const userId = req.params.userId;
    const { name, description, categoryId, logo, coverImage, website } = req.body;

    if (!name || !description || !categoryId) {
      return res.status(400).json({ message: "All fields are required" });
    }
    const phoneResult = await db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (phoneResult.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    const phone = phoneResult[0].phone;
    const businessExists = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, userId));
    if (businessExists.length > 0) {
      return res
        .status(400)
        .json({ message: "Business profile already exists for this user" });
    }
    const [newBusiness] = await db
      .insert(businessProfiles)
      .values({
        providerId: userId,
        businessName: name,
        description,
        categoryId,
        phone,
        logo: logo || null,
        coverImage: coverImage || null,
        website: website || null,
      })
      .returning();
    console.log(newBusiness);
    res.status(201).json({
      message: "Business profile added successfully",
      business: newBusiness,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
const updateBusiness = async (req, res) => {
  try {
    const businessId = req.params.id;
    const userId = req.token.id;

    // const userId = req.params.userId;
    const { name, description, categoryId, logo, coverImage, website } = req.body;

    // Build update object dynamically
    const updateData = {};
    if (name !== undefined) updateData.businessName = name;
    if (description !== undefined) updateData.description = description;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (logo !== undefined) updateData.logo = logo;
    if (coverImage !== undefined) updateData.coverImage = coverImage;
    if (website !== undefined) updateData.website = website;

    const business = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, businessId));
    if (business.length === 0) {
      return res.status(404).json({ message: "Business profile not found" });
    }
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (user.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    console.log(userId);
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
    console.log(updatedBusiness);
    if (!updatedBusiness) {
      return res.status(404).json({ message: "Business profile not found" });
    }
    res.status(200).json({
      message: "Business profile updated successfully",
      business: updatedBusiness,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
const deleteBusiness = async (req, res) => {
  try {
    const businessId = req.params.id;
    const userId = req.token.id;
    //const userId = req.params.userId;
    const business = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, businessId));
    if (business.length === 0) {
      return res.status(404).json({ message: "Business profile not found" });
    }
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (user.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    console.log(user);
    const deletedCount = await db
      .delete(businessProfiles)
      .where(
        and(
          eq(businessProfiles.id, businessId),
          eq(businessProfiles.providerId, userId)
        )
      )
      .returning();
    console.log(deletedCount);
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
