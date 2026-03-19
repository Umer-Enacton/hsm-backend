-- Add OTP-based completion verification fields
-- Ensures service is actually completed before marking as done

-- OTP verification fields
ALTER TABLE bookings ADD COLUMN completion_otp VARCHAR(10);
ALTER TABLE bookings ADD COLUMN completion_otp_expiry TIMESTAMP;
ALTER TABLE bookings ADD COLUMN completion_otp_verified_at TIMESTAMP;

-- Photo proof fields (optional)
ALTER TABLE bookings ADD COLUMN before_photo_url TEXT;
ALTER TABLE bookings ADD COLUMN after_photo_url TEXT;
ALTER TABLE bookings ADD COLUMN completion_notes TEXT;

-- Actual completion time (when service really finished)
ALTER TABLE bookings ADD COLUMN actual_completion_time TIMESTAMP;

-- Index for OTP lookups
CREATE INDEX idx_bookings_completion_otp ON bookings(completion_otp) WHERE completion_otp IS NOT NULL;
