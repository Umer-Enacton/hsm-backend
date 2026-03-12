-- Add reschedule_outcome field to track reschedule request outcome
-- Values: 'pending', 'accepted', 'rejected', 'cancelled', null (no reschedule)

ALTER TABLE bookings ADD COLUMN reschedule_outcome VARCHAR(20);

-- Add index for faster queries
CREATE INDEX idx_bookings_reschedule_outcome ON bookings(reschedule_outcome);
