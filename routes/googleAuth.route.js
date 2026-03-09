const express = require("express");
const router = express.Router();
const {
  initiateGoogleAuth,
  handleGoogleCallback,
  updatePhoneForOAuthUser,
  linkGoogleAccount,
} = require("../controllers/googleAuth.controller");

// Public routes - for OAuth flow
router.get("/google", initiateGoogleAuth);
router.get("/google/callback", handleGoogleCallback);

// Protected routes - require authentication
const authMiddleware = require("../middleware/auth");
router.put("/google/update-phone", authMiddleware, updatePhoneForOAuthUser);
router.post("/google/link", authMiddleware, linkGoogleAccount);

module.exports = router;
