const db = require("../config/db");
const {
  businessProfiles,
  slots,
  bookings,
  paymentIntents,
} = require("../models/schema");
const { eq, and, lt, gt, or, sql, inArray, gte, lte } = require("drizzle-orm");

/**
 * Helper: Convert time string "HH:mm:ss" to minutes
 */
function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Helper: Convert minutes to time string "HH:mm:ss"
 */
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:00`;
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
 * Query params:
 *  - date (YYYY-MM-DD) - to check availability for specific date
 *  - serviceId (optional) - filter by service to show availability per service
 */
const getSlotsPublic = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { date, serviceId } = req.query; // Optional: date and serviceId

    console.log(
      `📡 Getting slots for business ${businessId}, date: ${date || "not provided"}, service: ${serviceId || "all services"}`,
    );

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

    // Get all time slot templates for this business
    const businessSlots = await db
      .select()
      .from(slots)
      .where(eq(slots.businessProfileId, businessId))
      .orderBy(slots.startTime);

    // If no date provided, return all slots as available
    if (!date) {
      const slotsWithAvailability = businessSlots.map((slot) => ({
        ...slot,
        isAvailable: true,
        status: "available",
      }));

      console.log(
        `✅ Returning ${slotsWithAvailability.length} slots (no date filter)`,
      );
      return res.status(200).json({ slots: slotsWithAvailability });
    }

    // If date provided, check which slots are booked/locked for this specific date
    console.log(`🔍 Checking availability for date: ${date}`);

    // Create date range for the selected date
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    console.log(
      `📅 Date range: ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`,
    );

    // Find slots that have confirmed/pending bookings for this date
    // IMPORTANT: Only filter by serviceId if serviceId is provided
    const bookingConditions = [
      eq(bookings.businessProfileId, businessId),
      // Check if bookingDate falls within the selected date
      and(
        gte(bookings.bookingDate, startOfDay),
        lte(bookings.bookingDate, endOfDay),
      ),
      or(eq(bookings.status, "pending"), eq(bookings.status, "confirmed")),
    ];

    // If serviceId provided, only check bookings for that service
    if (serviceId) {
      bookingConditions.push(eq(bookings.serviceId, parseInt(serviceId)));
    }

    const bookedSlotsResult = await db
      .select({ slotId: bookings.slotId })
      .from(bookings)
      .where(and(...bookingConditions));

    // Find slots that are currently locked (pending payment) for this date
    // IMPORTANT: Only filter by serviceId if serviceId is provided
    const paymentIntentConditions = [
      eq(slots.businessProfileId, businessId), // Check via slots table
      // Check if bookingDate falls within the selected date
      and(
        gte(paymentIntents.bookingDate, startOfDay),
        lte(paymentIntents.bookingDate, endOfDay),
      ),
      eq(paymentIntents.status, "pending"),
      gt(paymentIntents.expiresAt, new Date()), // Not expired yet
    ];

    // If serviceId provided, only check payment intents for that service
    if (serviceId) {
      paymentIntentConditions.push(
        eq(paymentIntents.serviceId, parseInt(serviceId)),
      );
    }

    const lockedSlotsResult = await db
      .select({ slotId: paymentIntents.slotId })
      .from(paymentIntents)
      .innerJoin(slots, eq(paymentIntents.slotId, slots.id))
      .where(and(...paymentIntentConditions));

    // Fetch service's maxAllowBooking
    let maxBookingLimit = 1;
    if (serviceId) {
      const { services } = require("../models/schema");
      const serviceData = await db
        .select()
        .from(services)
        .where(eq(services.id, parseInt(serviceId)));
      if (serviceData.length > 0) {
        maxBookingLimit = serviceData[0].maxAllowBooking || 1;
      }
    }

    // Combine booked and locked slot IDs and count them
    const slotCounts = {};
    bookedSlotsResult.forEach((b) => {
      slotCounts[b.slotId] = (slotCounts[b.slotId] || 0) + 1;
    });
    lockedSlotsResult.forEach((l) => {
      slotCounts[l.slotId] = (slotCounts[l.slotId] || 0) + 1;
    });

    const unavailableSlotIds = new Set();
    Object.keys(slotCounts).forEach((slotIdStr) => {
      const sid = parseInt(slotIdStr);
      if (slotCounts[sid] >= maxBookingLimit) {
        unavailableSlotIds.add(sid);
      }
    });

    console.log(
      `📊 Service ${serviceId || "ALL"} - Booked slots:`,
      bookedSlotsResult.map((b) => b.slotId),
    );
    console.log(
      `🔒 Service ${serviceId || "ALL"} - Locked slots:`,
      lockedSlotsResult.map((l) => l.slotId),
    );
    console.log(
      `🚫 Service ${serviceId || "ALL"} - Total unavailable slot IDs:`,
      Array.from(unavailableSlotIds),
    );

    // Mark each slot with availability status
    const slotsWithAvailability = businessSlots.map((slot) => {
      const isUnavailable = unavailableSlotIds.has(slot.id);
      return {
        ...slot,
        isAvailable: !isUnavailable,
        status: isUnavailable ? "booked" : "available",
      };
    });

    console.log(
      `✅ Returning ${slotsWithAvailability.length} slots with availability`,
    );
    console.log(
      `📊 Summary: ${slotsWithAvailability.filter((s) => !s.isAvailable).length} booked, ${slotsWithAvailability.filter((s) => s.isAvailable).length} available`,
    );

    res.status(200).json({ slots: slotsWithAvailability });
  } catch (error) {
    console.error("❌ Error in getSlotsPublic:", error);
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
          eq(businessProfiles.providerId, userId),
        ),
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
    console.error("Error getting business slots:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Add a new slot (PROVIDER ONLY)
 */
const addSlot = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { startTime } = req.body;
    const userId = req.token.id;

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
          eq(businessProfiles.providerId, userId),
        ),
      );

    if (business.length === 0) {
      return res.status(404).json({ message: "Business not found" });
    }

    // Create new slot
    const [newSlot] = await db
      .insert(slots)
      .values({
        businessProfileId: businessId,
        startTime: startTime,
      })
      .returning();

    res.status(201).json({
      message: "Slot created successfully",
      slot: newSlot,
    });
  } catch (error) {
    console.error("Error adding slot:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Delete a slot (PROVIDER ONLY)
 */
const deleteSlot = async (req, res) => {
  try {
    const { businessId, slotId } = req.params;
    const userId = req.token.id;

    // Verify business is owned by this user
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
      return res.status(404).json({ message: "Business not found" });
    }

    // Check if slot exists and belongs to this business
    const [slot] = await db
      .select()
      .from(slots)
      .where(
        and(eq(slots.id, slotId), eq(slots.businessProfileId, businessId)),
      );

    if (!slot) {
      return res.status(404).json({ message: "Slot not found" });
    }

    // Delete slot
    await db.delete(slots).where(eq(slots.id, slotId));

    res.status(200).json({ message: "Slot deleted successfully" });
  } catch (error) {
    console.error("Error deleting slot:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getSlotsPublic,
  getSlotsByBusiness,
  addSlot,
  deleteSlot,
  timeToMinutes,
  minutesToTime,
};
