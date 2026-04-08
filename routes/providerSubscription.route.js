const express = require("express");
const router = express.Router();
const {
  getCurrentSubscription,
  purchaseSubscription,
  purchaseSubscriptionWithRazorpay,
  purchaseSubscriptionWithLink,
  cancelSubscription,
  toggleAutoRenew,
  upgradeSubscription,
  getPaymentHistory,
  getAllProviderSubscriptions,
  handleWebhook,
  authorizeSubscription,
  cancelPendingSubscription,
  cleanupAbandonedSubscriptions,
} = require("../controllers/providerSubscription.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { ADMIN, PROVIDER } = require("../config/roles");

// Provider subscription routes
router.get("/current", getCurrentSubscription);
router.post("/purchase", purchaseSubscription);
// NEW: Razorpay Subscription API (auto-recurring)
router.post("/purchase-razorpay", purchaseSubscriptionWithRazorpay);
// NEW: Razorpay Subscription Links API (hosted page)
router.post("/purchase-link", purchaseSubscriptionWithLink);
// Get subscription details for checkout authorization
router.post("/authorize", authorizeSubscription);
// Cancel pending subscription (when modal closed without payment)
router.post("/cancel-pending", cancelPendingSubscription);
// Cleanup abandoned subscriptions (called on page load)
router.get("/cleanup", cleanupAbandonedSubscriptions);
router.post("/cancel", cancelSubscription);
router.post("/toggle-auto-renew", toggleAutoRenew);
router.put("/upgrade", upgradeSubscription);
router.get("/payments", getPaymentHistory);

// Admin: Get all provider subscriptions
router.get("/providers", authorizeRole(ADMIN), getAllProviderSubscriptions);

// Webhook endpoint (public, verified by Razorpay signature)
router.post("/webhook", handleWebhook);

// TEST ENDPOINT: Simulate webhook for development (remove in production)
// This bypasses signature verification for testing
router.post("/webhook/test", (req, res) => {
  console.log("🧪 TEST WEBHOOK: Simulating payment_link.paid event");

  // Simulate Razorpay webhook payload
  const mockWebhookEvent = {
    event: "payment_link.paid",
    payload: {
      payment: {
        entity: {
          id: `pay_test_${Date.now()}`,
          amount: req.body.amount || 50000,
          currency: "INR",
          status: "captured",
          notes: req.body.notes || {
            provider_id: "3",
            plan_id: "3",
            billing_cycle: "monthly",
            type: "subscription_first_payment",
            platform_fee: "5"
          }
        }
      }
    }
  };

  // Call the webhook handler directly
  handleWebhook({
    body: mockWebhookEvent,
    headers: {
      "x-razorpay-signature": "test_signature"
    }
  }, {
    json: (data) => res.json(data)
  }).catch((err) => {
    console.error("Test webhook error:", err);
    res.status(500).json({ error: err.message });
  });
});

// TEST ENDPOINT: Simulate subscription recurring payment
// POST /api/provider/subscription/test/recurring-charge
// This simulates the subscription.charged webhook event for testing
router.post("/test/recurring-charge", async (req, res) => {
  try {
    const { subscriptionId, amount } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ message: "subscriptionId is required" });
    }

    console.log("🧪 TEST: Simulating recurring charge for subscription:", subscriptionId);

    // Simulate Razorpay subscription.charged webhook payload
    const mockWebhookEvent = {
      event: "subscription.charged",
      payload: {
        subscription: {
          entity: {
            id: subscriptionId,
            status: "active",
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor(Date.now() / 1000) + 2592000, // +30 days
          }
        },
        payment: {
          entity: {
            id: `pay_test_recurring_${Date.now()}`,
            amount: amount || 20000, // Default ₹200
            currency: "INR",
            status: "captured",
            method: "upi",
          }
        }
      }
    };

    // Call the webhook handler directly
    await handleWebhook({
      body: mockWebhookEvent,
      headers: {
        "x-razorpay-signature": "test_signature"
      }
    }, {
      json: (data) => res.json(data)
    });

    res.json({
      message: "Recurring charge simulated successfully",
      testPaymentId: mockWebhookEvent.payload.payment.entity.id,
    });
  } catch (error) {
    console.error("Test recurring charge error:", error);
    res.status(500).json({ error: error.message });
  }
});

// TEST ENDPOINT: Simulate subscription authorization
// POST /api/provider/subscription/test/authorize
// This simulates the subscription.authorized webhook event
router.post("/test/authorize", async (req, res) => {
  try {
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ message: "subscriptionId is required" });
    }

    console.log("🧪 TEST: Simulating subscription authorization:", subscriptionId);

    // Simulate Razorpay subscription.authorized webhook payload
    const mockWebhookEvent = {
      event: "subscription.authorized",
      payload: {
        subscription: {
          entity: {
            id: subscriptionId,
            status: "authenticated",
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor(Date.now() / 1000) + 2592000,
          }
        }
      }
    };

    // Call the webhook handler directly
    await handleWebhook({
      body: mockWebhookEvent,
      headers: {
        "x-razorpay-signature": "test_signature"
      }
    }, {
      json: (data) => res.json(data)
    });

    res.json({
      message: "Subscription authorization simulated successfully",
    });
  } catch (error) {
    console.error("Test authorization error:", error);
    res.status(500).json({ error: error.message });
  }
});

// DEBUG: Check local subscriptions
router.get("/debug", async (req, res) => {
  try {
    const { db } = require("../config/db");
    const { providerSubscriptions } = require("../models/schema");
    const { desc } = require("drizzle-orm");

    const subs = await db
      .select()
      .from(providerSubscriptions)
      .orderBy(desc(providerSubscriptions.createdAt))
      .limit(5);

    res.json({
      message: "Recent subscriptions",
      data: subs.map(s => ({
        id: s.id,
        providerId: s.providerId,
        planId: s.planId,
        status: s.status,
        razorpaySubscriptionId: s.razorpaySubscriptionId,
        razorpayPlanId: s.razorpayPlanId,
        startDate: s.startDate,
        endDate: s.endDate,
        autoRenew: s.autoRenew,
        createdAt: s.createdAt,
      })),
    });
  } catch (error) {
    console.error("Debug endpoint error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
