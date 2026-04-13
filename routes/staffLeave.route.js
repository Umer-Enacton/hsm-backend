const express = require("express");
const router = express.Router();
const {
  requestLeave,
  getBusinessLeaveRequests,
  getStaffOnLeave,
  getStaffLeaveHistory,
  approveLeave,
  rejectLeave,
  cancelLeaveRequest,
} = require("../controllers/staffLeave.controller");

/**
 * @route   POST /api/staff-leave
 * @desc    Request leave (Staff only)
 * @access  Private (Staff)
 */
router.post("/", requestLeave);

/**
 * @route   GET /api/staff-leave/business
 * @desc    Get all leave requests for a business (Provider only)
 * @access  Private (Provider)
 */
router.get("/business", getBusinessLeaveRequests);

/**
 * @route   GET /api/staff-leave/on-leave
 * @desc    Get staff currently on leave (Provider only)
 * @access  Private (Provider)
 */
router.get("/on-leave", getStaffOnLeave);

/**
 * @route   GET /api/staff-leave/my-leave
 * @desc    Get my leave history (Staff only)
 * @access  Private (Staff)
 */
router.get("/my-leave", getStaffLeaveHistory);

/**
 * @route   PATCH /api/staff-leave/:id/approve
 * @desc    Approve leave request (Provider only)
 * @access  Private (Provider)
 */
router.patch("/:id/approve", approveLeave);

/**
 * @route   PATCH /api/staff-leave/:id/reject
 * @desc    Reject leave request (Provider only)
 * @access  Private (Provider)
 */
router.patch("/:id/reject", rejectLeave);

/**
 * @route   PATCH /api/staff-leave/:id/cancel
 * @desc    Cancel leave request (Staff only)
 * @access  Private (Staff)
 */
router.patch("/:id/cancel", cancelLeaveRequest);

module.exports = router;
