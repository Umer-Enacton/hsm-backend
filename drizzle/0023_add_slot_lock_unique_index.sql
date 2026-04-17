-- Add unique index to prevent concurrent bookings on same slot/date/service
-- This allows the same slot to be booked by different services on the same date
-- But prevents two users from booking the same slot+date+service simultaneously
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_slot_date_service_pending_unique
ON payment_intents (slot_id, booking_date, service_id)
WHERE status = 'pending';
