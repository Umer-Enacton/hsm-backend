const express = require("express");
const router = express.Router();
const {
  getStaffEarnings,
  getStaffPayouts,
  getBusinessStaffEarnings,
  getPayoutSummary,
  processPayout,
  getProviderStaffPayoutSummary,
  processProviderStaffPayout,
} = require("../controllers/staffPayout.controller");

/**
 * @route   GET /api/staff-payouts/my-earnings
 * @desc    Get my earnings (Staff only)
 * @access  Private (Staff)
 */
router.get("/my-earnings", getStaffEarnings);

/**
 * @route   GET /api/staff-payouts/my-payouts
 * @desc    Get my payout history (Staff only)
 * @access  Private (Staff)
 */
router.get("/my-payouts", getStaffPayouts);

/**
 * @route   GET /api/staff-payouts/business
 * @desc    Get all staff earnings for a business (Provider only)
 * @access  Private (Provider)
 */
router.get("/business", getBusinessStaffEarnings);

/**
 * @route   GET /api/staff-payouts/summary
 * @desc    Get payout summary for processing (Provider only)
 * @access  Private (Provider)
 */
router.get("/summary", getPayoutSummary);

/**
 * @route   POST /api/staff-payouts/process
 * @desc    Process payouts to staff (Provider only)
 * @access  Private (Provider)
 */
router.post("/process", processPayout);

/**
 * @route   GET /api/staff-payouts/provider-summary
 * @desc    Get staff payout summary for provider (Provider only)
 * @access  Private (Provider)
 */
router.get("/provider-summary", getProviderStaffPayoutSummary);

/**
 * @route   POST /api/staff-payouts/provider-process
 * @desc    Process staff payout - manual mark as paid (Provider only)
 * @access  Private (Provider)
 */
router.post("/provider-process", processProviderStaffPayout);

module.exports = router;
