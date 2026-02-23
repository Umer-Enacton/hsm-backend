const express = require("express");
const router = express.Router();
const {
  register,
  login,
  logout,
  forgotPassword,
  verifyOTP,
  resetPassword,
} = require("../controllers/auth.controller");
const validate = require("../middleware/validate");
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  verifyOTPSchema,
  resetPasswordSchema,
} = require("../helper/validation");

router.post("/register", validate(registerSchema), register);
router.post("/login", validate(loginSchema), login);
router.post("/logout", logout);

// Password Reset Routes
router.post("/forgot-password", validate(forgotPasswordSchema), forgotPassword);
router.post("/verify-otp", validate(verifyOTPSchema), verifyOTP);
router.post("/reset-password", validate(resetPasswordSchema), resetPassword);

module.exports = router;
