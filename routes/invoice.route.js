const express = require("express");
const router = express.Router();
const { generateInvoice } = require("../controllers/invoice.controller");

/**
 * Invoice Routes
 * All routes are protected and require customer role
 */

// Generate and download invoice PDF for a booking
router.get("/booking/:id", generateInvoice);

module.exports = router;
