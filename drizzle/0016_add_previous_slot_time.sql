-- Add previous_slot_time field to bookings table
-- Stores the time (HH:mm:ss format) of the previous slot when rescheduling

ALTER TABLE bookings ADD COLUMN previous_slot_time VARCHAR(20);

-- Add comment for documentation
COMMENT ON COLUMN bookings.previous_slot_time IS 'Stores the startTime (e.g., 09:00:00) of the previous slot before reschedule';
