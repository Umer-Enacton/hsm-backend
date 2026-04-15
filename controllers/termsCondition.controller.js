const db = require("../config/db");
const { termsConditions, termsConditionNotifications, users, notifications } = require("../models/schema");
const { eq, and, desc, sql } = require("drizzle-orm");

/**
 * Get active terms & conditions (public endpoint)
 */
const getActiveTerms = async (req, res) => {
  try {
    const [activeTerms] = await db
      .select()
      .from(termsConditions)
      .where(eq(termsConditions.isActive, true))
      .orderBy(desc(termsConditions.effectiveDate))
      .limit(1);

    if (!activeTerms) {
      return res.status(404).json({ message: "No active terms & conditions found" });
    }

    res.status(200).json(activeTerms);
  } catch (error) {
    console.error("Error fetching active terms:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get all terms & conditions versions (admin only)
 */
const getAllVersions = async (req, res) => {
  try {
    const allVersions = await db
      .select()
      .from(termsConditions)
      .orderBy(desc(termsConditions.createdAt));

    res.status(200).json({ terms: allVersions });
  } catch (error) {
    console.error("Error fetching terms versions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get single terms & conditions version by ID (admin only)
 */
const getVersion = async (req, res) => {
  try {
    const { id } = req.params;

    const [terms] = await db
      .select()
      .from(termsConditions)
      .where(eq(termsConditions.id, parseInt(id)));

    if (!terms) {
      return res.status(404).json({ message: "Terms & conditions not found" });
    }

    res.status(200).json(terms);
  } catch (error) {
    console.error("Error fetching terms version:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Create new terms & conditions version (admin only)
 */
const createTerms = async (req, res) => {
  try {
    const { version, content } = req.body;
    const adminId = req.token.id;

    // Validate input
    if (!version || !content) {
      return res.status(400).json({ message: "Version and content are required" });
    }

    // Check if version already exists
    const [existing] = await db
      .select()
      .from(termsConditions)
      .where(eq(termsConditions.version, version));

    if (existing) {
      return res.status(400).json({ message: "Version already exists" });
    }

    // Create new terms (inactive by default)
    const [newTerms] = await db
      .insert(termsConditions)
      .values({
        version,
        content,
        createdBy: adminId,
        isActive: false, // New versions are inactive until explicitly activated
      })
      .returning();

    res.status(201).json({
      message: "Terms & conditions version created successfully",
      terms: newTerms,
    });
  } catch (error) {
    console.error("Error creating terms:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Update terms & conditions content (admin only)
 */
const updateTerms = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ message: "Content is required" });
    }

    const [existing] = await db
      .select()
      .from(termsConditions)
      .where(eq(termsConditions.id, parseInt(id)));

    if (!existing) {
      return res.status(404).json({ message: "Terms & conditions not found" });
    }

    const [updated] = await db
      .update(termsConditions)
      .set({ content })
      .where(eq(termsConditions.id, parseInt(id)))
      .returning();

    res.status(200).json({
      message: "Terms & conditions updated successfully",
      terms: updated,
    });
  } catch (error) {
    console.error("Error updating terms:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Activate terms & conditions version (admin only)
 * This will:
 * 1. Deactivate all other versions
 * 2. Activate this version
 * 3. Send notifications to ALL users with role-specific routes
 */
const activateTerms = async (req, res) => {
  try {
    const { id } = req.params;

    const [termsToActivate] = await db
      .select()
      .from(termsConditions)
      .where(eq(termsConditions.id, parseInt(id)));

    if (!termsToActivate) {
      return res.status(404).json({ message: "Terms & conditions not found" });
    }

    // Start a transaction-like operation
    // 1. Deactivate all versions
    await db.update(termsConditions).set({ isActive: false });

    // 2. Activate this version
    const [activated] = await db
      .update(termsConditions)
      .set({ isActive: true })
      .where(eq(termsConditions.id, parseInt(id)))
      .returning();

    // 3. Send notifications to ALL users
    const allUsers = await db.select({ id: users.id, roleId: users.roleId }).from(users);

    let notificationCount = 0;
    for (const user of allUsers) {
      // Determine route based on user role
      let termsRoute = "/terms";
      if (user.roleId === 1) termsRoute = "/customer/terms";
      else if (user.roleId === 2) termsRoute = "/provider/terms";
      else if (user.roleId === 3) termsRoute = "/admin/terms";
      else if (user.roleId === 4) termsRoute = "/staff/terms";

      await db.insert(notifications).values({
        userId: user.id,
        type: "terms_updated",
        title: "Terms & Conditions Updated",
        message: `Version ${activated.version} is now effective.`,
        data: JSON.stringify({
          route: termsRoute,
          termsId: activated.id,
          version: activated.version,
        }),
      });
      notificationCount++;
    }

    // 4. Log the notification
    await db.insert(termsConditionNotifications).values({
      termsId: activated.id,
      version: activated.version,
      recipientCount: notificationCount,
    });

    res.status(200).json({
      message: "Terms & conditions activated successfully",
      terms: activated,
      notificationsSent: notificationCount,
    });
  } catch (error) {
    console.error("Error activating terms:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Delete terms & conditions version (admin only)
 * Can only delete inactive versions
 */
const deleteTerms = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(termsConditions)
      .where(eq(termsConditions.id, parseInt(id)));

    if (!existing) {
      return res.status(404).json({ message: "Terms & conditions not found" });
    }

    if (existing.isActive) {
      return res.status(400).json({
        message: "Cannot delete active terms & conditions. Activate another version first.",
      });
    }

    await db.delete(termsConditions).where(eq(termsConditions.id, parseInt(id)));

    res.status(200).json({ message: "Terms & conditions deleted successfully" });
  } catch (error) {
    console.error("Error deleting terms:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getActiveTerms,
  getAllVersions,
  getVersion,
  createTerms,
  updateTerms,
  activateTerms,
  deleteTerms,
};
