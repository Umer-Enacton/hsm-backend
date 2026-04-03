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
  // Check if Razorpay is properly configured
  if (!razorpay || !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.warn("⚠️ Razorpay not configured, returning mock order");

    // Return a mock order for development
    return {
      id: `mock_order_${Date.now()}`,
      amount,
      currency: "INR",
      receipt,
      notes: {
        ...notes,
        mock_order: "true",
      },
      entity: "order",
      status: "created",
    };
  }

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
    throw new Error(`Failed to create Razorpay order: ${error.message || "Unknown error"}`);
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

    // Check if Razorpay is properly configured
    if (!razorpay || !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.warn("⚠️ Razorpay not configured, returning mock refund");

      // Return a mock refund
      return {
        id: `mock_refund_${Date.now()}`,
        amount: options.amount || "Full Refund",
        currency: "INR",
        payment_id: paymentId,
        notes: {
          mock_refund: "true",
          reason: reason
        },
        entity: "refund",
        status: "processed",
        created_at: Math.floor(Date.now() / 1000)
      };
    }

    const refund = await razorpay.payments.refund(paymentId, options);
    return refund;
  } catch (error) {
    console.error("Error initiating refund:", error);
    
    // Extract meaningful error message from Razorpay error object
    const errorMessage = error.message || 
                        (error.error && error.error.description) || 
                        error.description || 
                        "Unknown Razorpay error";
                        
    throw new Error(`Failed to initiate refund: ${errorMessage}`);
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
  // Check if this is a mock order (development mode)
  if (orderId.startsWith("mock_order_")) {
    console.warn("⚠️ Mock order detected, returning mock details");
    return {
      id: orderId,
      amount: 0,
      currency: "INR",
      receipt: "mock_receipt",
      notes: {
        mock_order: "true",
      },
      entity: "order",
      status: "created",
    };
  }

  // Check if Razorpay is properly configured
  if (!razorpay || !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.warn("⚠️ Razorpay not configured, returning mock order details");
    return {
      id: orderId,
      amount: 0,
      currency: "INR",
      receipt: "mock_receipt",
      notes: {
        mock_order: "true",
      },
      entity: "order",
      status: "created",
    };
  }

  try {
    const order = await razorpay.orders.fetch(orderId);
    return order;
  } catch (error) {
    console.error("Error fetching order details:", error);
    throw new Error(`Failed to fetch order details: ${error.message || "Unknown error"}`);
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

// ============================================
// SPLIT PAYMENT & FUND ACCOUNT FUNCTIONS
// ============================================

/**
 * Create a Razorpay contact (required for fund accounts)
 * @param {string} name - Contact name
 * @param {string} email - Contact email
 * @param {string} phone - Contact phone (with country code, e.g., +919876543210)
 * @returns {Promise<object>} Razorpay contact details
 */
const createContact = async (name, email, phone) => {
  try {
    if (!razorpay || !razorpay.contacts) {
      console.warn("⚠️ Razorpay not configured, skipping contact creation");
      return { id: "mock_contact_id" };
    }
    const contact = await razorpay.contacts.create({
      name,
      email,
      contact: phone,
      type: "customer",
    });
    console.log("✅ Razorpay contact created:", contact.id);
    return contact;
  } catch (error) {
    console.error("Error creating Razorpay contact:", error);
    // For development without Razorpay keys, return mock data
    if (error.message?.includes("key_id") || error.message?.includes("credentials")) {
      console.warn("⚠️ Razorpay credentials not configured, using mock data");
      return { id: "mock_contact_id" };
    }
    throw new Error(`Failed to create Razorpay contact: ${error.message}`);
  }
};

/**
 * Create a Razorpay UPI fund account
 * @param {string} upiId - UPI ID (e.g., merchant@upi)
 * @param {string} contactId - Razorpay contact ID
 * @returns {Promise<object>} Razorpay fund account details
 */
const createUPIFundAccount = async (upiId, contactId) => {
  try {
    if (!razorpay || !razorpay.fundAccounts) {
      console.warn("⚠️ Razorpay not configured, skipping fund account creation");
      return { id: "mock_fund_account_id" };
    }
    const fundAccount = await razorpay.fundAccounts.create({
      contact_id: contactId,
      account_type: "upi",
      upi: {
        address: upiId,
      },
    });
    console.log("✅ Razorpay UPI fund account created:", fundAccount.id);
    return fundAccount;
  } catch (error) {
    console.error("Error creating UPI fund account:", error);
    // For development without Razorpay keys, return mock data
    if (error.message?.includes("key_id") || error.message?.includes("credentials")) {
      console.warn("⚠️ Razorpay credentials not configured, using mock data");
      return { id: "mock_fund_account_id" };
    }
    throw new Error(`Failed to create UPI fund account: ${error.message}`);
  }
};

/**
 * Create a Razorpay bank account fund account
 * @param {string} bankAccount - Bank account number
 * @param {string} ifscCode - IFSC code
 * @param {string} accountHolderName - Account holder name
 * @param {string} contactId - Razorpay contact ID
 * @returns {Promise<object>} Razorpay fund account details
 */
const createBankFundAccount = async (bankAccount, ifscCode, accountHolderName, contactId) => {
  try {
    if (!razorpay || !razorpay.fundAccounts) {
      console.warn("⚠️ Razorpay not configured, skipping fund account creation");
      return { id: "mock_fund_account_id" };
    }
    const fundAccount = await razorpay.fundAccounts.create({
      contact_id: contactId,
      account_type: "bank_account",
      bank_account: {
        name: accountHolderName,
        account_number: bankAccount,
        ifsc: ifscCode,
      },
    });
    console.log("✅ Razorpay bank fund account created:", fundAccount.id);
    return fundAccount;
  } catch (error) {
    console.error("Error creating bank fund account:", error);
    // For development without Razorpay keys, return mock data
    if (error.message?.includes("key_id") || error.message?.includes("credentials")) {
      console.warn("⚠️ Razorpay credentials not configured, using mock data");
      return { id: "mock_fund_account_id" };
    }
    throw new Error(`Failed to create bank fund account: ${error.message}`);
  }
};

/**
 * Create a Razorpay order with split transfers
 * Automatically splits payment between provider and admin
 * @param {number} amount - Total amount in paise
 * @param {string} receipt - Receipt ID (usually booking ID)
 * @param {string} providerFundAccountId - Razorpay fund account ID for provider
 * @param {string} adminFundAccountId - Razorpay fund account ID for admin
 * @param {number} platformFeePercentage - Platform fee percentage (default 5%)
 * @param {object} notes - Additional notes
 * @returns {Promise<object>} Razorpay order details with transfers
 */
const createSplitOrder = async (
  amount,
  receipt,
  providerFundAccountId,
  adminFundAccountId,
  platformFeePercentage = 5,
  notes = {}
) => {
  // Check if Razorpay is properly configured
  if (!razorpay || !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.warn("⚠️ Razorpay not configured, returning mock order");

    // Return a mock order for development
    return {
      id: `mock_order_${Date.now()}`,
      amount,
      currency: "INR",
      receipt,
      notes: {
        ...notes,
        mock_order: "true",
        split_payment_skipped: "Razorpay not configured",
      },
      entity: "order",
      status: "created",
    };
  }

  try {
    // Check if using mock fund account IDs (development mode)
    const isMockId = (id) => !id || id === "mock_fund_account_id" || id.startsWith("mock_");

    if (isMockId(providerFundAccountId) || isMockId(adminFundAccountId)) {
      console.warn("⚠️ Mock fund account IDs detected, falling back to regular order");
      console.warn("   Split payments require valid Razorpay fund accounts");

      // Fall back to regular order without split
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt,
        payment_capture: 1,
        notes: {
          ...notes,
          split_payment_skipped: "true",
          provider_amount: Math.floor(amount * (1 - platformFeePercentage / 100)),
          platform_amount: Math.floor(amount * (platformFeePercentage / 100)),
          platform_fee_percentage: platformFeePercentage,
        },
      });

      console.log("✅ Regular order created (split skipped):", order.id);
      return order;
    }

    // Calculate split amounts
    const providerAmount = Math.floor(amount * (1 - platformFeePercentage / 100));
    const adminAmount = amount - providerAmount;

    console.log(`💰 Creating split order: ₹${amount / 100} total`);
    console.log(`   Provider gets: ₹${providerAmount / 100} (${100 - platformFeePercentage}%)`);
    console.log(`   Platform gets: ₹${adminAmount / 100} (${platformFeePercentage}%)`);

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt,
      payment_capture: 1,
      transfers: [
        {
          account: providerFundAccountId,
          amount: providerAmount,
          currency: "INR",
          notes: { ...notes, type: "provider_share" },
        },
        {
          account: adminFundAccountId,
          amount: adminAmount,
          currency: "INR",
          notes: { ...notes, type: "platform_fee" },
        },
      ],
    });

    console.log("✅ Split order created:", order.id);
    return order;
  } catch (error) {
    console.error("Error creating split order:", error);

    // If split order fails, fall back to regular order
    console.warn("⚠️ Split order failed, falling back to regular order");

    try {
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt,
        payment_capture: 1,
        notes: {
          ...notes,
          split_payment_failed: "true",
          error_message: error.message || "Unknown error",
          provider_amount: Math.floor(amount * (1 - platformFeePercentage / 100)),
          platform_amount: Math.floor(amount * (platformFeePercentage / 100)),
          platform_fee_percentage: platformFeePercentage,
        },
      });

      console.log("✅ Fallback regular order created:", order.id);
      return order;
    } catch (fallbackError) {
      console.error("Fallback order creation also failed:", fallbackError);
      throw new Error(`Failed to create order: ${fallbackError.message || error.message || "Unknown error"}`);
    }
  }
};

