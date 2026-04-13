const express = require("express");
const router = express.Router();
const {
  getActivePolicy,
  getAllVersions,
  getVersion,
  createPolicy,
  updatePolicy,
  activatePolicy,
  deletePolicy,
} = require("../controllers/privacyPolicy.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { ADMIN } = require("../config/roles");

// Public routes
router.get("/active", getActivePolicy);

// Admin only routes
router.get("/versions", authorizeRole(ADMIN), getAllVersions);
router.get("/versions/:id", authorizeRole(ADMIN), getVersion);
router.post("/", authorizeRole(ADMIN), createPolicy);
router.put("/:id", authorizeRole(ADMIN), updatePolicy);
router.post("/:id/activate", authorizeRole(ADMIN), activatePolicy);
router.delete("/:id", authorizeRole(ADMIN), deletePolicy);

module.exports = router;
