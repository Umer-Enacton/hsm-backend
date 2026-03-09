const jwt = require("jsonwebtoken");
require("dotenv").config();
const jwtSecret = process.env.JWT_SECRET;

const db = require("../config/db");
const { users } = require("../models/schema");
const { eq, or } = require("drizzle-orm");

/**
 * Get redirect URI from request origin
 * Uses the frontend URL from request headers or environment fallback
 */
function getRedirectUri(req) {
  // Try to get origin from Referer header
  const referer = req.headers.referer || req.headers.origin;
  if (referer) {
    try {
      const url = new URL(referer);
      // Remove port if it's the default for the protocol
      let origin = url.origin;
      return `${origin}/auth/callback`;
    } catch (e) {
      // If URL parsing fails, fall back to env
    }
  }

  // Fallback to environment variable or localhost
  return process.env.GOOGLE_REDIRECT_URL || "http://localhost:3000/auth/callback";
}

/**
 * Get role ID from role name
 * @param {string} role - 'customer' or 'provider'
 * @returns {number} Role ID
 */
function getRoleIdFromRole(role) {
  const roleMap = {
    customer: 1,
    provider: 2,
  };
  return roleMap[role] || 1; // Default to customer
}

/**
 * Decode state parameter
 * @param {string} encodedState - Base64 encoded state
 * @returns {Object} Decoded state with role and nonce
 */
function decodeState(encodedState) {
  try {
    const state = Buffer.from(encodedState, "base64").toString("utf-8");
    return JSON.parse(state);
  } catch (error) {
    throw new Error("Invalid state parameter");
  }
}

/**
 * Initiate Google OAuth flow
 * GET /auth/google
 * Query params: role (customer/provider)
 */
const initiateGoogleAuth = async (req, res) => {
  try {
    const { role = "customer" } = req.query;

    // Validate role
    if (!["customer", "provider"].includes(role)) {
      return res.status(400).json({ message: "Invalid role specified" });
    }

    // Get dynamic redirect URI based on request
    const redirectUri = getRedirectUri(req);

    // Import here to use the dynamic redirect URI
    const { getGoogleAuthUrl } = require("../utils/googleOAuth");
    const authUrl = getGoogleAuthUrl(role, redirectUri);

    res.status(200).json({ authUrl, redirectUri });
  } catch (error) {
    console.error("Google auth initiation error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Handle Google OAuth callback
 * GET /auth/google/callback
 * Query params: code, state
 */
const handleGoogleCallback = async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).json({ message: "Authorization code is required" });
    }

    if (!state) {
      return res.status(400).json({ message: "State parameter is required" });
    }

    // Decode state to get role and redirect URI
    let decodedState;
    try {
      decodedState = decodeState(state);
    } catch (error) {
      console.error("State decode error:", error);
      return res.status(400).json({ message: "Invalid state parameter" });
    }

    // Use the redirect URI from state (what was actually sent to Google)
    const redirectUri = decodedState.redirectUri || getRedirectUri(req);

    const { role } = decodedState;
    const roleId = getRoleIdFromRole(role);

    console.log("OAuth callback:", { role, roleId, redirectUri, email: "processing" });

    // Get user info from Google (with redirect URI from state)
    const { getGoogleUserInfo } = require("../utils/googleOAuth");
    const googleUserInfo = await getGoogleUserInfo(code, redirectUri);

    // Check if user exists by Google ID or email
    const existingUsers = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.googleId, googleUserInfo.googleId),
          eq(users.email, googleUserInfo.email)
        )
      );

    let user;
    let isNewUser = false;
    let needsPhone = false;

    if (existingUsers.length > 0) {
      // User exists - update Google ID if not set
      user = existingUsers.find((u) => u.email === googleUserInfo.email) || existingUsers[0];

      if (!user.googleId) {
        const [updated] = await db
          .update(users)
          .set({ googleId: googleUserInfo.googleId })
          .where(eq(users.id, user.id))
          .returning();
        user = updated;
      }

      // Check if user has phone number
      if (!user.phone) {
        needsPhone = true;
      }
    } else {
      // Create new user
      const [newUser] = await db
        .insert(users)
        .values({
          name: googleUserInfo.name,
          email: googleUserInfo.email,
          googleId: googleUserInfo.googleId,
          avatar: googleUserInfo.picture,
          roleId,
          phone: null, // Will be collected later
          password: null, // OAuth users don't have password
        })
        .returning();

      user = newUser;
      isNewUser = true;
      needsPhone = true;
    }

    // Generate JWT
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        roleId: user.roleId,
      },
      jwtSecret,
      { expiresIn: "1d" }
    );

    // Set token in httpOnly cookie
    const oneDay = 24 * 60 * 60 * 1000;
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      maxAge: oneDay,
    });

    // Return response with all necessary data
    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        roleId: user.roleId,
      },
      isNewUser,
      needsPhone,
    });
  } catch (error) {
    console.error("Google callback error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Update phone number for OAuth users
 * PUT /auth/google/update-phone
 */
const updatePhoneForOAuthUser = async (req, res) => {
  try {
    const userId = req.token.id;
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    // Validate phone (10 digits starting with 6-9)
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        message: "Phone number must be 10 digits starting with 6-9",
      });
    }

    // Check if phone is already taken by another user
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.phone, phone));

    if (existingUser && existingUser.id !== userId) {
      return res
        .status(400)
        .json({ message: "Phone number already registered" });
    }

    // Update user's phone
    const [updatedUser] = await db
      .update(users)
      .set({ phone })
      .where(eq(users.id, userId))
      .returning();

    res.status(200).json({
      message: "Phone number updated successfully",
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        avatar: updatedUser.avatar,
        roleId: updatedUser.roleId,
      },
    });
  } catch (error) {
    console.error("Update phone error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Link Google account to existing email/password user
 * POST /auth/google/link
 */
const linkGoogleAccount = async (req, res) => {
  try {
    const userId = req.token.id;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ message: "Authorization code is required" });
    }

    // Get the redirect URI from the request
    const redirectUri = getRedirectUri(req);

    // Get user info from Google (with dynamic redirect URI)
    const { getGoogleUserInfo } = require("../utils/googleOAuth");
    const googleUserInfo = await getGoogleUserInfo(code, redirectUri);

    // Check if Google account is already linked to another user
    const [existingGoogleUser] = await db
      .select()
      .from(users)
      .where(eq(users.googleId, googleUserInfo.googleId));

    if (existingGoogleUser && existingGoogleUser.id !== userId) {
      return res
        .status(400)
        .json({ message: "Google account is already linked to another user" });
    }

    // Check if email matches
    const [currentUser] = await db.select().from(users).where(eq(users.id, userId));

    if (currentUser.email !== googleUserInfo.email) {
      return res
        .status(400)
        .json({ message: "Google account email must match your account email" });
    }

    // Link Google account
    const [updatedUser] = await db
      .update(users)
      .set({
        googleId: googleUserInfo.googleId,
        avatar: googleUserInfo.picture || currentUser.avatar,
      })
      .where(eq(users.id, userId))
      .returning();

    res.status(200).json({
      message: "Google account linked successfully",
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        avatar: updatedUser.avatar,
        roleId: updatedUser.roleId,
      },
    });
  } catch (error) {
    console.error("Link Google account error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  initiateGoogleAuth,
  handleGoogleCallback,
  updatePhoneForOAuthUser,
  linkGoogleAccount,
};
