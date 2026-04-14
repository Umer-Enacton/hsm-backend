const db = require("../config/db");
const {
  staffLeave,
  staff,
  users,
  businessProfiles,
  bookings,
  slots,
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

    // Check for existing bookings on leave dates
    const existingBookings = await db
      .select({
        id: bookings.id,
        bookingDate: bookings.bookingDate,
        startTime: slots.startTime,
        endTime: slots.endTime,
        serviceName: sql`services.name`.as("serviceName"),
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .leftJoin(sql`services`, sql`services.id = bookings.service_id`)
      .where(
        and(
          eq(bookings.assignedStaffId, staffMember.id),
          inArray(bookings.status, ["confirmed", "completed"]),
          // Booking date falls within leave period
          sql`DATE(${bookings.bookingDate}) >= ${startDate} AND DATE(${bookings.bookingDate}) <= ${endDate}`
        )
      );

    const hasBookingsOnLeaveDates = existingBookings.length > 0;

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
      message: hasBookingsOnLeaveDates
        ? "Leave request submitted but you have bookings on these dates. Provider will need to reassign you from those bookings if leave is approved."
        : "Leave request submitted successfully",
      data: leaveDetails,
      warning: hasBookingsOnLeaveDates
        ? {
            type: "existing_bookings",
            message: `You have ${existingBookings.length} booking(s) on these dates. Provider will be notified and must reassign if leave is approved.`,
            bookings: existingBookings,
          }
        : null,
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

    // For each leave request, check for conflicting bookings
    const leaveRequestsWithConflicts = await Promise.all(
      leaveRequests.map(async (leave) => {
        const conflictingBookings = await db
          .select({
            id: bookings.id,
            bookingDate: bookings.bookingDate,
            startTime: slots.startTime,
            endTime: slots.endTime,
            customerName: sql`${users.name}.as("customerName")`,
            status: bookings.status,
          })
          .from(bookings)
          .innerJoin(slots, eq(bookings.slotId, slots.id))
          .leftJoin(
            sql`${users} as customer_users`,
            sql`customer_users.id = bookings.user_id`
          )
          .where(
            and(
              eq(bookings.assignedStaffId, leave.staffId),
              inArray(bookings.status, ["confirmed", "completed"]),
              // Booking date falls within leave period
              sql`DATE(${bookings.bookingDate}) >= ${leave.startDate} AND DATE(${bookings.bookingDate}) <= ${leave.endDate}`
            )
          );

        return {
          ...leave,
          conflictingBookings,
          hasConflicts: conflictingBookings.length > 0,
        };
      })
    );

    res.json({
      message: "Leave requests retrieved successfully",
      data: leaveRequestsWithConflicts,
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

    // Find conflicting bookings BEFORE approving leave
    const conflictingBookings = await db
      .select({
        id: bookings.id,
        bookingDate: bookings.bookingDate,
        startTime: slots.startTime,
        endTime: slots.endTime,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .where(
        and(
          eq(bookings.assignedStaffId, leave.staffId),
          inArray(bookings.status, ["confirmed", "completed"]),
          // Booking date falls within leave period
          sql`DATE(${bookings.bookingDate}) >= ${leave.startDate} AND DATE(${bookings.bookingDate}) <= ${leave.endDate}`
        )
      );

    // Auto-unassign staff from conflicting bookings
    let unassignedBookings = [];
    if (conflictingBookings.length > 0) {
      const bookingIds = conflictingBookings.map((b) => b.id);
      await db
        .update(bookings)
        .set({
          assignedStaffId: null,
          staffAssignedAt: null,
          staffEarningType: null,
          staffCommissionPercent: null,
          staffFixedAmount: null,
        })
        .where(inArray(bookings.id, bookingIds));

      unassignedBookings = bookingIds;
      console.log(
        `Auto-unassigned staff ${leave.staffId} from ${bookingIds.length} booking(s) due to approved leave`
      );
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
      message: unassignedBookings.length > 0
        ? `Leave approved. Staff has been unassigned from ${unassignedBookings.length} booking(s). Please reassign to another staff.`
        : "Leave approved successfully",
      data: updatedLeave,
      unassignedBookings,
      needsReassignment: unassignedBookings.length > 0,
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
