const db = require("../config/db");
const { bookingHistory } = require("../models/schema");

/**
 * Helper to log a booking history event
 * @param {number} bookingId
 * @param {string} action - e.g. "created", "confirmed", "reschedule_requested", "reschedule_accepted", "cancelled", "completed", "refunded"
 * @param {string} message - Human readable description
 * @param {string} actor - 'customer', 'provider', 'system'
 * @param {number} actorId - User ID
 * @param {object} historyData - Optional extra data
 * @param {object} transaction - Optional transaction object to use for the insert (useful when calling from within a transaction)
 */
const logBookingHistory = async (bookingId, action, message, actor = null, actorId = null, historyData = null, transaction = null) => {
  try {
    if (!bookingId || !action || !message) {
      console.error("[HISTORY ERROR] Missing required fields for history log");
      return;
    }

    // Use transaction if provided, otherwise use default db connection
    const connection = transaction || db;

    await connection.insert(bookingHistory).values({
      bookingId,
      action,
      message,
      actor,
      actorId,
      historyData: historyData ? JSON.stringify(historyData) : null,
    });
    console.log(`[HISTORY] Logged ${action} for booking ${bookingId}`);
  } catch (error) {
    console.error(`[HISTORY ERROR] Failed to log ${action} for booking ${bookingId}:`, error);
  }
};

module.exports = {
  logBookingHistory,
};
