const db = require("../config/db");
const {
  staff,
  staffLeave,
  users,
  businessProfiles,
  bookings,
  staffPayouts,
} = require("../models/schema");
const {
  eq,
  and,
  or,
  sql,
  ilike,
  desc,
  count,
  inArray,
} = require("drizzle-orm");
const bcrypt = require("bcrypt");
const { sanitizeName, sanitizeEmail, sanitizePhone, sanitizeString } = require("../helper/sanitize");

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate employee ID (EMP001, EMP002, etc.)
 */
async function generateEmployeeId(businessProfileId) {
  const [result] = await db
    .select({ count: count() })
    .from(staff)
    .where(eq(staff.businessProfileId, businessProfileId));

  const staffCount = result.count || 0;
  const employeeNumber = String(staffCount + 1).padStart(3, "0");
  return `EMP${employeeNumber}`;
}

/**
 * Generate random temporary password
 */
function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let password = "Password@123";
  // for (let i = 0; i < 8; i++) {
  //   password += chars.charAt(Math.floor(Math.random() * chars.length));
  // }
  return password;
}

// ============================================
// STAFF CRUD OPERATIONS
// ============================================

/**
 * Add new staff member
 * POST /api/staff
 */
const addStaff = async (req, res) => {
  try {
    const {
      email,
      name,
      phone,
      bankAccount,
      upiId,
    } = req.body;

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    // Validate required fields
    if (!email || !name) {
      return res.status(400).json({ message: "Email and name are required" });
    }

    // Sanitize inputs
    const sanitizedName = sanitizeName(name);
    const sanitizedEmail = sanitizeEmail(email);
    const sanitizedPhone = phone ? sanitizePhone(phone) : null;
    const sanitizedUpiId = upiId ? sanitizeString(upiId, { maxLength: 50 }) : null;

    // Check if email already exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, sanitizedEmail));

    let userId;

    if (existingUser) {
      // Check if user is already a staff member for this business
      const [existingStaff] = await db
        .select()
        .from(staff)
        .where(
          and(
            eq(staff.userId, existingUser.id),
            eq(staff.businessProfileId, business.id),
          ),
        );

      if (existingStaff) {
        return res.status(400).json({ message: "Staff already exists" });
      }

      // Check if user has a different role
      if (existingUser.roleId !== 4) {
        // 4 = STAFF role
        return res
          .status(400)
          .json({ message: "User already has a different role" });
      }

      userId = existingUser.id;
    } else {
      // Create new user with STAFF role
      const tempPassword = generatePassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      const [newUser] = await db
        .insert(users)
        .values({
          name: sanitizedName,
          email: sanitizedEmail,
          phone: sanitizedPhone,
          password: hashedPassword,
          roleId: 4, // STAFF role
        })
        .returning();

      userId = newUser.id;

      // TODO: Send welcome email with credentials
      // await sendStaffWelcomeEmail(sanitizedEmail, tempPassword, sanitizedName);
    }

    // Generate employee ID
    const employeeId = await generateEmployeeId(business.id);

    // Create staff record (salary fields removed - earnings are now per-booking)
    const [newStaff] = await db
      .insert(staff)
      .values({
        userId,
        businessProfileId: business.id,
        employeeId,
        status: "active",
        bankAccount: bankAccount ? JSON.stringify(bankAccount) : null,
        upiId: sanitizedUpiId,
        totalEarnings: 0,
        pendingPayout: 0,
        totalPaid: 0,
      })
      .returning();

    // Fetch complete staff details with user info
    const [staffDetails] = await db
      .select({
        id: staff.id,
        userId: staff.userId,
        businessProfileId: staff.businessProfileId,
        employeeId: staff.employeeId,
        status: staff.status,
        joinDate: staff.joinDate,
        isVerified: staff.isVerified,
        upiId: staff.upiId,
        totalEarnings: staff.totalEarnings,
        pendingPayout: staff.pendingPayout,
        totalPaid: staff.totalPaid,
        createdAt: staff.createdAt,
        // User fields
        name: users.name,
        email: users.email,
        phone: users.phone,
        avatar: users.avatar,
      })
      .from(staff)
      .leftJoin(users, eq(staff.userId, users.id))
      .where(eq(staff.id, newStaff.id));

    res.status(201).json({
      message: "Staff added successfully",
      data: staffDetails,
    });
  } catch (error) {
    console.error("Error adding staff:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get all staff for a provider
 * GET /api/staff
 */
const getProviderStaff = async (req, res) => {
  try {
    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    // Filter parameters
    const status = req.query.status; // active, inactive, on_leave, terminated

    // Build query
    let query = db
      .select({
        id: staff.id,
        userId: staff.userId,
        businessProfileId: staff.businessProfileId,
        employeeId: staff.employeeId,
        status: staff.status,
        joinDate: staff.joinDate,
        isVerified: staff.isVerified,
        upiId: staff.upiId,
        totalEarnings: staff.totalEarnings,
        pendingPayout: staff.pendingPayout,
        totalPaid: staff.totalPaid,
        createdAt: staff.createdAt,
        // User fields
        name: users.name,
        email: users.email,
        phone: users.phone,
        avatar: users.avatar,
      })
      .from(staff)
      .leftJoin(users, eq(staff.userId, users.id))
      .where(eq(staff.businessProfileId, business.id));

    // Apply status filter
    if (status && status !== "all") {
      query = query.where(eq(staff.status, status));
    }

    const allStaff = await query.orderBy(desc(staff.createdAt));

    res.json({
      message: "Staff retrieved successfully",
      data: allStaff,
    });
  } catch (error) {
    console.error("Error fetching staff:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get single staff by ID
 * GET /api/staff/:id
 */
const getStaffById = async (req, res) => {
  try {
    const { id } = req.params;

    const [staffMember] = await db
      .select({
        id: staff.id,
        userId: staff.userId,
        businessProfileId: staff.businessProfileId,
        employeeId: staff.employeeId,
        status: staff.status,
        joinDate: staff.joinDate,
        documents: staff.documents,
        isVerified: staff.isVerified,
        bankAccount: staff.bankAccount,
        upiId: staff.upiId,
        totalEarnings: staff.totalEarnings,
        pendingPayout: staff.pendingPayout,
        totalPaid: staff.totalPaid,
        createdAt: staff.createdAt,
        // User fields
        name: users.name,
        email: users.email,
        phone: users.phone,
        avatar: users.avatar,
        // Business info
        businessName: businessProfiles.businessName,
      })
      .from(staff)
      .leftJoin(users, eq(staff.userId, users.id))
      .leftJoin(
        businessProfiles,
        eq(staff.businessProfileId, businessProfiles.id),
      )
      .where(eq(staff.id, id));

    if (!staffMember) {
      return res.status(404).json({ message: "Staff not found" });
    }

    // Check if user has permission (staff can view own profile, provider can view their staff)
    if (
      req.token.roleId !== 3 && // Not admin
      staffMember.userId !== req.token.id && // Not own profile
      staffMember.businessProfileId !== req.token.businessProfileId // Not provider's staff
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Get assigned bookings count
    const [bookingCount] = await db
      .select({ count: count() })
      .from(bookings)
      .where(eq(bookings.assignedStaffId, id));

    // Get completed bookings count
    const [completedCount] = await db
      .select({ count: count() })
      .from(bookings)
      .where(
        and(eq(bookings.assignedStaffId, id), eq(bookings.status, "completed")),
      );

    res.json({
      message: "Staff retrieved successfully",
      data: {
        ...staffMember,
        bankAccount: staffMember.bankAccount
          ? JSON.parse(staffMember.bankAccount)
          : null,
        documents: staffMember.documents
          ? JSON.parse(staffMember.documents)
          : null,
        stats: {
          totalBookings: bookingCount.count,
          completedBookings: completedCount.count,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching staff:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get current staff member's profile
 * GET /api/staff/me
 * Staff can fetch their own profile using this endpoint
 */
const getStaffMe = async (req, res) => {
  try {
    // Check if user is staff (roleId = 4)
    if (req.token.roleId !== 4) {
      return res.status(403).json({ message: "Access denied. Staff access only." });
    }

    // Find staff record by user ID
    const [staffMember] = await db
      .select({
        id: staff.id,
        userId: staff.userId,
        businessProfileId: staff.businessProfileId,
        employeeId: staff.employeeId,
        status: staff.status,
        joinDate: staff.joinDate,
        documents: staff.documents,
        isVerified: staff.isVerified,
        bankAccount: staff.bankAccount,
        upiId: staff.upiId,
        totalEarnings: staff.totalEarnings,
        pendingPayout: staff.pendingPayout,
        totalPaid: staff.totalPaid,
        createdAt: staff.createdAt,
        // User fields
        name: users.name,
        email: users.email,
        phone: users.phone,
        avatar: users.avatar,
        // Business info
        businessName: businessProfiles.businessName,
      })
      .from(staff)
      .leftJoin(users, eq(staff.userId, users.id))
      .leftJoin(
        businessProfiles,
        eq(staff.businessProfileId, businessProfiles.id),
      )
      .where(eq(staff.userId, req.token.id));

    if (!staffMember) {
      return res.status(404).json({ message: "Staff profile not found" });
    }

    // Get assigned bookings count
    const [bookingCount] = await db
      .select({ count: count() })
      .from(bookings)
      .where(eq(bookings.assignedStaffId, staffMember.id));

    // Get completed bookings count
    const [completedCount] = await db
      .select({ count: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.assignedStaffId, staffMember.id),
          eq(bookings.status, "completed"),
        ),
      );

    res.json({
      message: "Staff profile retrieved successfully",
      data: {
        ...staffMember,
        bankAccount: staffMember.bankAccount
          ? JSON.parse(staffMember.bankAccount)
          : null,
        documents: staffMember.documents
          ? JSON.parse(staffMember.documents)
          : null,
        stats: {
          totalBookings: bookingCount.count,
          completedBookings: completedCount.count,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching staff profile:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Update staff details
 * PUT /api/staff/:id
 */
const updateStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      phone,
      bankAccount,
      upiId,
    } = req.body;

    // Check if staff exists
    const [existingStaff] = await db
      .select()
      .from(staff)
      .where(eq(staff.id, id));

    if (!existingStaff) {
      return res.status(404).json({ message: "Staff not found" });
    }

    // Verify provider owns this staff
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business || existingStaff.businessProfileId !== business.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Build update object - email cannot be changed for security
    const updateData = {};

    // Allow name update (with sanitization)
    if (name !== undefined) {
      updateData.name = sanitizeName(name);
    }

    // Allow phone update (with sanitization)
    if (phone !== undefined) {
      const sanitizedPhone = sanitizePhone(phone);
      if (sanitizedPhone && sanitizedPhone.length !== 10) {
        return res.status(400).json({ message: "Phone must be 10 digits" });
      }
      updateData.phone = sanitizedPhone;
    }

    if (bankAccount !== undefined)
      updateData.bankAccount = JSON.stringify(bankAccount);
    if (upiId !== undefined) {
      updateData.upiId = sanitizeString(upiId, { maxLength: 50, trim: true });
    }
    updateData.updatedAt = new Date();

    // Update staff
    const [updated] = await db
      .update(staff)
      .set(updateData)
      .where(eq(staff.id, id))
      .returning();

    // Also update the user table if name changed
    if (name !== undefined) {
      await db
        .update(users)
        .set({ name: updateData.name })
        .where(eq(users.id, existingStaff.userId));
    }

    res.json({
      message: "Staff updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Error updating staff:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Update staff status
 * PATCH /api/staff/:id/status
 */
const updateStaffStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // active, inactive, on_leave, terminated

    if (!["active", "inactive", "on_leave", "terminated"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    // Check if staff exists
    const [existingStaff] = await db
      .select()
      .from(staff)
      .where(eq(staff.id, id));

    if (!existingStaff) {
      return res.status(404).json({ message: "Staff not found" });
    }

    // Verify provider owns this staff
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business || existingStaff.businessProfileId !== business.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Update status
    const [updated] = await db
      .update(staff)
      .set({ status, updatedAt: new Date() })
      .where(eq(staff.id, id))
      .returning();

    res.json({
      message: `Staff status updated to ${status}`,
      data: updated,
    });
  } catch (error) {
    console.error("Error updating staff status:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Delete staff (soft delete - status: terminated)
 * DELETE /api/staff/:id
 */
const deleteStaff = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if staff exists
    const [existingStaff] = await db
      .select()
      .from(staff)
      .where(eq(staff.id, id));

    if (!existingStaff) {
      return res.status(404).json({ message: "Staff not found" });
    }

    // Verify provider owns this staff
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business || existingStaff.businessProfileId !== business.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Check for active assigned bookings
    const [activeBookings] = await db
      .select({ count: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.assignedStaffId, id),
          inArray(bookings.status, ["confirmed", "reschedule_pending"]),
        ),
      );

    if (activeBookings.count > 0) {
      return res.status(400).json({
        message: "Cannot remove staff with active bookings",
        data: { activeBookings: activeBookings.count },
      });
    }

    // Soft delete - set status to terminated
    const [deleted] = await db
      .update(staff)
      .set({ status: "terminated", updatedAt: new Date() })
      .where(eq(staff.id, id))
      .returning();

    res.json({
      message: "Staff removed successfully",
      data: deleted,
    });
  } catch (error) {
    console.error("Error deleting staff:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get available staff for a booking slot
 * GET /api/staff/available?slotId=123&date=2024-01-15
 */
const getAvailableStaff = async (req, res) => {
  try {
    const { slotId, date } = req.query;

    if (!slotId || !date) {
      return res.status(400).json({ message: "slotId and date are required" });
    }

    // Get provider's business profile
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, req.token.id));

    if (!business) {
      return res.status(400).json({ message: "Business profile not found" });
    }

    // Get all active staff for this business
    const allStaff = await db
      .select({
        id: staff.id,
        userId: staff.userId,
        employeeId: staff.employeeId,
        status: staff.status,
        commissionPercentage: staff.commissionPercentage,
        // User fields
        name: users.name,
        email: users.email,
        phone: users.phone,
        avatar: users.avatar,
      })
      .from(staff)
      .leftJoin(users, eq(staff.userId, users.id))
      .where(
        and(
          eq(staff.businessProfileId, business.id),
          eq(staff.status, "active"),
        ),
      );

    // Get staff on leave for this date
    const leaveDate = new Date(date).toISOString().split("T")[0];
    const staffOnLeave = await db
      .select({ staffId: staffLeave.staffId })
      .from(staffLeave)
      .where(
        and(
          eq(staffLeave.businessProfileId, business.id),
          eq(staffLeave.status, "approved"),
          // Check if date falls within leave range
          sql`${staffLeave.startDate} <= ${leaveDate} AND ${staffLeave.endDate} >= ${leaveDate}`,
        ),
      );

    const leaveStaffIds = new Set(staffOnLeave.map((l) => l.staffId));

    // Get staff with overlapping bookings at this slot
    const overlappingBookings = await db
      .select({ assignedStaffId: bookings.assignedStaffId })
      .from(bookings)
      .where(
        and(
          eq(bookings.slotId, parseInt(slotId)),
          eq(bookings.bookingDate, leaveDate),
          inArray(bookings.status, ["confirmed", "reschedule_pending"]),
        ),
      );

    const busyStaffIds = new Set(
      overlappingBookings.map((b) => b.assignedStaffId).filter(Boolean),
    );

    // Filter available staff
    const availableStaff = allStaff.filter(
      (s) => !leaveStaffIds.has(s.id) && !busyStaffIds.has(s.id),
    );

    res.json({
      message: "Available staff retrieved successfully",
      data: availableStaff,
    });
  } catch (error) {
    console.error("Error fetching available staff:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  addStaff,
  getProviderStaff,
  getStaffById,
  getStaffMe,
  updateStaff,
  updateStaffStatus,
  deleteStaff,
  getAvailableStaff,
};
