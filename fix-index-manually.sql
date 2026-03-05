-- ============================================
-- Manual Fix: Update Payment Intent Index
-- Run this manually in your PostgreSQL database
-- ============================================

-- Step 1: Drop the old index (if it exists)
DROP INDEX IF EXISTS payment_intents_slot_date_pending_unique;

-- Step 2: Create the new index with serviceId
CREATE UNIQUE INDEX payment_intents_slot_date_service_pending_unique
ON payment_intents (slot_id, booking_date, service_id)
WHERE status = 'pending';

-- Step 3: Verify the index was created
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'payment_intents'
  AND indexname LIKE '%pending%';

-- Expected output:
-- indexname: payment_intents_slot_date_service_pending_unique
-- indexdef: CREATE UNIQUE INDEX payment_intents_slot_date_service_pending_unique ON public.payment_intents USING btree (slot_id, booking_date, service_id)
--   WHERE (status = 'pending'::payment_intent_status)
