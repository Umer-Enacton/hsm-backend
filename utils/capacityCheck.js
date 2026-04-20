/**
 * Capacity Check Utilities
 * 
 * Checks slot capacity across bookings and pending payment intents
 * to prevent overbooking.
 */

const { and, eq, gte, lte, ne, sql } = require("drizzle-orm");
const { bookings, paymentIntents, services } = require("../models/schema");
const { dayRange } = require("./slotLock");

/**
 * Check slot capacity for a given slot/service/date combination
 * 
 * @param {Object} tx - Drizzle transaction object
 * @param {Object} params - Check parameters
 * @param {number} params.slotId - The slot ID
 * @param {number} params.serviceId - The service ID
 * @param {Date|string} params.bookingDate - The booking date
 * @param {number|null} params.excludeBookingId - Booking ID to exclude (for reschedules)
 * @returns {Promise<{capacity: number, booked: number, pending: number, available: number}>}
 */
async function checkSlotCapacity(tx, {
  slotId,
  serviceId,
  bookingDate,
  excludeBookingId = null,
}) {
  const { start, end } = dayRange(bookingDate);

  // Get service capacity (maxAllowBooking)
  const [svc] = await tx
    .select({ max: services.maxAllowBooking })
    .from(services)
    .where(eq(services.id, serviceId));
  
  const capacity = svc?.max ?? 1;

  // Count confirmed + completed bookings for this slot/date
  const [{ count: booked }] = await tx
    .select({ count: sql`cast(count(*) as int)` })
    .from(bookings)
    .where(and(
      eq(bookings.slotId, slotId),
      eq(bookings.serviceId, serviceId),
      gte(bookings.bookingDate, start),
      lte(bookings.bookingDate, end),
      sql`${bookings.status} IN ('confirmed', 'completed')`,
      ...(excludeBookingId ? [ne(bookings.id, excludeBookingId)] : [])
    ));

  // Count pending payment intents (not expired)
  const [{ count: pending }] = await tx
    .select({ count: sql`cast(count(*) as int)` })
    .from(paymentIntents)
    .where(and(
      eq(paymentIntents.slotId, slotId),
      eq(paymentIntents.serviceId, serviceId),
      gte(paymentIntents.bookingDate, start),
      lte(paymentIntents.bookingDate, end),
      eq(paymentIntents.status, "pending"),
      sql`${paymentIntents.expiresAt} > NOW()`
    ));

  return {
    capacity,
    booked: booked ?? 0,
    pending: pending ?? 0,
    available: capacity - (booked ?? 0) - (pending ?? 0)
  };
}

/**
 * Check if a specific slot can accommodate a new booking
 * Returns error details if unavailable
 * 
 * @param {Object} tx - Drizzle transaction object
 * @param {Object} params - Check parameters
 * @returns {Promise<{canBook: boolean, reason?: string}>}
 */
async function canBookSlot(tx, {
  slotId,
  serviceId,
  bookingDate,
  excludeBookingId = null,
}) {
  const { available } = await checkSlotCapacity(tx, {
    slotId,
    serviceId,
    bookingDate,
    excludeBookingId
  });

  if (available <= 0) {
    return {
      canBook: false,
      reason: "Slot has reached maximum booking capacity"
    };
  }

  return { canBook: true };
}

module.exports = {
  checkSlotCapacity,
  canBookSlot,
};
