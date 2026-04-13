const express = require("express");
const { handleWebhook } = require("../controllers/webhook.controller");

// Create a separate router with raw body parser for webhooks
// This ensures we get the exact raw JSON that Razorpay signed
const webhookRouter = express.Router();

// IMPORTANT: Don't use express.raw() middleware here
// Instead, we'll capture the raw stream manually before any parsing
// This is the ONLY way to get the exact bytes Razorpay signed

const captureRawBody = (req, res, next) => {
  let data = "";

  // Set encoding to utf8 to get strings instead of buffers
  req.setEncoding("utf8");

  req.on("data", (chunk) => {
    data += chunk;
  });

  req.on("end", () => {
    req.rawBody = data;

    // Parse as JSON for controller use
    try {
      req.body = JSON.parse(data);
    } catch (e) {
      console.error("❌ Failed to parse webhook JSON:", e.message);
      req.body = {};
    }

    next();
  });

  req.on("error", (err) => {
    console.error("❌ Webhook stream error:", err);
    next(err);
  });
};

/**
 * Unified Razorpay Webhook Endpoint
 * POST /webhook/razorpay
 *
 * Public endpoint - no authentication required
 * Razorpay sends webhook events here without auth headers
 * Signature verification happens in controller
 */
webhookRouter.post("/razorpay", captureRawBody, handleWebhook);

module.exports = webhookRouter;
