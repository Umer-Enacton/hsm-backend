const express = require("express");
const router = express.Router();
const {
  createPlan,
  getPlans,
  getPlan,
  updatePlan,
  deletePlan,
} = require("../controllers/subscription.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { ADMIN } = require("../config/roles");

// All subscription plan routes require admin role
router.get("/plans", getPlans);
router.get("/plans/:planId", getPlan);
router.post("/plans", authorizeRole(ADMIN), createPlan);
router.put("/plans/:planId", authorizeRole(ADMIN), updatePlan);
router.delete("/plans/:planId", authorizeRole(ADMIN), deletePlan);

module.exports = router;
