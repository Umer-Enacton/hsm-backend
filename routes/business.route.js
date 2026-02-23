const express = require("express");
const router = express.Router();
const {
  getAllBusinesses,
  getBusinessByProviderId,
  getBusinessById,
  addBusiness,
  deleteBusiness,
  updateBusiness,
  verifyBusiness,
} = require("../controllers/business.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { PROVIDER, ADMIN } = require("../config/roles");
const validate = require("../middleware/validate");
const { businessSchema } = require("../helper/validation");

// Public - get all businesses
router.get("/businesses", getAllBusinesses);

// Public - get business by ID
router.get("/businesses/:id", getBusinessById);

// Public - get business by provider ID
router.get("/business/provider/:userId", getBusinessByProviderId);

// Admin - verify business
router.put("/businesses/verify/:id", authorizeRole(ADMIN), verifyBusiness);

// Provider - add business
router.post(
  "/businesses",
  authorizeRole(PROVIDER),
  validate(businessSchema),
  addBusiness
);

// Provider - update business
router.put(
  "/businesses/:id",
  authorizeRole(PROVIDER),
  validate(businessSchema),
  updateBusiness
);

// Provider - delete business
router.delete("/businesses/:id", authorizeRole(PROVIDER), deleteBusiness);

module.exports = router;
