const db = require("../config/db");
const {
  staffLeave,
  staff,
  users,
  businessProfiles,
} = require("../models/schema");
const { eq, and, or, sql, desc, inArray, count } = require("drizzle-orm");

// ============================================
// LEAVE MANAGEMENT CONTROLLERS
// ============================================

/**
 * Request leave (Staff only)
 * POST /api/staff-leave
 */
const requestLeave = async (req, res) => {
  try {
    const { leaveType, startDate, endDate, startTime, endTime, reason } =
      req.body;

    // Get staff record for this user
    const [staffMember] = await db
      .select()
      .from(staff)
      .where(eq(staff.userId, req.token.id));

    if (!staffMember) {
      return res.status(400).json({ message: "Staff record not found" });
    }

    // Validate required fields
    if (!leaveType || !startDate || !endDate) {
      return res
        .status(400)
        .json({ message: "Leave type, start date, and end date are required" });
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) {
      return res
        .status(400)
        .json({ message: "End date cannot be before start date" });
    }

    // Check for overlapping leave requests
    const [overlapping] = await db
      .select()
      .from(staffLeave)
      .where(
        and(
          eq(staffLeave.staffId, staffMember.id),
          eq(staffLeave.status, "approved"),
          // Overlap condition: (newStart <= existingEnd) AND (newEnd >= existingStart)
          sql`${startDate} <= ${staffLeave.endDate} AND ${endDate} >= ${staffLeave.startDate}`
        )
      );

    if (overlapping) {
      return res
        .status(400)
        .json({ message: "You already have approved leave for this period" });
    }

    // Create leave request
    const [newLeave] = await db
      .insert(staffLeave)
      .values({
        staffId: staffMember.id,
        businessProfileId: staffMember.businessProfileId,
        leaveType,
        startDate,
        endDate,
        startTime,
        endTime,
        reason,
        status: "pending",
      })
      .returning();

    // Get complete leave details with user info
    const [leaveDetails] = await db
      .select({
        id: staffLeave.id,
        staffId: staffLeave.staffId,
        leaveType: staffLeave.leaveType,
        startDate: staffLeave.startDate,
        endDate: staffLeave.endDate,
        startTime: staffLeave.startTime,
        endTime: staffLeave.endTime,
        reason: staffLeave.reason,
        status: staffLeave.status,
        approvedAt: staffLeave.approvedAt,
        rejectionReason: staffLeave.rejectionReason,
        createdAt: staffLeave.createdAt,
        // Staff info
        staffName: users.name,
        staffEmail: users.email,
        staffPhone: users.phone,
        staffAvatar: users.avatar,
        employeeId: staff.employeeId,
      })
      .from(staffLeave)
      .leftJoin(staff, eq(staffLeave.staffId, staff.id))
      .leftJoin(users, eq(staff.userId, users.id))
      .where(eq(staffLeave.id, newLeave.id));

    res.status(201).json({
      message: "Leave request submitted successfully",
      data: leaveDetails,
    });
  } catch (error) {
    console.error("Error requesting leave:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get all leave requests for a business (Provider only)
 * GET /api/staff-leave/business
 */
const getBusinessLeaveRequests = async (req, res) => {
  try {
    const { status, startDate, endDate } = req.query;

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    // Build query
    let query = db
      .select({
        id: staffLeave.id,
        staffId: staffLeave.staffId,
        leaveType: staffLeave.leaveType,
        startDate: staffLeave.startDate,
        endDate: staffLeave.endDate,
        startTime: staffLeave.startTime,
        endTime: staffLeave.endTime,
        reason: staffLeave.reason,
        status: staffLeave.status,
        approvedAt: staffLeave.approvedAt,
        rejectionReason: staffLeave.rejectionReason,
        createdAt: staffLeave.createdAt,
        // Staff info
        staffName: users.name,
        staffEmail: users.email,
        staffPhone: users.phone,
        staffAvatar: users.avatar,
        employeeId: staff.employeeId,
        staffStatus: staff.status,
      })
      .from(staffLeave)
      .leftJoin(staff, eq(staffLeave.staffId, staff.id))
      .leftJoin(users, eq(staff.userId, users.id))
      .where(eq(staffLeave.businessProfileId, business.id));

    // Apply status filter
    if (status && status !== "all") {
      query = query.where(eq(staffLeave.status, status));
    }

    // Apply date range filter
    if (startDate && endDate) {
      query = query.where(
        sql`${staffLeave.startDate} >= ${startDate} AND ${staffLeave.endDate} <= ${endDate}`
      );
    }

    const leaveRequests = await query.orderBy(desc(staffLeave.createdAt));

    res.json({
      message: "Leave requests retrieved successfully",
      data: leaveRequests,
    });
  } catch (error) {
    console.error("Error fetching leave requests:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get staff currently on leave (Provider only)
 * GET /api/staff-leave/on-leave
 */
const getStaffOnLeave = async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    // Get staff on approved leave today
    const staffOnLeave = await db
      .select({
        id: staff.id,
        userId: staff.userId,
        employeeId: staff.employeeId,
        status: staff.status,
        // Leave info
        leaveId: staffLeave.id,
        leaveType: staffLeave.leaveType,
        leaveStartDate: staffLeave.startDate,
        leaveEndDate: staffLeave.endDate,
        leaveReason: staffLeave.reason,
        // User info
        name: users.name,
        email: users.email,
        phone: users.phone,
        avatar: users.avatar,
      })
      .from(staffLeave)
      .leftJoin(staff, eq(staffLeave.staffId, staff.id))
      .leftJoin(users, eq(staff.userId, users.id))
      .where(
        and(
          eq(staffLeave.businessProfileId, business.id),
          eq(staffLeave.status, "approved"),
          sql`${today} >= ${staffLeave.startDate} AND ${today} <= ${staffLeave.endDate}`
        )
      );

    res.json({
      message: "Staff on leave retrieved successfully",
      data: staffOnLeave,
      count: staffOnLeave.length,
    });
  } catch (error) {
    console.error("Error fetching staff on leave:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get my leave history (Staff only)
 * GET /api/staff-leave/my-leave
 */
const getStaffLeaveHistory = async (req, res) => {
  try {
    const { status, limit } = req.query;

    // Get staff record for this user
    const [staffMember] = await db
      .select()
      .from(staff)
      .where(eq(staff.userId, req.token.id));

    if (!staffMember) {
      return res.status(400).json({ message: "Staff record not found" });
    }

    // Build query
    let query = db
      .select()
      .from(staffLeave)
      .where(eq(staffLeave.staffId, staffMember.id));

    // Apply status filter
    if (status && status !== "all") {
      query = query.where(eq(staffLeave.status, status));
    }

    // Limit results
    if (limit) {
      query = query.limit(parseInt(limit));
    }

    const leaveHistory = await query.orderBy(desc(staffLeave.createdAt));

    res.json({
      message: "Leave history retrieved successfully",
      data: leaveHistory,
    });
  } catch (error) {
    console.error("Error fetching leave history:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Approve leave request (Provider only)
 * PATCH /api/staff-leave/:id/approve
 */
const approveLeave = async (req, res) => {
  try {
    const { id } = req.params;

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    // Get leave request
    const [leave] = await db
      .select()
      .from(staffLeave)
      .where(eq(staffLeave.id, id));

    if (!leave) {
      return res.status(404).json({ message: "Leave request not found" });
    }

    // Verify leave belongs to this business
    if (leave.businessProfileId !== business.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Check if already processed
    if (leave.status !== "pending") {
      return res
        .status(400)
        .json({ message: `Leave already ${leave.status}` });
    }

    // Update leave status to approved
    const [updatedLeave] = await db
      .update(staffLeave)
      .set({
        status: "approved",
        approvedBy: req.token.id,
        approvedAt: new Date(),
      })
      .where(eq(staffLeave.id, id))
      .returning();

    // Update staff status to on_leave
    await db
      .update(staff)
      .set({ status: "on_leave" })
      .where(eq(staff.id, leave.staffId));

    res.json({
      message: "Leave approved successfully",
      data: updatedLeave,
    });
  } catch (error) {
    console.error("Error approving leave:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Reject leave request (Provider only)
 * PATCH /api/staff-leave/:id/reject
 */
const rejectLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    // Get leave request
    const [leave] = await db
      .select()
      .from(staffLeave)
      .where(eq(staffLeave.id, id));

    if (!leave) {
      return res.status(404).json({ message: "Leave request not found" });
    }

    // Verify leave belongs to this business
    if (leave.businessProfileId !== business.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Check if already processed
    if (leave.status !== "pending") {
      return res
        .status(400)
        .json({ message: `Leave already ${leave.status}` });
    }

    // Update leave status to rejected
    const [updatedLeave] = await db
      .update(staffLeave)
      .set({
        status: "rejected",
        approvedBy: req.token.id,
        approvedAt: new Date(),
        rejectionReason: rejectionReason || "No reason provided",
      })
      .where(eq(staffLeave.id, id))
      .returning();

    res.json({
      message: "Leave rejected successfully",
      data: updatedLeave,
    });
  } catch (error) {
    console.error("Error rejecting leave:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Cancel leave request (Staff only - own requests)
 * PATCH /api/staff-leave/:id/cancel
 */
const cancelLeaveRequest = async (req, res) => {
  try {
    const { id } = req.params;

    // Get staff record for this user
    const [staffMember] = await db
      .select()
      .from(staff)
      .where(eq(staff.userId, req.token.id));

    if (!staffMember) {
      return res.status(400).json({ message: "Staff record not found" });
    }

    // Get leave request
    const [leave] = await db
      .select()
      .from(staffLeave)
      .where(eq(staffLeave.id, id));

    if (!leave) {
      return res.status(404).json({ message: "Leave request not found" });
    }

    // Verify leave belongs to this staff
    if (leave.staffId !== staffMember.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Can only cancel pending or approved leave
    if (!["pending", "approved"].includes(leave.status)) {
      return res
        .status(400)
        .json({ message: "Cannot cancel this leave request" });
    }

    // Update leave status to cancelled
    const [updatedLeave] = await db
      .update(staffLeave)
      .set({ status: "cancelled" })
      .where(eq(staffLeave.id, id))
      .returning();

    // If staff was on_leave, reset to active
    if (leave.status === "approved") {
      await db
        .update(staff)
        .set({ status: "active" })
        .where(eq(staff.id, staffMember.id));
    }

    res.json({
      message: "Leave cancelled successfully",
      data: updatedLeave,
    });
  } catch (error) {
    console.error("Error cancelling leave:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  requestLeave,
  getBusinessLeaveRequests,
  getStaffOnLeave,
  getStaffLeaveHistory,
  approveLeave,
  rejectLeave,
  cancelLeaveRequest,
};
