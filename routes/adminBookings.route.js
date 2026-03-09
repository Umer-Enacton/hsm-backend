const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { autoRejectExpiredBookings, getBookingsAboutToExpire } = require("../utils/autoRejectExpiredBookings");

/**
 * GET /admin/bookings/expired
 * Get list of expired pending bookings that haven't been processed
 */
router.get("/admin/bookings/expired", auth, async (req, res) => {
  try {
    const results = await autoRejectExpiredBookings();
    res.status(200).json({
      message: "Expired bookings processed",
      ...results,
    });
  } catch (error) {
    console.error("Error processing expired bookings:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * GET /admin/bookings/expiring
 * Get bookings that will expire soon (for reminders)
 * Query params: hours (default: 2)
 */
router.get("/admin/bookings/expiring", auth, async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 2;
    const expiringSoon = await getBookingsAboutToExpire(hours);
    res.status(200).json({
      bookings: expiringSoon,
      count: expiringSoon.length,
      hours,
    });
  } catch (error) {
    console.error("Error getting expiring bookings:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
