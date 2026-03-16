const express = require('express');
const router = express.Router();
const {
  registerToken,
  unregisterToken,
} = require('../controllers/deviceToken.controller');

// All routes require auth (protected by global middleware)

/**
 * @route   POST /register
 * @desc    Register FCM device token for push notifications
 * @access  Private
 * @body    { token: string, deviceInfo?: object }
 */
router.post('/register', registerToken);

/**
 * @route   POST /unregister
 * @desc    Unregister/remove FCM device token
 * @access  Private
 * @body    { token: string }
 */
router.post('/unregister', unregisterToken);

module.exports = router;
