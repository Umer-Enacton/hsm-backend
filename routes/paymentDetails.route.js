const express = require("express");
const router = express.Router();
const {
  savePaymentDetails,
  getPaymentDetails,
  setActivePaymentMethod,
  deletePaymentDetails,
} = require("../controllers/paymentDetails.controller");

// ============================================
// PAYMENT DETAILS ROUTES
// Router is mounted at /payment-details in index.js
// All routes require authentication (global auth middleware)
// ============================================

/**
 * @route   POST /
 * @desc    Save payment details (UPI or Bank) for admin or provider
 * @access  Private (Admin, Provider)
 */
router.post("/", savePaymentDetails);

/**
 * @route   GET /
 * @desc    Get user's payment details
 * @access  Private (Admin, Provider)
 */
router.get("/", getPaymentDetails);

/**
 * @route   PUT /:id/set-active
 * @desc    Set a payment method as active
 * @access  Private (Admin, Provider)
 */
router.put("/:id/set-active", setActivePaymentMethod);

/**
 * @route   DELETE /:id
 * @desc    Delete payment details
 * @access  Private (Admin, Provider)
 */
router.delete("/:id", deletePaymentDetails);

// Note: /admin/check-payment-details route is in admin.route.js

module.exports = router;
