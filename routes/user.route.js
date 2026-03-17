const express = require("express");
const router = express.Router();
const {
  getAllUsers,
  updateUserProfile,
  deleteUser,
  getUserProfile,
  getCurrentUser,
  changePassword,
} = require("../controllers/user.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { ADMIN } = require("../config/roles");

// Admin only - get all users
router.get("/users", authorizeRole(ADMIN), getAllUsers);

// Admin only - get specific user
router.get("/users/:id", getUserProfile);

// Authenticated users - get current user
router.get("/user/profile", getCurrentUser);

// Authenticated users - update own profile
router.put("/users", updateUserProfile);

// Authenticated users - change password
router.put("/user/change-password", changePassword);

// Admin only - delete user
router.delete("/users/:id", authorizeRole(ADMIN), deleteUser);

module.exports = router;
