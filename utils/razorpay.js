const Razorpay = require("razorpay");
const crypto = require("crypto");

/**
 * Initialize Razorpay instance with credentials from environment variables
 */
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create a Razorpay order
 * @param {number} amount - Amount in paise (₹500 = 50000 paise)
 * @param {string} receipt - Receipt ID (usually booking ID)
 * @param {object} notes - Additional notes to attach to order
 * @returns {Promise<object>} Razorpay order details
 */
const createRazorpayOrder = async (amount, receipt, notes = {}) => {
  try {
    const options = {
      amount: amount, // Amount in paise
      currency: "INR",
      receipt: receipt,
      notes: notes,
      payment_capture: 1, // Auto-capture payment
      // Note: timeout parameter is not supported in all Razorpay API versions
      // Orders are valid for a default period (usually 24 hours)
    };

    const order = await razorpay.orders.create(options);
    return order;
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    throw new Error(`Failed to create Razorpay order: ${error.message}`);
  }
};

/**
 * Verify Razorpay payment signature
 * Uses HMAC SHA256 to verify the signature sent by Razorpay
 * @param {string} orderId - Razorpay order ID
 * @param {string} paymentId - Razorpay payment ID
 * @param {string} signature - Razorpay signature
 * @returns {boolean} True if signature is valid
 */
const verifySignature = (orderId, paymentId, signature) => {
  try {
    const secret = process.env.RAZORPAY_KEY_SECRET;

    // Create the expected signature
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(`${orderId}|${paymentId}`);
    const expectedSignature = hmac.digest("hex");

    // Compare with received signature
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature)
    );
  } catch (error) {
    console.error("Error verifying signature:", error);
    return false;
  }
};

/**
 * Initiate refund for a payment
 * @param {string} paymentId - Razorpay payment ID to refund
 * @param {number} amount - Amount to refund in paise (optional, full refund if not provided)
 * @param {string} reason - Reason for the refund
 * @returns {Promise<object>} Refund details
 */
const initiateRefund = async (paymentId, amount = null, reason = "Refund") => {
  try {
    const options = {};

    // For partial refunds, add amount
    // For full refunds, omit amount (Razorpay refunds entire captured amount)
    if (amount !== null) {
      options.amount = amount;
    }

    const refund = await razorpay.payments.refund(paymentId, options);
    return refund;
  } catch (error) {
    console.error("Error initiating refund:", error);
    throw new Error(`Failed to initiate refund: ${error.message}`);
  }
};

/**
 * Capture a payment that is in authorized state
 * @param {string} paymentId - Razorpay payment ID to capture
 * @param {number} amount - Amount to capture in paise
 * @returns {Promise<object>} Captured payment details
 */
const capturePayment = async (paymentId, amount) => {
  try {
    const captured = await razorpay.payments.capture(paymentId, amount, {
      currency: "INR",
    });
    console.log("✅ Payment captured:", captured.id);
    return captured;
  } catch (error) {
    console.error("Error capturing payment:", error);
    throw new Error(`Failed to capture payment: ${error.message}`);
  }
};

/**
 * Verify Razorpay webhook signature
 * @param {string} body - Raw request body (string)
 * @param {string} signature - X-Razorpay-Signature header value
 * @returns {boolean} True if webhook signature is valid
 */
const verifyWebhookSignature = (body, signature) => {
  try {
    const secret = process.env.RAZORPAY_KEY_SECRET;

    // Verify webhook signature using HMAC SHA256
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature)
    );
  } catch (error) {
    console.error("Error verifying webhook signature:", error);
    return false;
  }
};

/**
 * Fetch payment details from Razorpay
 * @param {string} paymentId - Razorpay payment ID
 * @returns {Promise<object>} Payment details from Razorpay
 */
const fetchPaymentDetails = async (paymentId) => {
  try {
    const payment = await razorpay.payments.fetch(paymentId);
    return payment;
  } catch (error) {
    console.error("Error fetching payment details:", error);
    throw new Error(`Failed to fetch payment details: ${error.message}`);
  }
};

/**
 * Fetch order details from Razorpay
 * @param {string} orderId - Razorpay order ID
 * @returns {Promise<object>} Order details from Razorpay
 */
const fetchOrderDetails = async (orderId) => {
  try {
    const order = await razorpay.orders.fetch(orderId);
    return order;
  } catch (error) {
    console.error("Error fetching order details:", error);
    throw new Error(`Failed to fetch order details: ${error.message}`);
  }
};

/**
 * Convert amount from rupees to paise
 * @param {number} rupees - Amount in rupees
 * @returns {number} Amount in paise
 */
const rupeesToPaise = (rupees) => {
  return Math.round(rupees * 100);
};

/**
 * Convert amount from paise to rupees
 * @param {number} paise - Amount in paise
 * @returns {number} Amount in rupees
 */
const paiseToRupees = (paise) => {
  return paise / 100;
};

module.exports = {
  razorpay,
  createRazorpayOrder,
  verifySignature,
  initiateRefund,
  capturePayment,
  verifyWebhookSignature,
  fetchPaymentDetails,
  fetchOrderDetails,
  rupeesToPaise,
  paiseToRupees,
};
