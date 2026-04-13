const express = require("express");
const router = express.Router();
const {
  getCurrentSubscription,
  purchaseSubscriptionWithLink,
  cancelSubscription,
  toggleAutoRenew,
  upgradeSubscription,
  getPaymentHistory,
  getAllProviderSubscriptions,
  authorizeSubscription,
  cancelPendingSubscription,
  cleanupAbandonedSubscriptions,
  startTrial,
} = require("../controllers/providerSubscription.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { ADMIN, PROVIDER } = require("../config/roles");

// Provider subscription routes
router.get("/current", getCurrentSubscription);
// Razorpay Subscription Links API (hosted page)
router.post("/purchase-link", purchaseSubscriptionWithLink);
// Get subscription details for checkout authorization
router.post("/authorize", authorizeSubscription);
// Cancel pending subscription (when modal closed without payment)
router.post("/cancel-pending", cancelPendingSubscription);
// Cleanup abandoned subscriptions (called on page load)
router.get("/cleanup", cleanupAbandonedSubscriptions);
// Start free trial (database-level trial, no Razorpay)
router.post("/start-trial", startTrial);
router.post("/cancel", cancelSubscription);
router.post("/toggle-auto-renew", toggleAutoRenew);
router.put("/upgrade", upgradeSubscription);
router.get("/payments", getPaymentHistory);

// Admin: Get all provider subscriptions
router.get("/providers", authorizeRole(ADMIN), getAllProviderSubscriptions);

module.exports = router;
