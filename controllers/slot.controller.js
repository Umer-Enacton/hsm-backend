const db = require("../config/db");
const { businessProfiles, slots } = require("../models/schema");
const { eq, and, lt, gt } = require("drizzle-orm");

/**
 * Helper: Convert time string "HH:mm:ss" to minutes
 */
function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Helper: Convert minutes to time string "HH:mm:ss"
 */
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`;
}

/**
 * Helper: Add minutes to a time string
 */
function addMinutes(timeStr, minutesToAdd) {
  const totalMinutes = timeToMinutes(timeStr) + minutesToAdd;
  return minutesToTime(totalMinutes);
}

/**
 * Get slots for a business (PUBLIC - for customers to view available slots)
 */
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

    // Get all available slots for this business (only start times)
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

/**
 * Get slots for a business by user id (PROVIDER ONLY)
 */
const getSlotsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const userId = req.token.id;

    if (!userId) {
      return res
        .status(400)
        .json({ message: "Business ID and User ID are required" });
    }

    // Verify business is owned by this user
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
      .where(eq(slots.businessProfileId, businessId))
      .orderBy(slots.startTime);

    res.status(200).json({ slots: businessSlots });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Add slot for a business (only start time required)
 */
const addSlot = async (req, res) => {
  const userId = req.token.id;
  try {
    const { businessId } = req.params;
    const { startTime } = req.body; // Only need startTime now

    if (!userId) {
      return res
        .status(400)
        .json({ message: "User ID is required" });
    }

    if (!startTime) {
      return res.status(400).json({ message: "Start time is required" });
    }

    // Verify business is owned by this user
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

    // Check for duplicate start time
    const slotExists = await db
      .select()
      .from(slots)
      .where(
        and(
          eq(slots.businessProfileId, businessId),
          eq(slots.startTime, startTime)
        )
      );

    if (slotExists.length > 0) {
      return res
        .status(400)
        .json({ message: "Slot with this start time already exists" });
    }

    // Create new slot (only with startTime)
    const [newSlot] = await db
      .insert(slots)
      .values({
        businessProfileId: businessId,
        startTime,
      })
      .returning();

    res.status(201).json({ message: "Slot added successfully", slot: newSlot });
  } catch (error) {
    // Handle unique constraint violation
    if (error.code === '23505') {
      return res.status(400).json({ message: "Slot with this start time already exists" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Delete a slot
 */
const deleteSlot = async (req, res) => {
  try {
    const { slotId, businessId } = req.params;
    const userId = req.token.id;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Verify business is owned by this user
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

    const deletedCount = await db
      .delete(slots)
      .where(and(eq(slots.id, slotId), eq(slots.businessProfileId, businessId)))
      .returning();

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
  timeToMinutes,
  minutesToTime,
  addMinutes,
};
