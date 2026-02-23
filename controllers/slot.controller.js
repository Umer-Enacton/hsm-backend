const { get } = require("node:http");
const db = require("../config/db");
const { businessProfiles, slots } = require("../models/schema");
const { eq, and, or, lt, gt } = require("drizzle-orm");

// Get slots for a business (PUBLIC - for customers to view available slots)
const getSlotsPublic = async (req, res) => {
  try {
    const { businessId } = req.params;

    if (!businessId) {
      return res.status(400).json({ message: "Business ID is required" });
    }

    // Verify business exists
    const business = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, businessId));

    if (business.length === 0) {
      return res.status(404).json({ message: "Business not found" });
    }

    // Only return slots if business is verified
    if (!business[0].isVerified) {
      return res.status(403).json({
        message: "Business is not verified yet",
      });
    }

    // Get all available slots for this business
    const businessSlots = await db
      .select()
      .from(slots)
      .where(eq(slots.businessProfileId, businessId))
      .orderBy(slots.startTime);

    res.status(200).json({ slots: businessSlots });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

//get slots for a business by user id that is in business provider id (PROVIDER ONLY)
const getSlotsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const userId = req.token.id;
    if (!userId) {
      return res
        .status(400)
        .json({ message: "Business ID and User ID are required" });
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
    const businessSlots = await db
      .select()
      .from(slots)
      .where(eq(slots.businessProfileId, businessId));
    res.status(200).json({ slots: businessSlots });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

//add slot for a business by business id and user id
const addSlot = async (req, res) => {
  const userId = req.token.id;
  try {
    const { businessId } = req.params;
    const { startTime, endTime } = req.body;
    if (!userId) {
      return res
        .status(400)
        .json({ message: "Business ID and User ID are required" });
    }
    if (!startTime || !endTime) {
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
    //slot time exists check
    const slotExists = await db
      .select()
      .from(slots)
      .where(
        and(
          eq(slots.businessProfileId, businessId),
          eq(slots.startTime, startTime),
          eq(slots.endTime, endTime)
        )
      );
    if (slotExists.length > 0) {
      return res
        .status(400)
        .json({ message: "Slot already exists for this time" });
    }
    //slot time validation
    if (startTime >= endTime) {
      return res
        .status(400)
        .json({ message: "Start time not be greater then end slot time" });
    }

    //slot overlapping check
    const overlappingSlot = await db
      .select()
      .from(slots)
      .where(
        and(
          eq(slots.businessProfileId, businessId),
          lt(slots.startTime, endTime),
          gt(slots.endTime, startTime)
        )
      );

    console.log(overlappingSlot);
    if (overlappingSlot.length > 0) {
      return res
        .status(400)
        .json({ message: "Slot time overlaps with existing slot" });
    }
    const [newSlot] = await db
      .insert(slots)
      .values({
        businessProfileId: businessId,
        startTime,
        endTime,
      })
      .returning();
    res.status(201).json({ message: "Slot added successfully", slot: newSlot });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
const deleteSlot = async (req, res) => {
  try {
    const { slotId, businessId } = req.params;
    const userId = req.token.id;
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    console.log("slotId:", slotId);
    console.log("BusinessId:", businessId);
    console.log("UserId", userId);
    const business = await db
      .select()
      .from(businessProfiles)
      .where(
        and(
          eq(businessProfiles.id, businessId),
          eq(businessProfiles.providerId, userId)
        )
      );
    console.log("business", business);
    if (business.length === 0) {
      return res
        .status(404)
        .json({ message: "Business profile not found for this user" });
    }
    const deletedCount = await db
      .delete(slots)
      .where(and(eq(slots.id, slotId), eq(slots.businessProfileId, businessId)))
      .returning();
    console.log("delete", deletedCount);
    if (deletedCount.length === 0) {
      return res.status(404).json({ message: "Slot not found" });
    }
    res.status(200).json({ message: "Slot deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
module.exports = {
  getSlotsPublic,
  addSlot,
  deleteSlot,
  getSlotsByBusiness,
};
