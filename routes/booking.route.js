const express = require("express");
const router = express.Router();
const {
  getBookingById,
  getCustomerBookings,
  getProviderBookings,
  getAllBookingsForAdmin,
  addBooking,
  acceptBooking,
  rejectBooking,
  completeBooking,
  rescheduleBooking,
  // New reschedule functions with fee logic
  requestReschedule,
  cancelRescheduleRequest,
  cancelBooking,
  cancelByProvider,
  // Existing reschedule management
  approveReschedule,
  declineReschedule,
  providerReschedule,
  // OTP-based completion verification
  initiateCompletion,
  verifyCompletionOTP,
  resendCompletionOTP,
  uploadCompletionPhotos,
  getBookingHistory,
} = require("../controllers/booking.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { CUSTOMER, PROVIDER, ADMIN } = require("../config/roles");
const validate = require("../middleware/validate");
const { bookingSchema } = require("../helper/validation");

router.get("/booking/:id", getBookingById);
router.get("/booking/:id/history", getBookingHistory);
router.get("/bookings/customer", authorizeRole(CUSTOMER), getCustomerBookings);
router.get("/bookings/provider", authorizeRole(PROVIDER), getProviderBookings);
router.get("/admin/bookings/all", authorizeRole(ADMIN), getAllBookingsForAdmin);
router.post(
  "/add-booking",
  authorizeRole(CUSTOMER),
  validate(bookingSchema),
  addBooking,
);
router.patch("/booking/:id", authorizeRole(CUSTOMER), rescheduleBooking);

// Customer booking management - new endpoints
router.delete("/booking/:id/cancel", authorizeRole(CUSTOMER), cancelBooking);
router.put(
  "/booking/:id/reschedule-request",
  authorizeRole(CUSTOMER),
  requestReschedule,
);
router.put(
  "/booking/:id/cancel-reschedule",
  authorizeRole(CUSTOMER),
  cancelRescheduleRequest,
);

// Provider booking management
router.delete("/provider/booking/:id/cancel", authorizeRole(PROVIDER), cancelByProvider);
router.put("/accept-booking/:id", authorizeRole(PROVIDER), acceptBooking); // Will deprecate
router.put("/reject-booking/:id", authorizeRole(PROVIDER), rejectBooking); // Will deprecate
router.put("/complete-booking/:id", authorizeRole(PROVIDER), completeBooking);

// Provider reschedule management
router.put(
  "/booking/:id/reschedule-approve",
  authorizeRole(PROVIDER),
  approveReschedule,
);
router.put(
  "/booking/:id/reschedule-decline",
  authorizeRole(PROVIDER),
  declineReschedule,
);
router.put(
  "/booking/:id/provider-reschedule",
  authorizeRole(PROVIDER),
  providerReschedule,
);

// OTP-based completion verification (provider only)
router.post(
  "/booking/:id/complete-initiate",
  authorizeRole(PROVIDER),
  initiateCompletion,
);
router.post(
  "/booking/:id/complete-verify",
  authorizeRole(PROVIDER),
  verifyCompletionOTP,
);
router.post(
  "/booking/:id/complete-resend",
  authorizeRole(PROVIDER),
  resendCompletionOTP,
);
router.post(
  "/booking/:id/completion-photos",
  authorizeRole(PROVIDER),
  uploadCompletionPhotos,
);

module.exports = router;
