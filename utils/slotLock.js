/**
 * Slot Lock Utilities - Daily Slots Materialized Lock Pattern
 *
 * This module provides functions for the double-booking prevention system.
 * Uses a daily_slots table to give Postgres a physical row to lock via
 * SELECT ... FOR UPDATE.
 */

const { sql, and, eq } = require("drizzle-orm");
const { dailySlots } = require("../models/schema");

/**
 * Normalize a booking date to a DATE string "YYYY-MM-DD"
 * Used as the key for daily_slots.
 *
 * @param {Date|string} bookingDate - The booking date
 * @returns {string} - Date string in "YYYY-MM-DD" format
 */
function toDateString(bookingDate) {
  const d = new Date(bookingDate);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Returns a UTC day range (start and end of day)
 * Used for capacity checks on bookings
 *
 * @param {Date|string} bookingDate - The booking date
 * @returns {{start: Date, end: Date}} - Start and end of the day
 */
function dayRange(bookingDate) {
  const d = new Date(bookingDate);
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Upsert the daily_slots row then lock it with FOR UPDATE.
 * MUST be called inside db.transaction().
 * Lock auto-releases on commit/rollback.
 *
 * Two concurrent transactions both calling this for the same
 * (slotId, bookingDate) are safe: the unique constraint on
 * daily_slots guarantees only one row is created; both then
 * SELECT FOR UPDATE that same row and serialize naturally.
 *
 * @param {Object} tx - Drizzle transaction object
 * @param {number} slotId - The slot ID
 * @param {Date|string} bookingDate - The booking date
 * @param {number} serviceId - The service ID
 * @returns {Promise<Object>} - The locked daily_slots row
 */
async function acquireSlotLock(tx, slotId, bookingDate, serviceId) {
  const dateStr = toDateString(bookingDate);

  // Upsert: create row if not exists, do nothing if already exists
  await tx
    .insert(dailySlots)
    .values({ serviceId, slotId, bookingDate: dateStr })
    .onConflictDoNothing();
  // 5 second sleep
  await new Promise((resolve) => setTimeout(resolve, 5000));
  // Now lock the row with SELECT FOR UPDATE
  // This serializes concurrent requests for the same slot+date
  const [lockedRow] = await tx
    .select()
    .from(dailySlots)
    .where(
      and(eq(dailySlots.slotId, slotId), eq(dailySlots.bookingDate, dateStr)),
    )
    .for("update");

  return lockedRow;
}

/**
 * Check if a daily_slots row exists for the given slot and date
 *
 * @param {Object} tx - Drizzle transaction object
 * @param {number} slotId - The slot ID
 * @param {Date|string} bookingDate - The booking date
 * @returns {Promise<boolean>} - Whether the row exists
 */
async function hasSlotLock(tx, slotId, bookingDate) {
  const dateStr = toDateString(bookingDate);

  const [row] = await tx
    .select()
    .from(dailySlots)
    .where(
      and(eq(dailySlots.slotId, slotId), eq(dailySlots.bookingDate, dateStr)),
    )
    .limit(1);

  return !!row;
}

module.exports = {
  toDateString,
  dayRange,
  acquireSlotLock,
  hasSlotLock,
};
