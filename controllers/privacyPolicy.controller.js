const db = require("../config/db");
const { privacyPolicies, privacyPolicyNotifications, users, notifications } = require("../models/schema");
const { eq, desc, sql, and } = require("drizzle-orm");
const { createNotification } = require("../utils/notificationHelper");

/**
 * Get the currently active privacy policy
 * GET /api/privacy-policies/active
 */
const getActivePolicy = async (req, res) => {
  try {
    const [policy] = await db
      .select()
      .from(privacyPolicies)
      .where(eq(privacyPolicies.isActive, true))
      .orderBy(desc(privacyPolicies.createdAt))
      .limit(1);

    if (!policy) {
      return res.status(404).json({ message: "No active privacy policy found" });
    }

    res.json({ policy });
  } catch (error) {
    console.error("Error fetching active policy:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get all privacy policy versions (Admin only)
 * GET /api/admin/privacy-policies/versions
 */
const getAllVersions = async (req, res) => {
  try {
    const policies = await db
      .select()
      .from(privacyPolicies)
      .orderBy(desc(privacyPolicies.createdAt));

    res.json({ policies });
  } catch (error) {
    console.error("Error fetching policy versions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get a specific policy version (Admin only)
 * GET /api/admin/privacy-policies/versions/:id
 */
const getVersion = async (req, res) => {
  try {
    const { id } = req.params;

    const [policy] = await db
      .select()
      .from(privacyPolicies)
      .where(eq(privacyPolicies.id, parseInt(id)));

    if (!policy) {
      return res.status(404).json({ message: "Policy version not found" });
    }

    res.json({ policy });
  } catch (error) {
    console.error("Error fetching policy version:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Create a new privacy policy version (Admin only)
 * POST /api/admin/privacy-policies
 */
const createPolicy = async (req, res) => {
  try {
    const { version, content } = req.body;

    if (!version || !content) {
      return res.status(400).json({ message: "Version and content are required" });
    }

    // Check if version already exists
    const [existing] = await db
      .select()
      .from(privacyPolicies)
      .where(eq(privacyPolicies.version, version));

    if (existing) {
      return res.status(400).json({ message: "Version already exists" });
    }

    // Create new policy (not active by default)
    const [policy] = await db
      .insert(privacyPolicies)
      .values({
        version,
        content,
        createdBy: req.token.id,
      })
      .returning();

    res.status(201).json({
      message: "Privacy policy version created successfully",
      policy,
    });
  } catch (error) {
    console.error("Error creating policy:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Update a policy version (Admin only)
 * PUT /api/admin/privacy-policies/:id
 */
const updatePolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const { version, content } = req.body;

    const [policy] = await db
      .select()
      .from(privacyPolicies)
      .where(eq(privacyPolicies.id, parseInt(id)));

    if (!policy) {
      return res.status(404).json({ message: "Policy version not found" });
    }

    // Update data
    const updateData = {};
    if (version !== undefined) updateData.version = version;
    if (content !== undefined) updateData.content = content;

    const [updated] = await db
      .update(privacyPolicies)
      .set(updateData)
      .where(eq(privacyPolicies.id, parseInt(id)))
      .returning();

    res.json({
      message: "Privacy policy updated successfully",
      policy: updated,
    });
  } catch (error) {
    console.error("Error updating policy:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Activate a policy version (Admin only)
 * This marks the version as active and sends notifications to all users
 * POST /api/admin/privacy-policies/:id/activate
 */
const activatePolicy = async (req, res) => {
  try {
    const { id } = req.params;

    const [policy] = await db
      .select()
      .from(privacyPolicies)
      .where(eq(privacyPolicies.id, parseInt(id)));

    if (!policy) {
      return res.status(404).json({ message: "Policy version not found" });
    }

    // Deactivate all policies
    await db.update(privacyPolicies).set({ isActive: false });

    // Activate this policy
    const [activated] = await db
      .update(privacyPolicies)
      .set({ isActive: true, effectiveDate: new Date() })
      .where(eq(privacyPolicies.id, parseInt(id)))
      .returning();

    // Get all users to send notifications
    const allUsers = await db.select().from(users);

    // Create notification record
    const [notificationRecord] = await db
      .insert(privacyPolicyNotifications)
      .values({
        policyId: activated.id,
        version: activated.version,
        recipientCount: allUsers.length,
      })
      .returning();

    // Send notifications to all users
    // Determine role-specific routes
    const notificationsSent = [];
    for (const user of allUsers) {
      let privacyRoute = "/privacy";

      if (user.roleId === 1) {
        privacyRoute = "/customer/privacy";
      } else if (user.roleId === 2) {
        privacyRoute = "/provider/privacy";
      } else if (user.roleId === 3) {
        privacyRoute = "/admin/privacy";
      } else if (user.roleId === 4) {
        privacyRoute = "/staff/privacy";
      }

      const notification = await createNotification({
        userId: user.id,
        type: "privacy_policy_updated",
        title: "Privacy Policy Updated",
        message: `Version ${activated.version} is now effective.`,
        data: {
          route: privacyRoute,
          policyId: activated.id,
          version: activated.version,
        },
      });

      if (notification) {
        notificationsSent.push({ userId: user.id, notificationId: notification.id });
      }
    }

    res.json({
      message: "Privacy policy activated successfully",
      policy: activated,
      notificationsSent: notificationsSent.length,
      notificationRecordId: notificationRecord.id,
    });
  } catch (error) {
    console.error("Error activating policy:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Delete a policy version (Admin only)
 * DELETE /api/admin/privacy-policies/:id
 */
const deletePolicy = async (req, res) => {
  try {
    const { id } = req.params;

    // Cannot delete active policy
    const [policy] = await db
      .select()
      .from(privacyPolicies)
      .where(eq(privacyPolicies.id, parseInt(id)));

    if (!policy) {
      return res.status(404).json({ message: "Policy version not found" });
    }

    if (policy.isActive) {
      return res.status(400).json({ message: "Cannot delete active policy" });
    }

    await db
      .delete(privacyPolicies)
      .where(eq(privacyPolicies.id, parseInt(id)));

    res.json({ message: "Policy version deleted successfully" });
  } catch (error) {
    console.error("Error deleting policy:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getActivePolicy,
  getAllVersions,
  getVersion,
  createPolicy,
  updatePolicy,
  activatePolicy,
  deletePolicy,
};
