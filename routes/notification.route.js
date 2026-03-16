const express = require('express');
const router = express.Router();
const {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  deleteNotification,
} = require('../controllers/notification.controller');

// All routes require auth (protected by global middleware)

/**
 * @route   GET /
 * @desc    Get user notifications with unread count
 * @access  Private
 */
router.get('/', getUserNotifications);

/**
 * @route   GET /unread-count
 * @desc    Get unread notification count (for header badge)
 * @access  Private
 */
router.get('/unread-count', getUnreadCount);

/**
 * @route   PUT /mark-read
 * @desc    Mark notification(s) as read. If notificationIds is empty, marks all as read
 * @access  Private
 * @body    { notificationIds?: number[] }
 */
router.put('/mark-read', markAsRead);

/**
 * @route   DELETE /:id
 * @desc    Delete a notification
 * @access  Private
 */
router.delete('/:id', deleteNotification);

module.exports = router;
