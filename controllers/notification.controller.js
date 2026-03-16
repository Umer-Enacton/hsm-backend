const db = require('../config/db');
const { notifications } = require('../models/schema');
const { eq, and, desc, sql, inArray } = require('drizzle-orm');

/**
 * Get user notifications with unread count
 * GET /notifications
 */
async function getUserNotifications(req, res) {
  try {
    const userId = req.token.id;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    // Get notifications
    const userNotifications = await db.select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    // Parse data JSON for each notification
    const notificationsWithData = userNotifications.map(n => ({
      ...n,
      data: n.data ? JSON.parse(n.data) : null,
    }));

    // Get unread count
    const [unreadResult] = await db.select({ count: sql`count(*)::int` })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      ));

    res.json({
      notifications: notificationsWithData,
      unreadCount: unreadResult.count,
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ message: 'Error fetching notifications' });
  }
}

/**
 * Get unread count only (for header badge)
 * GET /notifications/unread-count
 */
async function getUnreadCount(req, res) {
  try {
    const userId = req.token.id;
    const [result] = await db.select({ count: sql`count(*)::int` })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      ));

    res.json({ count: result.count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ message: 'Error fetching unread count' });
  }
}

/**
 * Mark notification(s) as read
 * PUT /notifications/mark-read
 * Body: { notificationIds?: number[] } - if empty, marks all as read
 */
async function markAsRead(req, res) {
  try {
    const userId = req.token.id;
    const { notificationIds } = req.body;

    if (notificationIds && Array.isArray(notificationIds) && notificationIds.length > 0) {
      // Mark specific notifications as read
      await db.update(notifications)
        .set({
          isRead: true,
          readAt: new Date(),
        })
        .where(and(
          eq(notifications.userId, userId),
          inArray(notifications.id, notificationIds)
        ));
    } else {
      // Mark all as read for this user
      await db.update(notifications)
        .set({
          isRead: true,
          readAt: new Date(),
        })
        .where(and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false)
        ));
    }

    res.json({ message: 'Notifications marked as read' });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ message: 'Error marking notifications as read' });
  }
}

/**
 * Delete notification
 * DELETE /notifications/:id
 */
async function deleteNotification(req, res) {
  try {
    const userId = req.token.id;
    const { id } = req.params;

    await db.delete(notifications)
      .where(and(
        eq(notifications.id, parseInt(id)),
        eq(notifications.userId, userId)
      ));

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ message: 'Error deleting notification' });
  }
}

module.exports = {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  deleteNotification,
};
