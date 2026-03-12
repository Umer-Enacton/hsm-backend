-- Booking Status Management Restructure
-- Migration to add reschedule tracking, refund flag, and provider settings

-- Create provider_reschedule_settings table
CREATE TABLE IF NOT EXISTS provider_reschedule_settings (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  allow_reschedule BOOLEAN DEFAULT true NOT NULL,
  max_reschedules INTEGER DEFAULT 3 NOT NULL,
  fee_1 INTEGER DEFAULT 5 NOT NULL,
  fee_2 INTEGER DEFAULT 10 NOT NULL,
  fee_3 INTEGER DEFAULT 15 NOT NULL,
  cancellation_hours INTEGER DEFAULT 24 NOT NULL,
  refund_pending_full INTEGER DEFAULT 100 NOT NULL,
  refund_confirmed_partial INTEGER DEFAULT 80 NOT NULL,
  refund_pending_late INTEGER DEFAULT 90 NOT NULL,
  refund_confirmed_late INTEGER DEFAULT 70 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Add new columns to bookings table
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_count INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS last_reschedule_fee INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_refunded BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(500);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(20);

-- Create index on reschedule_count for faster queries
CREATE INDEX IF NOT EXISTS idx_bookings_reschedule_count ON bookings(reschedule_count);

-- Create index on is_refunded for faster queries
CREATE INDEX IF NOT EXISTS idx_bookings_is_refunded ON bookings(is_refunded);

-- Initialize default settings for all existing providers
INSERT INTO provider_reschedule_settings (provider_id)
SELECT DISTINCT u.id
FROM users u
INNER JOIN business_profiles bp ON u.id = bp.provider_id
WHERE NOT EXISTS (
  SELECT 1 FROM provider_reschedule_settings prs WHERE prs.provider_id = u.id
);

-- Add comment to document the new structure
COMMENT ON TABLE provider_reschedule_settings IS 'Provider-specific reschedule and cancellation policies';
COMMENT ON COLUMN bookings.reschedule_count IS 'Number of times this booking has been rescheduled';
COMMENT ON COLUMN bookings.last_reschedule_fee IS 'Fee charged for last reschedule in paise';
COMMENT ON COLUMN bookings.is_refunded IS 'Whether payment has been refunded (separate from status)';
COMMENT ON COLUMN bookings.cancelled_at IS 'When the booking was cancelled';
COMMENT ON COLUMN bookings.cancellation_reason IS 'Reason for cancellation';
COMMENT ON COLUMN bookings.cancelled_by IS 'Who cancelled: customer, provider, or system';
