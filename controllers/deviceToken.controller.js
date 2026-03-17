const db = require('../config/db');
const { deviceTokens } = require('../models/schema');
const { eq, and } = require('drizzle-orm');

/**
 * Register/save FCM device token
 * POST /device-tokens/register
 * Body: { token: string, deviceInfo?: object }
 *
 * Uses upsert to handle duplicate tokens gracefully:
 * - If token exists for this user: update lastUsedAt and reactivate
 * - If token exists for different user: update userId to current user
 * - If token doesn't exist: insert new record
 */
async function registerToken(req, res) {
  try {
    const userId = req.token.id;
    const { token, deviceInfo } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    // Convert deviceInfo to JSON string if provided
    const deviceInfoString = deviceInfo ? JSON.stringify(deviceInfo) : null;

    // Use onConflictDoUpdate to handle duplicate tokens
    // If token exists (for any user), update it to belong to current user
    await db.insert(deviceTokens)
      .values({
        userId,
        token,
        deviceInfo: deviceInfoString,
        isActive: true,
        lastUsedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: deviceTokens.token,
        set: {
          userId,
          deviceInfo: deviceInfoString,
          isActive: true,
          lastUsedAt: new Date(),
        },
      });

    res.json({ message: 'Token registered successfully' });
  } catch (error) {
    console.error('Register token error:', error);
    res.status(500).json({ message: 'Error registering token' });
  }
}

/**
 * Unregister/remove FCM token
 * POST /device-tokens/unregister
 * Body: { token: string }
 */
async function unregisterToken(req, res) {
  try {
    const userId = req.token.id;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    await db.delete(deviceTokens)
      .where(and(
        eq(deviceTokens.userId, userId),
        eq(deviceTokens.token, token)
      ));

    res.json({ message: 'Token unregistered successfully' });
  } catch (error) {
    console.error('Unregister token error:', error);
    res.status(500).json({ message: 'Error unregistering token' });
  }
}

module.exports = {
  registerToken,
  unregisterToken,
};
