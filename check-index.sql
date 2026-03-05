-- ============================================
-- Database Diagnostic: Check Payment Intent Indexes
-- ============================================

-- Check all indexes on payment_intents table
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'payment_intents'
  AND indexdef LIKE '%pending%';

-- Expected result should show:
-- payment_intents_slot_date_service_pending_unique
-- ON payment_intents USING btree (slot_id, booking_date, service_id)
-- WHERE status = 'pending'::payment_intent_status

-- If you see payment_intents_slot_date_pending_unique (without service),
-- then the migration didn't work properly.

-- Check current pending payment intents
SELECT
    id,
    slot_id,
    service_id,
    booking_date,
    status,
    created_at
FROM payment_intents
WHERE status = 'pending'
ORDER BY created_at DESC;
