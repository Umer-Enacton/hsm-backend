const express = require("express");
const router = express.Router();
const {
  getActiveTerms,
  getAllVersions,
  getVersion,
  createTerms,
  updateTerms,
  activateTerms,
  deleteTerms,
} = require("../controllers/termsCondition.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { ADMIN } = require("../config/roles");

// Public routes
router.get("/active", getActiveTerms);

// Admin only routes
router.get("/versions", authorizeRole(ADMIN), getAllVersions);
router.get("/versions/:id", authorizeRole(ADMIN), getVersion);
router.post("/", authorizeRole(ADMIN), createTerms);
router.put("/:id", authorizeRole(ADMIN), updateTerms);
router.post("/:id/activate", authorizeRole(ADMIN), activateTerms);
router.delete("/:id", authorizeRole(ADMIN), deleteTerms);

module.exports = router;
