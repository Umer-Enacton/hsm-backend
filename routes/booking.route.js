const express = require("express");
const router = express.Router();
const {
  getBookingById,
  getCustomerBookings,
  getProviderBookings,
  addBooking,
  acceptBooking,
  rejectBooking,
  completeBooking,
} = require("../controllers/booking.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { CUSTOMER, PROVIDER } = require("../config/roles");
const validate = require("../middleware/validate");
const { bookingSchema } = require("../helper/validation");

router.get("/booking/:id", getBookingById);
router.get("/bookings/customer", authorizeRole(CUSTOMER), getCustomerBookings);
router.get("/bookings/provider", authorizeRole(PROVIDER), getProviderBookings);
router.post(
  "/add-booking",
  authorizeRole(CUSTOMER),
  validate(bookingSchema),
  addBooking
);

router.put("/accept-booking/:id", authorizeRole(PROVIDER), acceptBooking);
router.put("/reject-booking/:id", authorizeRole(PROVIDER), rejectBooking);
router.put("/complete-booking/:id", authorizeRole(PROVIDER), completeBooking);

module.exports = router;
