const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

// STARTUP LOG: Confirm this file is loaded
console.log("✅ fcm.service.js loaded - version 2026-03-17-v5-ENV-SUPPORT");

// Initialize Firebase Admin
// Try multiple sources for service account:
// 1. Environment variables (for Vercel/production)
// 2. File at config/firebase-service-account.json (for local development)

let fcm;

try {
  if (!admin.apps.length) {
    let serviceAccount = null;

    // Debug: Check if env vars are loaded
    console.log("🔍 FCM: Checking environment variables...");
    console.log("🔍 FCM: FIREBASE_PROJECT_ID exists?", !!process.env.FIREBASE_PROJECT_ID);
    console.log("🔍 FCM: FIREBASE_CLIENT_EMAIL exists?", !!process.env.FIREBASE_CLIENT_EMAIL);
    console.log("🔍 FCM: FIREBASE_PRIVATE_KEY exists?", !!process.env.FIREBASE_PRIVATE_KEY);
    console.log("🔍 FCM: FIREBASE_PROJECT_ID value:", process.env.FIREBASE_PROJECT_ID);

    // Method 1: Try environment variables (for production/Vercel)
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      console.log("🔥 FCM: Initializing from environment variables");
      serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      };
      console.log("🔥 FCM: Service account loaded from env vars");
      console.log("🔥 FCM: Project ID:", serviceAccount.projectId);
      console.log("🔥 FCM: Client Email:", serviceAccount.clientEmail);
      console.log("🔥 FCM: Private Key length:", serviceAccount.privateKey.length);
    }
    // Method 2: Try file-based config (for local development)
    // else {
    //   const serviceAccountPath = path.join(__dirname, '../config/firebase-service-account.json');
    //   if (fs.existsSync(serviceAccountPath)) {
    //     console.log('🔥 FCM: Initializing from file');
    //     serviceAccount = require(serviceAccountPath);
    //     console.log('🔥 FCM: Service account loaded from file');
    //   } else {
    //     console.log('⚠️ FCM: No service account found - notifications will be saved but push won\'t work');
    //     console.log('⚠️ FCM: Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY env vars for production');
    //   }
    // }

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      fcm = admin.messaging();
      console.log("✅ Firebase Admin initialized successfully");
    } else {
      console.log(
        "⚠️ Firebase Admin NOT initialized - push notifications disabled",
      );
    }
  } else {
    fcm = admin.messaging();
  }
} catch (error) {
  console.error("❌ Firebase Admin initialization error:", error.message);
  console.error("❌ Full error:", error);
  // Continue without FCM - notifications will be saved but push won't work
}

/**
 * Send push notification to a user
 * @param {number} userId - User ID to send notification to
 * @param {string} title - Notification title
 * @param {string} message - Notification body
 * @param {object} data - Additional data payload
 * @returns {Promise<{success: boolean, successCount?: number, failureCount?: number, reason?: string}>}
 */
async function sendPushNotification(userId, title, message, data = {}) {
  console.log("📱 ============================================ 📱");
  console.log("📱 FCM: sendPushNotification called");
  console.log("📱 userId:", userId, "title:", title);
  console.log("📱 fcm initialized?", !!fcm);
  console.log("📱 ============================================ 📱");

  if (!fcm) {
    console.log("❌ FCM: FCM not initialized, skipping push notification");
    return { success: false, reason: "fcm_not_initialized" };
  }

  const db = require("../config/db");
  const { deviceTokens } = require("../models/schema");
  const { eq, and } = require("drizzle-orm");

  try {
    // Get active tokens for user
    console.log(`🔍 FCM: Querying tokens for userId=${userId}, isActive=true`);
    const tokens = await db
      .select()
      .from(deviceTokens)
      .where(
        and(eq(deviceTokens.userId, userId), eq(deviceTokens.isActive, true)),
      );

    console.log(`🔍 FCM: Found ${tokens.length} tokens for user ${userId}`);

    if (tokens.length === 0) {
      console.log(`❌ FCM: No active FCM tokens for user ${userId}`);
      return { success: false, reason: "no_tokens" };
    }

    const fcmTokens = tokens.map((t) => t.token);
    console.log(`📱 FCM: Sending to ${fcmTokens.length} token(s)`);

    // Prepare data payload (all values must be strings)
    const dataPayload = {
      userId: userId.toString(),
      ...Object.keys(data).reduce((acc, key) => {
        acc[key] = String(data[key]);
        return acc;
      }, {}),
    };

    let successCount = 0;
    let failureCount = 0;

    // Send to each token individually using send() method (works in all versions)
    for (const token of fcmTokens) {
      try {
        const fcmMessage = {
          notification: {
            title,
            body: message,
          },
          data: dataPayload,
          token: token,
        };

        console.log(`📤 Sending to token: ${token.substring(0, 20)}...`);
        await fcm.send(fcmMessage);
        console.log(`✅ Sent successfully to ${token.substring(0, 20)}...`);
        successCount++;
      } catch (tokenError) {
        console.error(
          `❌ Failed to send to ${token.substring(0, 20)}...:`,
          tokenError.message,
        );
        failureCount++;

        // Deactivate invalid tokens
        if (tokenError.code === "messaging/registration-token-not-registered") {
          console.log(
            `🗑️ Deactivating invalid token: ${token.substring(0, 20)}...`,
          );
          await db
            .update(deviceTokens)
            .set({ isActive: false })
            .where(eq(deviceTokens.token, token));
        }
      }
    }

    console.log(
      `📱 FCM: Response - successCount: ${successCount}, failureCount: ${failureCount}`,
    );

    return {
      success: successCount > 0,
      successCount,
      failureCount,
    };
  } catch (error) {
    console.error("FCM send error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Send notification to multiple users
 * @param {number[]} userIds - Array of user IDs
 * @param {string} title - Notification title
 * @param {string} message - Notification body
 * @param {object} data - Additional data payload
 * @returns {Promise<Array>}
 */
async function sendBulkNotification(userIds, title, message, data = {}) {
  const promises = userIds.map((id) =>
    sendPushNotification(id, title, message, data),
  );
  return Promise.all(promises);
}

module.exports = {
  sendPushNotification,
  sendBulkNotification,
};
