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
  // Provider reschedule (uses daily_slots lock)
  providerReschedule,
  // OTP-based completion verification
  initiateCompletion,
  verifyCompletionOTP,
  resendCompletionOTP,
  uploadCompletionPhotos,
  getBookingHistory,
  // Staff assignment functions
  assignBookingToStaff,
  getAvailableStaffForBooking,
  unassignBookingFromStaff,
  getStaffAssignedBookings,
  completeBookingWithPayout,
} = require("../controllers/booking.controller.js");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { CUSTOMER, PROVIDER, ADMIN, STAFF } = require("../config/roles");
const validate = require("../middleware/validate");
const { bookingSchema } = require("../helper/validation");

// IMPORTANT: More specific routes must come before parameterized routes
router.get("/booking/available-staff", authorizeRole(PROVIDER), getAvailableStaffForBooking);
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

// Provider reschedule (uses daily_slots lock)
router.put(
  "/booking/:id/provider-reschedule",
  authorizeRole(PROVIDER),
  providerReschedule,
);

// OTP-based completion verification (provider and assigned staff)
router.post(
  "/booking/:id/complete-initiate",
  authorizeRole(PROVIDER, STAFF),
  initiateCompletion,
);
router.post(
  "/booking/:id/complete-verify",
  authorizeRole(PROVIDER, STAFF),
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

// Staff assignment routes (Provider only)
router.post(
  "/booking/:id/assign-staff",
  authorizeRole(PROVIDER),
  assignBookingToStaff,
);
router.post(
  "/booking/:id/unassign-staff",
  authorizeRole(PROVIDER),
  unassignBookingFromStaff,
);

// Staff assigned bookings (Staff only)
router.get(
  "/bookings/staff/my-bookings",
  authorizeRole(STAFF),
  getStaffAssignedBookings,
);

// Staff completion with payout (Staff or Provider)
router.post(
  "/booking/:id/complete-with-payout",
  authorizeRole(PROVIDER), // For now, provider can also complete
  completeBookingWithPayout,
);

module.exports = router;