/**
 * Create a payout to a fund account
 * @param {string} fundAccountId - Razorpay fund account ID
 * @param {number} amount - Amount to payout in paise
 * @param {string} referenceId - Reference ID for tracking
 * @param {string} description - Description of the payout
 * @returns {Promise<object>} Razorpay payout details
 */
const createPayout = async (fundAccountId, amount, referenceId, description) => {
  try {
    const payout = await razorpay.payouts.create({
      account_id: fundAccountId,
      amount,
      currency: "INR",
      reference_id: referenceId,
      description,
      mode: "IMPS", // Immediate Payment Service
      purpose: "payout",
    });
    console.log("✅ Payout created:", payout.id);
    return payout;
  } catch (error) {
    console.error("Error creating payout:", error);
    throw new Error(`Failed to create payout: ${error.message}`);
  }
};

/**
 * Fetch payout details from Razorpay
 * @param {string} payoutId - Razorpay payout ID
 * @returns {Promise<object>} Payout details
 */
const fetchPayoutDetails = async (payoutId) => {
  try {
    const payout = await razorpay.payouts.fetch(payoutId);
    return payout;
  } catch (error) {
    console.error("Error fetching payout details:", error);
    throw new Error(`Failed to fetch payout details: ${error.message}`);
  }
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
  // New split payment functions
  createContact,
  createUPIFundAccount,
  createBankFundAccount,
  createSplitOrder,
  createPayout,
  fetchPayoutDetails,
};
