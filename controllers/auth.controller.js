const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
require("dotenv").config();
const jwtSecret = process.env.JWT_SECRET;

const db = require("../config/db");
const { users } = require("../models/schema");
const { eq, or } = require("drizzle-orm");
const {
  sendOTPEmail,
  sendPasswordResetConfirmation,
} = require("../helper/emailService");

// In-memory OTP storage (in production, use Redis or database)
const otpStore = new Map();
// User Registration
const register = async (req, res) => {
  try {
    const { name, email, phone, password, roleId } = req.body;
    // Check if user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(or(eq(users.email, email), eq(users.phone, phone)));
    if (existingUser.length > 0) {
      return res
        .status(400)
        .json({ message: "User already exists With This Email or Phone" });
    }
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Insert new user
    const [newUser] = await db
      .insert(users)
      .values({
        name,
        email,
        phone,
        password: hashedPassword,
        roleId,
      })
      .returning();
    res
      .status(201)
      .json({ message: "User registered successfully", user: newUser });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    // Find user by email
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }
    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }
    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, roleId: user.roleId },
      jwtSecret,
      {
        expiresIn: "1d",
      },
    );
    //set token in httpOnly cookie
    const oneDay = 24 * 60 * 60 * 1000;
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: oneDay,
    });
    // Send token and user info in response
    res.status(200).json({
      message: "Login successful",
      token: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roleId: user.roleId,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const logout = async (req, res) => {
  try {
    // Clear the token cookie
    res.clearCookie("token");
    res.status(200).json({ message: "Logout successful" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Forgot Password - Send OTP
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Check if user exists
    const [user] = await db.select().from(users).where(eq(users.email, email));

    if (!user) {
      // For security, still return success even if user doesn't exist
      // This prevents email enumeration attacks
      return res.status(200).json({
        message: "If an account exists with this email, an OTP has been sent",
      });
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();

    // Store OTP with expiration (10 minutes)
    otpStore.set(email, {
      otp,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

    // Send OTP email
    await sendOTPEmail(email, otp);

    res.status(200).json({
      message: "OTP sent to your email successfully",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Verify OTP
const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Check if OTP exists and is valid
    const storedData = otpStore.get(email);

    if (!storedData) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // Check if OTP has expired
    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(email);
      return res
        .status(400)
        .json({ message: "OTP has expired. Please request a new one" });
    }

    // Verify OTP
    if (storedData.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    res.status(200).json({
      message: "OTP verified successfully",
      verified: true,
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Reset Password
const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Check if OTP exists and is valid
    const storedData = otpStore.get(email);

    if (!storedData) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // Check if OTP has expired
    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(email);
      return res
        .status(400)
        .json({ message: "OTP has expired. Please request a new one" });
    }

    // Verify OTP
    if (storedData.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // Find user
    const [user] = await db.select().from(users).where(eq(users.email, email));

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await db
      .update(users)
      .set({ password: hashedPassword })
      .where(eq(users.email, email));

    // Clear OTP from store
    otpStore.delete(email);

    // Send confirmation email
    await sendPasswordResetConfirmation(email);

    res.status(200).json({
      message:
        "Password reset successfully. You can now login with your new password",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  register,
  login,
  logout,
  forgotPassword,
  verifyOTP,
  resetPassword,
};
