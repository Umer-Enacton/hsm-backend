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
 * @param {string} customerId - Optional Razorpay customer ID to link to order
 * @returns {Promise<object>} Razorpay order details
 */
const createRazorpayOrder = async (
  amount,
  receipt,
  notes = {},
  customerId = null,
) => {
  // Check if Razorpay is properly configured
  if (
    !razorpay ||
    !process.env.RAZORPAY_KEY_ID ||
    !process.env.RAZORPAY_KEY_SECRET
  ) {
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

    // Add customer_id if provided (links payment to customer in Razorpay dashboard)
    if (customerId) {
      options.customer_id = customerId;
    }

    const order = await razorpay.orders.create(options);
    return order;
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    throw new Error(
      `Failed to create Razorpay order: ${error.message || "Unknown error"}`,
    );
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
      Buffer.from(signature),
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
    if (
      !razorpay ||
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      console.warn("⚠️ Razorpay not configured, returning mock refund");

      // Return a mock refund
      return {
        id: `mock_refund_${Date.now()}`,
        amount: options.amount || "Full Refund",
        currency: "INR",
        payment_id: paymentId,
        notes: {
          mock_refund: "true",
          reason: reason,
        },
        entity: "refund",
        status: "processed",
        created_at: Math.floor(Date.now() / 1000),
      };
    }

    const refund = await razorpay.payments.refund(paymentId, options);
    return refund;
  } catch (error) {
    console.error("Error initiating refund:", error);

    // Extract meaningful error message from Razorpay error object
    const errorMessage =
      error.message ||
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
    // Use webhook secret for signature verification (different from key secret)
    const secret =
      process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;

    if (!secret) {
      console.error("❌ No RAZORPAY_WEBHOOK_SECRET found in environment");
      return false;
    }

    // Verify webhook signature using HMAC SHA256
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature),
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
  if (
    !razorpay ||
    !process.env.RAZORPAY_KEY_ID ||
    !process.env.RAZORPAY_KEY_SECRET
  ) {
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
    throw new Error(
      `Failed to fetch order details: ${error.message || "Unknown error"}`,
    );
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
    if (
      error.message?.includes("key_id") ||
      error.message?.includes("credentials")
    ) {
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
      console.warn(
        "⚠️ Razorpay not configured, skipping fund account creation",
      );
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
    if (
      error.message?.includes("key_id") ||
      error.message?.includes("credentials")
    ) {
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
const createBankFundAccount = async (
  bankAccount,
  ifscCode,
  accountHolderName,
  contactId,
) => {
  try {
    if (!razorpay || !razorpay.fundAccounts) {
      console.warn(
        "⚠️ Razorpay not configured, skipping fund account creation",
      );
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
    if (
      error.message?.includes("key_id") ||
      error.message?.includes("credentials")
    ) {
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
 * @param {string} customerId - Optional Razorpay customer ID to link to order
 * @returns {Promise<object>} Razorpay order details with transfers
 */
const createSplitOrder = async (
  amount,
  receipt,
  providerFundAccountId,
  adminFundAccountId,
  platformFeePercentage = 5,
  notes = {},
  customerId = null,
) => {
  // Check if Razorpay is properly configured
  if (
    !razorpay ||
    !process.env.RAZORPAY_KEY_ID ||
    !process.env.RAZORPAY_KEY_SECRET
  ) {
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
    const isMockId = (id) =>
      !id || id === "mock_fund_account_id" || id.startsWith("mock_");

    if (isMockId(providerFundAccountId) || isMockId(adminFundAccountId)) {
      console.warn(
        "⚠️ Mock fund account IDs detected, falling back to regular order",
      );
      console.warn("   Split payments require valid Razorpay fund accounts");

      // Fall back to regular order without split
      const orderPayload = {
        amount,
        currency: "INR",
        receipt,
        payment_capture: 1,
        notes: {
          ...notes,
          split_payment_skipped: "true",
          provider_amount: Math.floor(
            amount * (1 - platformFeePercentage / 100),
          ),
          platform_amount: Math.floor(amount * (platformFeePercentage / 100)),
          platform_fee_percentage: platformFeePercentage,
        },
      };

      // Add customer_id if provided (links payment to customer in Razorpay dashboard)
      if (customerId) {
        orderPayload.customer_id = customerId;
      }

      const order = await razorpay.orders.create(orderPayload);

      console.log("✅ Regular order created (split skipped):", order.id);
      return order;
    }

    // Calculate split amounts
    const providerAmount = Math.floor(
      amount * (1 - platformFeePercentage / 100),
    );
    const adminAmount = amount - providerAmount;

    console.log(`💰 Creating split order: ₹${amount / 100} total`);
    console.log(
      `   Provider gets: ₹${providerAmount / 100} (${100 - platformFeePercentage}%)`,
    );
    console.log(
      `   Platform gets: ₹${adminAmount / 100} (${platformFeePercentage}%)`,
    );

    const orderPayload = {
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
    };

    // Add customer_id if provided (links payment to customer in Razorpay dashboard)
    if (customerId) {
      orderPayload.customer_id = customerId;
    }

    const order = await razorpay.orders.create(orderPayload);

    console.log("✅ Split order created:", order.id);
    return order;
  } catch (error) {
    console.error("Error creating split order:", error);

    // If split order fails, fall back to regular order
    console.warn("⚠️ Split order failed, falling back to regular order");

    try {
      const orderPayload = {
        amount,
        currency: "INR",
        receipt,
        payment_capture: 1,
        notes: {
          ...notes,
          split_payment_failed: "true",
          error_message: error.message || "Unknown error",
          provider_amount: Math.floor(
            amount * (1 - platformFeePercentage / 100),
          ),
          platform_amount: Math.floor(amount * (platformFeePercentage / 100)),
          platform_fee_percentage: platformFeePercentage,
        },
      };

      // Add customer_id if provided (links payment to customer in Razorpay dashboard)
      if (customerId) {
        orderPayload.customer_id = customerId;
      }

      const order = await razorpay.orders.create(orderPayload);

      console.log("✅ Fallback regular order created:", order.id);
      return order;
    } catch (fallbackError) {
      console.error("Fallback order creation also failed:", fallbackError);
      throw new Error(
        `Failed to create order: ${fallbackError.message || error.message || "Unknown error"}`,
      );
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
const createPayout = async (
  fundAccountId,
  amount,
  referenceId,
  description,
) => {
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

// ============================================
// SUBSCRIPTION PLAN FUNCTIONS
// ============================================

/**
 * Create a Razorpay plan for subscriptions
 * @param {string} name - Plan name (e.g., "Pro Plan - monthly")
 * @param {number} amount - Price in paise
 * @param {string} interval - Billing interval ("monthly" or "yearly")
 * @returns {Promise<object>} Razorpay plan details
 */
const createRazorpaySubscriptionPlan = async (name, amount, interval) => {
  try {
    if (
      !razorpay ||
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      console.warn("⚠️ Razorpay not configured, returning mock plan");
      return {
        id: `mock_plan_${Date.now()}`,
        item: {
          name: name,
          amount: amount,
          currency: "INR",
        },
        period: interval,
        interval: 1,
      };
    }

    const plan = await razorpay.plans.create({
      period: interval,
      interval: 1,
      item: {
        name: name,
        amount: amount,
        currency: "INR",
        description: `${name} subscription plan`,
      },
      notes: {
        plan_name: name,
        billing_cycle: interval,
      },
    });

    console.log("✅ Razorpay subscription plan created:", plan.id);
    return plan;
  } catch (error) {
    console.error("Error creating Razorpay subscription plan:", error);
    // For development without Razorpay keys, return mock data
    if (
      error.message?.includes("key_id") ||
      error.message?.includes("credentials")
    ) {
      console.warn("⚠️ Razorpay credentials not configured, using mock data");
      return {
        id: `mock_plan_${Date.now()}`,
        item: {
          name: name,
          amount: amount,
          currency: "INR",
        },
        period: interval,
        interval: 1,
      };
    }
    throw new Error(
      `Failed to create Razorpay subscription plan: ${error.message}`,
    );
  }
};

/**
 * Create a Razorpay subscription for a provider
 * @param {string} planId - Razorpay plan ID
 * @param {number} totalCount - Number of billing cycles (12 for yearly)
 * @param {object} options - Additional options
 * @param {string} options.customer_id - Razorpay customer ID (sets display name)
 * @param {object} options.notes - Additional notes
 * @returns {Promise<object>} Razorpay subscription details
 */
const createRazorpaySubscription = async (
  planId,
  totalCount = 12,
  options = {},
) => {
  const {
    customer_id,
    notes = {},
    amount = null,
    upfrontAmount = null,
  } = options;

  try {
    if (
      !razorpay ||
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      console.warn("⚠️ Razorpay not configured, returning mock subscription");
      return {
        id: `mock_sub_${Date.now()}`,
        plan_id: planId,
        customer_id: customer_id || `cust_mock_${Date.now()}`,
        status: "active",
        total_count: totalCount,
        notes: notes,
        short_url: null, // No checkout URL for mock
      };
    }

    const subscriptionPayload = {
      plan_id: planId,
      customer_notify: 1,
      quantity: 1,
      total_count: totalCount,
      start_at: Math.floor(Date.now() / 1000) + 300, // Add 5 minute buffer
      notes: notes,
    };

    // Add customer_id if provided (sets display name in checkout)
    if (customer_id) {
      subscriptionPayload.customer_id = customer_id;
    }

    // Add addon for upfront amount if provided (charges full amount immediately during authorization!)
    // This solves the ₹5-only issue - addon amount is charged RIGHT AWAY
    if (upfrontAmount) {
      subscriptionPayload.addons = [
        {
          item: {
            name: "First payment",
            amount: upfrontAmount,
            currency: "INR",
          },
        },
      ];
      console.log("💰 Adding addon for upfront charge:", upfrontAmount);
    }

    console.log(
      "📝 Creating Razorpay subscription with payload:",
      JSON.stringify(subscriptionPayload, null, 2),
    );
    const subscription =
      await razorpay.subscriptions.create(subscriptionPayload);

    console.log("✅ Razorpay subscription created:", {
      id: subscription.id,
      status: subscription.status,
      short_url: subscription.short_url,
      has_short_url: !!subscription.short_url,
      customer_id: subscription.customer_id,
      has_addons: !!subscriptionPayload.addons,
    });
    return subscription;
  } catch (error) {
    console.error("Error creating Razorpay subscription:", error);
    if (
      error.message?.includes("key_id") ||
      error.streams?.includes("credentials")
    ) {
      console.warn("⚠️ Razorpay credentials not configured, using mock data");
      return {
        id: `mock_sub_${Date.now()}`,
        plan_id: planId,
        customer_id: customer_id || `cust_mock_${Date.now()}`,
        status: "active",
        total_count: totalCount,
        notes: notes,
        short_url: null, // No checkout URL for mock
      };
    }
    throw new Error(`Failed to create Razorpay subscription: ${error.message}`);
  }
};

/**
 * Create or fetch a Razorpay customer for a provider
 * @param {object} customerDetails - Customer details
 * @param {string} customerDetails.name - Customer/Business name
 * @param {string} customerDetails.email - Customer email
 * @param {string} customerDetails.contact - Customer phone number
 * @returns {Promise<object>} Razorpay customer details
 */
const createRazorpayCustomer = async (customerDetails) => {
  try {
    if (
      !razorpay ||
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      console.warn("⚠️ Razorpay not configured, returning mock customer");
      return {
        id: `cust_mock_${Date.now()}`,
        name: customerDetails.name,
        email: customerDetails.email,
        contact: customerDetails.contact,
      };
    }

    const customer = await razorpay.customers.create({
      name: customerDetails.name,
      email: customerDetails.email,
      contact: customerDetails.contact,
      fail_existing: "0", // Update if exists
    });

    console.log("✅ Razorpay customer created/fetched:", customer.id);
    return customer;
  } catch (error) {
    console.error("Error creating Razorpay customer:", error);
    // For development, return mock data
    if (
      error.message?.includes("key_id") ||
      error.message?.includes("credentials")
    ) {
      console.warn("⚠️ Razorpay credentials not configured, using mock data");
      return {
        id: `cust_mock_${Date.now()}`,
        name: customerDetails.name,
        email: customerDetails.email,
        contact: customerDetails.contact,
      };
    }
    throw new Error(`Failed to create Razorpay customer: ${error.message}`);
  }
};

/**
 * Cancel a Razorpay subscription
 * @param {string} subscriptionId - Razorpay subscription ID
 * @param {boolean} cancelAtPeriodEnd - Whether to cancel at period end
 * @returns {Promise<object>} Cancelled subscription details
 */
const cancelRazorpaySubscription = async (
  subscriptionId,
  cancelAtPeriodEnd = true,
) => {
  try {
    // Validate subscriptionId
    if (!subscriptionId) {
      throw new Error("Subscription ID is required");
    }

    // Check if mock subscription
    if (
      subscriptionId.startsWith("mock_sub_") ||
      subscriptionId.startsWith("free_sub_")
    ) {
      console.warn(
        "⚠️ Mock or free subscription, skipping Razorpay cancellation",
      );
      return {
        id: subscriptionId,
        status: "cancelled",
        cancel_at_period_end: cancelAtPeriodEnd,
      };
    }

    // Check if it's a payment ID (not a subscription ID) - skip Razorpay cancellation
    // This happens when subscriptions are created via payment links instead of checkout.js
    if (subscriptionId.startsWith("pay_")) {
      console.warn(
        "⚠️ Payment ID detected instead of subscription ID, skipping Razorpay API cancellation",
      );
      console.warn(
        "⚠️ This subscription was created via payment link, not Razorpay Subscriptions API",
      );
      return {
        id: subscriptionId,
        status: "cancelled",
        cancel_at_period_end: cancelAtPeriodEnd,
      };
    }

    if (
      !razorpay ||
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      console.warn("⚠️ Razorpay not configured, returning mock cancellation");
      return {
        id: subscriptionId,
        status: "cancelled",
        cancel_at_period_end: cancelAtPeriodEnd,
      };
    }

    const subscription = await razorpay.subscriptions.cancel(subscriptionId, {
      cancel_at_cycle_end: cancelAtPeriodEnd,
    });

    console.log("✅ Razorpay subscription cancelled:", subscription.id);
    return subscription;
  } catch (error) {
    console.error("Error cancelling Razorpay subscription:", error);
    const errorMsg =
      error.error?.description ||
      error.message ||
      error.description ||
      JSON.stringify(error);
    throw new Error(`Failed to cancel Razorpay subscription: ${errorMsg}`);
  }
};

/**
 * Fetch Razorpay subscription details
 * @param {string} subscriptionId - Razorpay subscription ID
 * @returns {Promise<object>} Subscription details
 */
const fetchRazorpaySubscription = async (subscriptionId) => {
  try {
    // Check if mock subscription
    if (
      subscriptionId.startsWith("mock_sub_") ||
      subscriptionId.startsWith("free_sub_")
    ) {
      return {
        id: subscriptionId,
        status: "active",
        plan_id: "mock_plan",
        current_start: Math.floor(Date.now() / 1000),
        current_end: Math.floor(Date.now() / 1000) + 2592000, // +30 days
      };
    }

    if (
      !razorpay ||
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      console.warn("⚠️ Razorpay not configured");
      return {
        id: subscriptionId,
        status: "active",
        plan_id: "mock_plan",
      };
    }

    const subscription = await razorpay.subscriptions.fetch(subscriptionId);
    return subscription;
  } catch (error) {
    console.error("Error fetching Razorpay subscription:", error);
    throw new Error(`Failed to fetch Razorpay subscription: ${error.message}`);
  }
};

/**
 * Upgrade/Change Razorpay subscription plan
 * Razorpay handles proration automatically based on daily usage
 * @param {string} subscriptionId - Current Razorpay subscription ID
 * @param {string} newPlanId - New Razorpay plan ID to upgrade to
 * @returns {Promise<object>} Updated subscription details
 */
const upgradeRazorpaySubscription = async (subscriptionId, newPlanId) => {
  try {
    // Check if Razorpay is configured
    if (
      !razorpay ||
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      console.warn("⚠️ Razorpay not configured, returning mock upgrade");
      return {
        id: subscriptionId,
        plan_id: newPlanId,
        status: "active",
        change_at: Math.floor(Date.now() / 1000),
      };
    }

    // Use Razorpay's subscription edit API to change the plan
    // Razorpay automatically handles proration based on remaining days in the cycle
    const updatedSubscription = await razorpay.subscriptions.edit(
      subscriptionId,
      {
        plan_id: newPlanId,
        // Razorpay calculates prorated amount automatically
        // No need to manually calculate proration
      },
    );

    return updatedSubscription;
  } catch (error) {
    console.error("Error upgrading Razorpay subscription:", error);
    throw new Error(`Failed to upgrade subscription: ${error.message}`);
  }
};

// ============================================
// PAYMENT LINK FUNCTIONS
// ============================================

/**
 * Create a Razorpay payment link for subscriptions
 * Payment links always have working checkout pages (unlike subscription short_urls)
 * @param {number} amount - Amount in paise
 * @param {object} options - Additional options
 * @param {string} options.description - Payment description
 * @param {string} options.customer_id - Razorpay customer ID
 * @param {object} options.notes - Additional notes
 * @param {number} options.expire_by - Unix timestamp for link expiration
 * @param {string} options.callback_url - URL to redirect after payment
 * @param {string} options.callback_method - HTTP method for callback (get only)
 * @returns {Promise<object>} Payment link details with short_url
 */
const createPaymentLink = async (amount, options = {}) => {
  const {
    description = "Subscription Payment",
    customer_id,
    notes = {},
    expire_by,
    callback_url,
    callback_method = "redirect",
  } = options;

  try {
    if (
      !razorpay ||
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      console.warn("⚠️ Razorpay not configured, returning mock payment link");
      return {
        id: `mock_plink_${Date.now()}`,
        short_url: "http://localhost:3000/provider/subscription?success=mock",
        amount: amount,
        currency: "INR",
        status: "created",
      };
    }

    const payload = {
      amount: amount,
      currency: "INR",
      accept_partial: false,
      description: description,
      expire_by: expire_by || Math.floor(Date.now() / 1000) + 1800, // Default 30 min
      customer_id: customer_id,
      notes: notes,
      reference_id: notes.subscription_id || `sub_${Date.now()}`,
      notify: {
        email: true,
        sms: true,
      },
      reminder_enable: true,
    };

    // Add callback URL if provided (redirects user after payment)
    if (callback_url) {
      payload.callback_url = callback_url;
      payload.callback_method = callback_method;
    }

    console.log(
      "📝 Creating Razorpay payment link with payload:",
      JSON.stringify(payload, null, 2),
    );
    const paymentLink = await razorpay.paymentLink.create(payload);

    console.log("✅ Razorpay payment link created:", {
      id: paymentLink.id,
      short_url: paymentLink.short_url,
      amount: paymentLink.amount,
      currency: paymentLink.currency,
    });

    return paymentLink;
  } catch (error) {
    console.error("Error creating Razorpay payment link:", error);
    if (
      error.message?.includes("key_id") ||
      error.message?.includes("credentials")
    ) {
      console.warn("⚠️ Razorpay credentials not configured, using mock data");
      return {
        id: `mock_plink_${Date.now()}`,
        short_url: "http://localhost:3000/provider/subscription?success=mock",
        amount: amount,
        currency: "INR",
        status: "created",
      };
    }
    throw new Error(`Failed to create payment link: ${error.message}`);
  }
};

/**
 * Fetch payment link details
 * @param {string} paymentLinkId - Razorpay payment link ID
 * @returns {Promise<object>} Payment link details
 */
const fetchPaymentLink = async (paymentLinkId) => {
  try {
    if (paymentLinkId.startsWith("mock_plink_")) {
      return {
        id: paymentLinkId,
        status: "paid",
        amount: 0,
        currency: "INR",
      };
    }

    if (
      !razorpay ||
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      console.warn("⚠️ Razorpay not configured");
      return {
        id: paymentLinkId,
        status: "created",
      };
    }

    const paymentLink = await razorpay.paymentLink.fetch(paymentLinkId);
    return paymentLink;
  } catch (error) {
    console.error("Error fetching payment link:", error);
    throw new Error(`Failed to fetch payment link: ${error.message}`);
  }
};
/**
 * Create a Subscription Link for Razorpay Subscriptions API
 * This generates a link that takes customers to a hosted Razorpay page
 * @param {number} amount - Amount in paise (₹1 = 100 paise)
 * @param {object} options - Configuration options
 * @returns {Promise<object>} Subscription link details
 */
/**
 * Create a Subscription using Razorpay Subscriptions API
 * POST /v1/subscriptions - Creates recurring subscription with hosted authorization page
 * @param {number} amount - First payment amount in paise (for addon)
 * @param {object} options - Configuration options
 * @returns {Promise<object>} Subscription with id (sub_...), short_url, status
 */
const createSubscriptionLink = async (amount, options = {}) => {
  try {
    if (
      !razorpay ||
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      console.warn(
        "⚠️ Razorpay not configured, returning mock subscription",
      );
      return {
        id: "sub_mock_" + Date.now(),
        short_url: `https://razorpay.com/pay/mock_sub_${Date.now()}`,
        status: "created",
      };
    }

    const {
      plan_id,
      total_count = 12,
      quantity = 1,
      customer_id,
      customer_notify = true,
      notify_info = {},
      expire_by,
      start_at,
      notes = {},
      addons = [],
    } = options;

    // Validate required parameters
    if (!plan_id) {
      throw new Error("plan_id is required for subscription");
    }

    // Build subscription request as per Razorpay API
    // POST /v1/subscriptions
    const requestBody = {
      plan_id,
      total_count,
      quantity,
      customer_id,
      customer_notify,
      notify_info,
      notes,
    };

    // Add expire_by only if explicitly provided (for link expiry)
    if (expire_by) {
      requestBody.expire_by = expire_by;
    }

    // Add start_at if provided (future start date)
    if (start_at) {
      requestBody.start_at = start_at;
    }

    // Add upfront payment as addon (charges at authorization)
    // This is REQUIRED for first payment to happen during authorization
    if (addons && addons.length > 0) {
      requestBody.addons = addons;
    }

    console.log(
      "🔗 Creating Razorpay subscription (POST /v1/subscriptions):",
      JSON.stringify(requestBody, null, 2),
    );

    // Create subscription using Razorpay Subscriptions API
    const subscription = await razorpay.subscriptions.create(requestBody);

    console.log("✅ Razorpay subscription created:");
    console.log("   ID:", subscription.id);
    console.log("   Short URL:", subscription.short_url);
    console.log("   Status:", subscription.status);

    return subscription;
  } catch (error) {
    console.error("Error creating subscription:", error);
    const errorMsg =
      error.error?.description || error.message || JSON.stringify(error);
    throw new Error(`Failed to create subscription: ${errorMsg}`);
  }
};

/**
 * Fetch Razorpay customer by email
 * Searches for a customer with the given email address
 * @param {string} email - Customer email to search for
 * @returns {Promise<object|null>} Customer object if found, null otherwise
 */
const fetchRazorpayCustomerByEmail = async (email) => {
  try {
    if (!razorpay || !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.warn("⚠️ Razorpay not configured");
      return null;
    }

    // Razorpay API allows listing all customers
    // We'll fetch all and filter by email (note: in production, consider pagination)
    const customers = await razorpay.customers.all({
      count: 100,
      skip: 0,
    });

    // Find customer with matching email
    const customer = customers?.items?.find(
      (c) => c.email?.toLowerCase() === email?.toLowerCase()
    );

    if (customer) {
      console.log("✅ Found Razorpay customer:", customer.id, customer.email);
    } else {
      console.log("ℹ️  No Razorpay customer found for email:", email);
    }

    return customer || null;
  } catch (error) {
    console.error("Error fetching Razorpay customer:", error);
    return null;
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
  // Subscription functions
  createRazorpayCustomer,
  createRazorpaySubscriptionPlan,
  createRazorpaySubscription,
  cancelRazorpaySubscription,
  fetchRazorpaySubscription,
  fetchRazorpayCustomerByEmail,
  upgradeRazorpaySubscription,
  // Payment link functions
  createPaymentLink,
  fetchPaymentLink,
  createSubscriptionLink,
};
