-- Phase 1: Daily Slots Table for Double-Booking Prevention
-- Uses materialized slot pattern: SELECT FOR UPDATE on daily_slots row

-- 1. Create daily_slots table
CREATE TABLE IF NOT EXISTS daily_slots (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  slot_id INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_slots_slot_date_idx UNIQUE (slot_id, booking_date)
);

-- 2. Add booking_id FK to payment_intents for idempotency
ALTER TABLE payment_intents
ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL;

-- 3. Add capacity-check indexes
CREATE INDEX IF NOT EXISTS payment_intents_capacity_idx
ON payment_intents (slot_id, service_id, booking_date, status)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS bookings_capacity_idx
ON bookings (slot_id, service_id, booking_date, status)
WHERE status IN ('confirmed', 'completed');

-- 4. Drop the old unique index that breaks maxAllowBooking > 1
-- (This was in migration 0010 and 0023)
DROP INDEX IF EXISTS payment_intents_slot_date_service_pending_unique;
