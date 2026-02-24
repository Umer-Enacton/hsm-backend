const express = require("express");
const router = express.Router();
const {
  getSlotsPublic,
  addSlot,
  deleteSlot,
  getSlotsByBusiness,
  timeToMinutes,
  minutesToTime,
} = require("../controllers/slot.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { PROVIDER } = require("../config/roles");
const validate = require("../middleware/validate");
const { slotSchema } = require("../helper/validation");
const db = require("../config/db");
const { slots } = require("../models/schema");

// Public endpoint for customers to view available slots
router.get("/slots/public/:businessId", getSlotsPublic);

// Provider endpoint to manage their own slots
router.get("/slots/:businessId", authorizeRole(PROVIDER), getSlotsByBusiness);

// Generate slots from working hours and break times (provided in request body)
router.post("/slots/:businessId/generate", authorizeRole(PROVIDER), async (req, res) => {
  try {
    const { businessId } = req.params;
    const { workingHours, breakTime, slotInterval = 30 } = req.body; // Default 30 minutes

    // Verify request body contains required data
    if (!workingHours || !workingHours.startTime || !workingHours.endTime) {
      return res.status(400).json({ message: "workingHours with startTime and endTime are required" });
    }

    // Verify business is owned by this user
    const { businessProfiles } = require("../models/schema");
    const { eq, and } = require("drizzle-orm");

    const business = await db
      .select()
      .from(businessProfiles)
      .where(
        and(
          eq(businessProfiles.id, businessId),
          eq(businessProfiles.providerId, req.token.id)
        )
      );

    if (business.length === 0) {
      return res
        .status(404)
        .json({ message: "Business profile not found for this user" });
    }

    // Generate slots for general working hours
    let currentMinutes = timeToMinutes(workingHours.startTime);
    const endMinutes = timeToMinutes(workingHours.endTime);

    // Calculate break minutes if break time is provided
    let breakStartMinutes = 0;
    let breakEndMinutes = 0;
    if (breakTime && breakTime.startTime && breakTime.endTime) {
      breakStartMinutes = timeToMinutes(breakTime.startTime);
      breakEndMinutes = timeToMinutes(breakTime.endTime);
    }

    let slotsGenerated = 0;

    // Generate slots at regular intervals
    while (currentMinutes < endMinutes) {
      const timeStr = minutesToTime(currentMinutes);

      // Check if this time falls within break time
      let inBreak = false;
      if (breakTime && breakTime.startTime && breakTime.endTime) {
        inBreak = currentMinutes >= breakStartMinutes && currentMinutes < breakEndMinutes;
      }

      // Only create slot if not in break time
      if (!inBreak) {
        try {
          await db.insert(slots)
            .values({
              businessProfileId: businessId,
              startTime: timeStr
            })
            .onConflictDoNothing(); // Skip if already exists
          slotsGenerated++;
        } catch (e) {
          // Ignore duplicate errors
        }
      }

      currentMinutes += slotInterval;
    }

    res.status(200).json({
      message: `Successfully generated ${slotsGenerated} slots`,
      slotsGenerated
    });
  } catch (error) {
    console.error("Error generating slots:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post(
  "/slots/:businessId",
  authorizeRole(PROVIDER),
  validate(slotSchema),
  addSlot
);

router.delete(
  "/businesses/:businessId/slots/:slotId",
  authorizeRole(PROVIDER),
  deleteSlot
);

module.exports = router;
