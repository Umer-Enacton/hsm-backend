const express = require("express");
const router = express.Router();
const {
  getSlotsPublic,
  addSlot,
  deleteSlot,
  getSlotsByBusiness,
} = require("../controllers/slot.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { PROVIDER } = require("../config/roles");
const validate = require("../middleware/validate");
const { slotSchema } = require("../helper/validation");

// Public endpoint for customers to view available slots
router.get("/slots/public/:businessId", getSlotsPublic);

// Provider endpoint to manage their own slots
router.get("/slots/:businessId", authorizeRole(PROVIDER), getSlotsByBusiness);

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
