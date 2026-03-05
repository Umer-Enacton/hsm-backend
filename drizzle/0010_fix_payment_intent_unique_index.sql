-- Fix payment intent unique index to lock slots across all services
-- Drop old index that included serviceId
DROP INDEX IF EXISTS payment_intents_slot_date_service_pending_unique;

-- Create new index without serviceId - payment intents lock slot for ALL services
CREATE UNIQUE INDEX payment_intents_slot_date_pending_unique
ON payment_intents (slot_id, booking_date)
WHERE status = 'pending';
