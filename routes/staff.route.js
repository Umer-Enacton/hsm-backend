const express = require("express");
const router = express.Router();
const {
  addStaff,
  getProviderStaff,
  getStaffById,
  getStaffMe,
  updateStaff,
  updateStaffStatus,
  deleteStaff,
  getAvailableStaff,
  getStaffPaymentDetails,
  saveStaffPaymentDetails,
} = require("../controllers/staff.controller");

// Staff routes - Protected by auth middleware

/**
 * @route   POST /api/staff
 * @desc    Add new staff member (Provider only)
 * @access  Private (Provider)
 */
router.post("/", addStaff);

/**
 * @route   GET /api/staff
 * @desc    Get all staff for a provider (Provider only)
 * @access  Private (Provider)
 */
router.get("/", getProviderStaff);

/**
 * @route   GET /api/staff/me
 * @desc    Get current staff member's profile (Staff only)
 * @access  Private (Staff)
 */
router.get("/me", getStaffMe);

/**
 * @route   GET /api/staff/available
 * @desc    Get available staff for a booking slot (Provider only)
 * @access  Private (Provider)
 */
router.get("/available", getAvailableStaff);

/**
 * @route   GET /api/staff/payment-details
 * @desc    Get staff member's payment details (Staff only)
 * @access  Private (Staff)
 */
router.get("/payment-details", getStaffPaymentDetails);

/**
 * @route   POST /api/staff/payment-details
 * @desc    Save/update staff member's payment details (Staff only)
 * @access  Private (Staff)
 */
router.post("/payment-details", saveStaffPaymentDetails);

/**
 * @route   GET /api/staff/:id
 * @desc    Get single staff details
 * @access  Private (Staff can view own, Provider can view their staff)
 */
router.get("/:id", getStaffById);

/**
 * @route   PUT /api/staff/:id
 * @desc    Update staff details (Provider only)
 * @access  Private (Provider)
 */
router.put("/:id", updateStaff);

/**
 * @route   PATCH /api/staff/:id/status
 * @desc    Update staff status (Provider only)
 * @access  Private (Provider)
 */
router.patch("/:id/status", updateStaffStatus);

/**
 * @route   DELETE /api/staff/:id
 * @desc    Delete/remove staff (Provider only)
 * @access  Private (Provider)
 */
router.delete("/:id", deleteStaff);

module.exports = router;
