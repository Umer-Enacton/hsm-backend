const express = require("express");
const router = express.Router();
const {
  getFeedbackByBusiness,
  getFeedbackByService,
  addFeedback,
  toggleReviewVisibility,
  addProviderReply,
  deleteReview,
  getFilteredFeedbackByBusiness,
} = require("../controllers/feedback.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { CUSTOMER, PROVIDER } = require("../config/roles");
const validate = require("../middleware/validate");
const { feedbackSchema } = require("../helper/validation");

// Get feedback (public)
router.get("/feedback/business/:businessId", getFilteredFeedbackByBusiness);
router.get("/feedback/service/:serviceId", getFeedbackByService);

// Add feedback (customer only)
router.post(
  "/add-feedback",
  authorizeRole(CUSTOMER),
  validate(feedbackSchema),
  addFeedback
);

// Provider review management routes
router.put("/feedback/:id/visibility", authorizeRole(PROVIDER), toggleReviewVisibility);
router.put("/feedback/:id/reply", authorizeRole(PROVIDER), addProviderReply);
router.delete("/feedback/:id", authorizeRole(PROVIDER), deleteReview);

module.exports = router;
