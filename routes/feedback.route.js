const express = require("express");
const router = express.Router();
const {
  getFeedbackByBusiness,
  getFeedbackByService,
  addFeedback,
} = require("../controllers/feedback.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { CUSTOMER } = require("../config/roles");
const validate = require("../middleware/validate");
const { feedbackSchema } = require("../helper/validation");

router.get("/feedback/business/:businessId", getFeedbackByBusiness);
router.get("/feedback/service/:serviceId", getFeedbackByService);
router.post(
  "/add-feedback",
  authorizeRole(CUSTOMER),
  validate(feedbackSchema),
  addFeedback
);

module.exports = router;
