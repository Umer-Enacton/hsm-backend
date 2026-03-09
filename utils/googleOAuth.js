const crypto = require("crypto");

// Google OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const DEFAULT_REDIRECT_URL = process.env.GOOGLE_REDIRECT_URL || "http://localhost:3000/auth/callback";

/**
 * Generate Google OAuth URL with state parameter
 * @param {string} role - 'customer' or 'provider'
 * @param {string} redirectUri - Optional custom redirect URI
 * @returns {string} Google OAuth URL
 */
function getGoogleAuthUrl(role = "customer", redirectUri = null) {
  const finalRedirectUri = redirectUri || DEFAULT_REDIRECT_URL;

  // Create state parameter with role, nonce, and redirectUri for callback verification
  const state = JSON.stringify({
    role,
    nonce: crypto.randomBytes(16).toString("hex"),
    redirectUri: finalRedirectUri, // Include redirect URI in state
  });

  // Encode state to base64 for safe URL transmission
  const encodedState = Buffer.from(state).toString("base64");

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: finalRedirectUri,
    response_type: "code",
    scope: "openid profile email",
    state: encodedState,
    access_type: "offline",
    prompt: "consent",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange authorization code for access token and user info
 * @param {string} code - Authorization code from Google
 * @param {string} redirectUri - The redirect URI used in the OAuth flow
 * @returns {Promise<Object>} User info from Google
 */
async function getGoogleUserInfo(code, redirectUri = null) {
  const finalRedirectUri = redirectUri || DEFAULT_REDIRECT_URL;

  // Exchange code for tokens
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: finalRedirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Failed to exchange token: ${error}`);
  }

  const tokens = await tokenResponse.json();

  // Get user info with access token
  const userInfoResponse = await fetch(
    `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${tokens.access_token}`
  );

  if (!userInfoResponse.ok) {
    throw new Error("Failed to fetch user info");
  }

  const userInfo = await userInfoResponse.json();

  return {
    googleId: userInfo.sub,
    email: userInfo.email,
    name: userInfo.name,
    picture: userInfo.picture,
    emailVerified: userInfo.email_verified,
  };
}

/**
 * Verify and decode state parameter
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

module.exports = {
  getGoogleAuthUrl,
  getGoogleUserInfo,
  decodeState,
  getRoleIdFromRole,
};
