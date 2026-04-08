const express = require("express");
const router = express.Router();
const {
  getRevenueAnalytics,
  getServiceAnalytics,
  getStatusAnalytics,
  getTimePatternsAnalytics,
} = require("../controllers/providerAnalytics.controller");

// All routes require authentication (global auth middleware)
// Only providers (roleId: 2) can access these routes

/**
 * @route   GET /provider/analytics/revenue
 * @desc    Get revenue and bookings over time for charts
 * @query   period - Time period: 7d, 30d, 6m, 12m, all (default: 30d)
 * @access  Private (Provider only)
 */
router.get("/revenue", getRevenueAnalytics);

/**
 * @route   GET /provider/analytics/services
 * @desc    Get service performance data
 * @query   period - Time period: 7d, 30d, 6m, 12m, all (default: 30d)
 * @access  Private (Provider only)
 */
router.get("/services", getServiceAnalytics);

/**
 * @route   GET /provider/analytics/status
 * @desc    Get booking status breakdown
 * @query   period - Time period: 7d, 30d, 6m, 12m, all (default: 30d)
 * @access  Private (Provider only)
 */
router.get("/status", getStatusAnalytics);

/**
 * @route   GET /provider/analytics/time-patterns
 * @desc    Get hourly and daily booking distribution patterns
 * @query   period - Time period: 7d, 30d, 6m, 12m, all (default: 30d)
 * @access  Private (Provider only, Premium plan)
 */
router.get("/time-patterns", getTimePatternsAnalytics);

module.exports = router;
