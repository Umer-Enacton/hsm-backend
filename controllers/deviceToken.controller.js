const db = require('../config/db');
const { deviceTokens } = require('../models/schema');
const { eq, and } = require('drizzle-orm');

/**
 * Register/save FCM device token
 * POST /device-tokens/register
 * Body: { token: string, deviceInfo?: object }
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

    // Check if token exists for this user
    const existing = await db.select()
      .from(deviceTokens)
      .where(and(
        eq(deviceTokens.userId, userId),
        eq(deviceTokens.token, token)
      ));

    if (existing && existing.length > 0) {
      // Update last used and reactivate
      await db.update(deviceTokens)
        .set({ isActive: true, lastUsedAt: new Date() })
        .where(eq(deviceTokens.id, existing[0].id));
    } else {
      // Insert new token
      await db.insert(deviceTokens).values({
        userId,
        token,
        deviceInfo: deviceInfoString,
        isActive: true,
      });
    }

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
