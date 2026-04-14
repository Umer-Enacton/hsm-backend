const db = require("../config/db");
const {
  staffLeave,
  staff,
  users,
  businessProfiles,
  bookings,
  slots,
  services,
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
    // Use raw SQL to avoid Drizzle join issues
    const existingBookings = await db.execute(sql`
      SELECT
        b.id,
        b.booking_date,
        s.start_time,
        svc.name as service_name
      FROM bookings b
      INNER JOIN slots s ON s.id = b.slot_id
      INNER JOIN services svc ON svc.id = b.service_id
      WHERE b.assigned_staff_id = ${staffMember.id}
        AND b.status IN ('confirmed', 'completed')
        AND DATE(b.booking_date) >= ${startDate}
        AND DATE(b.booking_date) <= ${endDate}
    `);

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

    // Get complete leave details with user info - use raw SQL for simplicity
    const rawLeaveDetails = await db.execute(sql`
      SELECT
        sl.id,
        sl.staff_id,
        sl.leave_type,
        sl.start_date,
        sl.end_date,
        sl.start_time,
        sl.end_time,
        sl.reason,
        sl.status,
        sl.approved_at,
        sl.rejection_reason,
        sl.created_at,
        u.name as staff_name,
        u.email as staff_email,
        u.phone as staff_phone,
        u.avatar as staff_avatar,
        s.employee_id
      FROM staff_leave sl
      LEFT JOIN staff s ON s.id = sl.staff_id
      LEFT JOIN users u ON u.id = s.user_id
      WHERE sl.id = ${newLeave.id}
    `).then(rows => rows[0]);

    // Convert snake_case to camelCase for frontend
    const leaveDetails = rawLeaveDetails ? {
      id: rawLeaveDetails.id,
      staffId: rawLeaveDetails.staff_id,
      leaveType: rawLeaveDetails.leave_type,
      startDate: rawLeaveDetails.start_date,
      endDate: rawLeaveDetails.end_date,
      startTime: rawLeaveDetails.start_time,
      endTime: rawLeaveDetails.end_time,
      reason: rawLeaveDetails.reason,
      status: rawLeaveDetails.status,
      approvedAt: rawLeaveDetails.approved_at,
      rejectionReason: rawLeaveDetails.rejection_reason,
      createdAt: rawLeaveDetails.created_at,
      staffName: rawLeaveDetails.staff_name,
      staffEmail: rawLeaveDetails.staff_email,
      staffPhone: rawLeaveDetails.staff_phone,
      staffAvatar: rawLeaveDetails.staff_avatar,
      employeeId: rawLeaveDetails.employee_id,
    } : null;

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
    const business = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business || business.length === 0) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    const businessId = business[0].id;
    console.log("🔍 Provider business ID:", businessId, "Provider ID:", req.token.id);

    // Use Drizzle to fetch leave requests
    const conditions = [eq(staffLeave.businessProfileId, businessId)];

    if (status && status !== "all") {
      conditions.push(eq(staffLeave.status, status));
    }

    const whereClause = conditions.length === 1
      ? conditions[0]
      : and(...conditions);

    console.log("🔍 Conditions:", conditions);

    // Fetch leave requests
    let leaveRequestsQuery = db
      .select()
      .from(staffLeave)
      .where(whereClause);

    if (startDate && endDate) {
      leaveRequestsQuery = leaveRequestsQuery.where(
        sql`${staffLeave.startDate} >= ${startDate} AND ${staffLeave.endDate} <= ${endDate}`
      );
    }

    const leaveRequests = await leaveRequestsQuery.orderBy(desc(staffLeave.createdAt));

    console.log("🔍 Raw leave requests count:", leaveRequests.length);
    console.log("🔍 Raw leave requests data:", JSON.stringify(leaveRequests, null, 2));

    // For each leave request, get staff and user info, and check conflicts
    const leaveRequestsWithConflicts = await Promise.all(
      leaveRequests.map(async (leave) => {
        console.log("🔍 Processing leave:", leave);

        // Get staff details
        const [staffMember] = await db
          .select({
            staffId: staff.id,
            userId: staff.userId,
            employeeId: staff.employeeId,
            staffStatus: staff.status,
            userName: users.name,
            userEmail: users.email,
            userPhone: users.phone,
            userAvatar: users.avatar,
          })
          .from(staff)
          .innerJoin(users, eq(staff.userId, users.id))
          .where(eq(staff.id, leave.staffId));

        console.log("🔍 Staff member for leave", leave.id, ":", staffMember);

        return {
          id: leave.id,
          staffId: leave.staffId,
          staffName: staffMember?.userName || "",
          staffEmail: staffMember?.userEmail || "",
          staffAvatar: staffMember?.userAvatar || null,
          staffEmployeeId: staffMember?.employeeId || "",
          leaveType: leave.leaveType,
          startDate: leave.startDate,
          endDate: leave.endDate,
          startTime: leave.startTime,
          endTime: leave.endTime,
          reason: leave.reason,
          status: leave.status,
          approvedAt: leave.approvedAt,
          rejectionReason: leave.rejectionReason,
          createdAt: leave.createdAt,
          staffStatus: staffMember?.staffStatus || "inactive",
          conflictingBookings: [],
          hasConflicts: false,
        };
      })
    );

    console.log("🔍 Final response count:", leaveRequestsWithConflicts.length);

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

    // Get staff on approved leave today using raw SQL
    const staffOnLeave = await db.execute(sql`
      SELECT
        s.id,
        s.user_id,
        s.employee_id,
        s.status,
        sl.id as leave_id,
        sl.leave_type,
        sl.start_date as leave_start_date,
        sl.end_date as leave_end_date,
        sl.reason as leave_reason,
        u.name,
        u.email,
        u.phone,
        u.avatar
      FROM staff_leave sl
      LEFT JOIN staff s ON s.id = sl.staff_id
      LEFT JOIN users u ON u.id = s.user_id
      WHERE sl.business_profile_id = ${business.id}
        AND sl.status = 'approved'
        AND ${today} >= sl.start_date
        AND ${today} <= sl.end_date
    `);

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
