const express = require("express");
const { handleWebhook } = require("../controllers/webhook.controller");

const webhookRouter = express.Router();

/**
 * Capture raw body for Razorpay webhook signature verification.
 *
 * On Vercel (and other serverless platforms) the request body is already
 * buffered before the handler runs, so stream-based approaches (req.on("data"))
 * receive nothing.  Instead we use express.raw() which works in both local and
 * serverless environments: it reads the buffered body as a Buffer and stores it
 * on req.body, from which we derive both req.rawBody (string) and the parsed
 * JSON object.
 */
const captureRawBody = [
  // express.raw() reads the body as a Buffer regardless of Content-Type
  express.raw({ type: "*/*", limit: "10mb" }),

  // Convert Buffer → string + JSON, keep raw string for HMAC verification
  (req, res, next) => {
    try {
      const raw = req.body instanceof Buffer ? req.body.toString("utf8") : String(req.body || "");
      req.rawBody = raw;
      req.body = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error("❌ Failed to parse webhook JSON:", e.message);
      req.rawBody = "";
      req.body = {};
    }
    next();
  },
];

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
