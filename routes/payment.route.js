const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/payment.controller");

// LOG ALL INCOMING REQUESTS TO THIS ROUTER
router.use((req, res, next) => {
  console.log('🔥🔥🔥 PAYMENT ROUTE HIT:', req.method, req.path);
  next();
});

/**
 * Payment Routes
 * Base path: /payment
 *
 * All routes are protected by global auth middleware
 */

/**
 * POST /payment/create-order
 * Create a new payment order for booking
 * Protected: Customer only
 */
router.post("/create-order", paymentController.createPaymentOrder);

/**
 * POST /payment/verify
 * Verify payment after successful Razorpay transaction
 * Protected: Customer only
 */
router.post("/verify", paymentController.verifyPayment);

/**
 * POST /payment/failed
 * Record failed payment attempt
 * Protected: Customer only
 */
router.post("/failed", paymentController.recordFailedPayment);

/**
 * POST /payment/cancel-intent
 * Cancel payment intent (releases slot lock)
 * Protected: Customer only (must own the payment intent)
 */
router.post("/cancel-intent", paymentController.cancelPaymentIntent);

/**
 * GET /payment/booking/:id
 * Get payment details by booking ID
 * Protected: Customer or Provider of the booking
 */
router.get("/booking/:id", paymentController.getPaymentByBookingId);

/**
 * GET /payment/:id
 * Get payment by ID
 * Protected: Owner, Admin, or Provider
 */
router.get("/:id", paymentController.getPaymentById);

/**
 * POST /payment/refund/:id
 * Process refund for a payment
 * Protected: Admin only
 */
router.post("/refund/:id", paymentController.processRefund);

/**
 * POST /payment/webhook
 * Handle Razorpay webhook events
 * Public: Razorpay sends webhooks without auth
 * Note: Signature verification is done in controller
 */
router.post("/webhook", paymentController.handleWebhook);

/**
 * GET /payment/slot-lock-status
 * DEBUG: Check if a slot is currently locked
 * Protected: All authenticated users
 * Query params: slotId, bookingDate
 *
 * Example: GET /payment/slot-lock-status?slotId=123&bookingDate=2026-03-05
 */
router.get("/slot-lock-status", paymentController.getSlotLockStatus);

/**
 * POST /payment/validate-intent
 * CRITICAL: Validate payment intent before opening Razorpay
 * Prevents opening Razorpay if:
 * - Intent has expired
 * - Intent was cancelled/completed
 * - Slot has been booked by someone else
 * - Another intent exists for the same slot
 *
 * This is called BEFORE opening Razorpay checkout
 * Protected: Customer only (must own the payment intent)
 */
router.post("/validate-intent", paymentController.validatePaymentIntent);

module.exports = router;
