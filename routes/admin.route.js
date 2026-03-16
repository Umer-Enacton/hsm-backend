const express = require("express");
const router = express.Router();
const {
  getPlatformSettings,
  updatePlatformSettings,
  getRevenueStats,
  getDashboardStats,
  getPayouts,
  getPayoutsSummary,
  getPayoutsByProvider,
  payProvider,
  markPayoutAsPaid,
  bulkProcessPayouts,
} = require("../controllers/admin.controller");
const {
  getRevenueAnalytics,
  getCategoryAnalytics,
  getStatusAnalytics,
  getTopProvidersAnalytics,
  getPaymentStatusAnalytics,
  getAverageOrderValueAnalytics,
} = require("../controllers/adminAnalytics.controller");
const {
  checkAdminPaymentDetails,
  getProviderRevenueStats,
} = require("../controllers/paymentDetails.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { ADMIN, PROVIDER } = require("../config/roles");

// ============================================
// ADMIN DASHBOARD & STATS ROUTES
// All routes require authentication (global auth middleware)
// Only admin (roleId: 3) can access these routes
// ============================================

/**
 * @route   GET /admin/dashboard/stats
 * @desc    Get dashboard statistics
 * @access  Private (Admin only)
 */
router.get("/dashboard/stats", getDashboardStats);

// ============================================
// ADMIN SETTINGS & REVENUE ROUTES
// All routes require authentication (global auth middleware)
// Only admin (roleId: 3) can access these routes
// ============================================

/**
 * @route   GET /admin/settings
 * @desc    Get platform settings (fee percentage, minimum payout, etc.)
 * @access  Private (Admin only)
 */
router.get("/settings", getPlatformSettings);

/**
 * @route   PUT /admin/settings
 * @desc    Update platform settings
 * @access  Private (Admin only)
 */
router.put("/settings", updatePlatformSettings);

/**
 * @route   GET /admin/revenue
 * @desc    Get platform revenue statistics
 * @query   startDate - Optional start date filter
 * @query   endDate - Optional end date filter
 * @query   groupBy - Optional grouping (e.g., "month" for monthly breakdown)
 * @access  Private (Admin only)
 */
router.get("/revenue", getRevenueStats);

// ============================================
// ADMIN ANALYTICS ROUTES
// All routes require authentication (global auth middleware)
// Only admin (roleId: 3) can access these routes
// ============================================

/**
 * @route   GET /admin/analytics/revenue
 * @desc    Get revenue & bookings analytics with chart data
 * @query   period - 7d|30d|6m|12m|all (default: 30d)
 * @access  Private (Admin only)
 */
router.get("/analytics/revenue", getRevenueAnalytics);

/**
 * @route   GET /admin/analytics/categories
 * @desc    Get category performance analytics
 * @query   period - 7d|30d|6m|12m|all (default: 30d)
 * @access  Private (Admin only)
 */
router.get("/analytics/categories", getCategoryAnalytics);

/**
 * @route   GET /admin/analytics/status
 * @desc    Get booking status breakdown analytics
 * @query   period - 7d|30d|6m|12m|all (default: 30d)
 * @access  Private (Admin only)
 */
router.get("/analytics/status", getStatusAnalytics);

/**
 * @route   GET /admin/analytics/providers
 * @desc    Get top providers by platform fee contribution
 * @query   period - 7d|30d|6m|12m|all (default: 30d)
 * @access  Private (Admin only)
 */
router.get("/analytics/providers", getTopProvidersAnalytics);

/**
 * @route   GET /admin/analytics/payment-status
 * @desc    Get payment status breakdown (paid, pending, failed)
 * @query   period - 7d|30d|6m|12m|all (default: 30d)
 * @access  Private (Admin only)
 */
router.get("/analytics/payment-status", getPaymentStatusAnalytics);

/**
 * @route   GET /admin/analytics/average-order-value
 * @desc    Get average order value trend over time
 * @query   period - 7d|30d|6m|12m|all (default: 30d)
 * @access  Private (Admin only)
 */
router.get("/analytics/average-order-value", getAverageOrderValueAnalytics);

/**
 * @route   GET /check-payment-details
 * @desc    Check if admin has payment details (system health check)
 * @access  Private (Admin only)
 */
router.get("/check-payment-details", checkAdminPaymentDetails);

/**
 * @route   GET /provider/revenue
 * @desc    Get provider's earnings/revenue statistics
 * @access  Private (Provider only)
 */
router.get("/provider/revenue", authorizeRole(PROVIDER), getProviderRevenueStats);

// ============================================
// PAYOUT MANAGEMENT ROUTES
// All routes require admin access
// ============================================

/**
 * @route   GET /admin/payouts
 * @desc    Get all payouts with optional filters
 * @query   status - Filter by status: pending|paid|all (default: all)
 * @query   providerId - Filter by provider ID
 * @access  Private (Admin only)
 */
router.get("/payouts", getPayouts);

/**
 * @route   GET /admin/payouts/summary
 * @desc    Get payout summary for admin dashboard
 * @access  Private (Admin only)
 */
router.get("/payouts/summary", getPayoutsSummary);

/**
 * @route   PUT /admin/payouts/:id/mark-paid
 * @desc    Mark a single payout as paid
 * @access  Private (Admin only)
 */
router.put("/payouts/:id/mark-paid", markPayoutAsPaid);

/**
 * @route   PUT /admin/payouts/process-bulk
 * @desc    Bulk process multiple payouts as paid
 * @access  Private (Admin only)
 */
router.put("/payouts/process-bulk", bulkProcessPayouts);

/**
 * @route   GET /admin/payouts/by-provider
 * @desc    Get payouts grouped by provider (provider-level payouts)
 * @access  Private (Admin only)
 */
router.get("/payouts/by-provider", getPayoutsByProvider);

/**
 * @route   PUT /admin/payouts/provider/:providerId/pay-all
 * @desc    Pay all pending payouts for a specific provider
 * @access  Private (Admin only)
 */
router.put("/payouts/provider/:providerId/pay-all", payProvider);

module.exports = router;
