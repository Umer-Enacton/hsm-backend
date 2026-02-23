const db = require("../config/db");
const { users } = require("../models/schema");
const { eq, desc } = require("drizzle-orm");

// Get all users (ADMIN ONLY)
const getAllUsers = async (req, res) => {
  try {
    const allUsers = await db
      .select()
      .from(users)
      .orderBy(desc(users.createdAt));

    // Remove passwords from response
    const sanitizedUsers = allUsers.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    res.status(200).json({ users: sanitizedUsers });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
// Get User Profile (for admin to view any user)
const getUserProfile = async (req, res) => {
  try {
    const userId = req.params.id;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Remove password from response
    const { password, ...userWithoutPassword } = user;
    res.status(200).json({ user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get Current Logged-in User Profile
const getCurrentUser = async (req, res) => {
  try {
    const userId = req.token.id;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Remove password from response
    const { password, ...userWithoutPassword } = user;
    res.status(200).json({ user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
// Update User Profile
const updateUserProfile = async (req, res) => {
  try {
    const userId = req.token.id;
    const { name, email, phone, avatar } = req.body;

    // Build update object dynamically based on provided fields
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (avatar !== undefined) updateData.avatar = avatar;

    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning();
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Remove password from response
    const { password, ...userWithoutPassword } = updatedUser;
    res.status(200).json({ message: "Profile updated", user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
const deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const deletedCount = await db
      .delete(users)
      .where(eq(users.id, userId))
      .returning();
    if (deletedCount.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
module.exports = {
  getAllUsers,
  getUserProfile,
  getCurrentUser,
  updateUserProfile,
  deleteUser,
};
