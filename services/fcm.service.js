const admin = require('firebase-admin');
const path = require('path');

// STARTUP LOG: Confirm this file is loaded
console.log('✅ fcm.service.js loaded - version 2026-03-16-v4-FINAL');

// Initialize Firebase Admin
// Service account key should be at config/firebase-service-account.json
const serviceAccountPath = path.join(__dirname, '../config/firebase-service-account.json');

let fcm;

try {
  if (!admin.apps.length) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  fcm = admin.messaging();
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Firebase Admin initialization error:', error.message);
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
  console.log('📱 ============================================ 📱');
  console.log('📱 FCM: sendPushNotification called');
  console.log('📱 userId:', userId, 'title:', title);
  console.log('📱 fcm initialized?', !!fcm);
  console.log('📱 ============================================ 📱');

  if (!fcm) {
    console.log('❌ FCM: FCM not initialized, skipping push notification');
    return { success: false, reason: 'fcm_not_initialized' };
  }

  const db = require('../config/db');
  const { deviceTokens } = require('../models/schema');
  const { eq, and } = require('drizzle-orm');

  try {
    // Get active tokens for user
    console.log(`🔍 FCM: Querying tokens for userId=${userId}, isActive=true`);
    const tokens = await db.select()
      .from(deviceTokens)
      .where(
        and(
          eq(deviceTokens.userId, userId),
          eq(deviceTokens.isActive, true)
        )
      );

    console.log(`🔍 FCM: Found ${tokens.length} tokens for user ${userId}`);

    if (tokens.length === 0) {
      console.log(`❌ FCM: No active FCM tokens for user ${userId}`);
      return { success: false, reason: 'no_tokens' };
    }

    const fcmTokens = tokens.map(t => t.token);
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
        console.error(`❌ Failed to send to ${token.substring(0, 20)}...:`, tokenError.message);
        failureCount++;

        // Deactivate invalid tokens
        if (tokenError.code === 'messaging/registration-token-not-registered') {
          console.log(`🗑️ Deactivating invalid token: ${token.substring(0, 20)}...`);
          await db.update(deviceTokens)
            .set({ isActive: false })
            .where(eq(deviceTokens.token, token));
        }
      }
    }

    console.log(`📱 FCM: Response - successCount: ${successCount}, failureCount: ${failureCount}`);

    return {
      success: successCount > 0,
      successCount,
      failureCount,
    };
  } catch (error) {
    console.error('FCM send error:', error);
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
  const promises = userIds.map(id => sendPushNotification(id, title, message, data));
  return Promise.all(promises);
}

module.exports = {
  sendPushNotification,
  sendBulkNotification,
};
