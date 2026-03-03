-- ============================================
-- Slot Lock Verification Script
-- Run this to verify the unique index exists and is working
-- ============================================

-- 1. Check if the unique index exists
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'payment_intents'
  AND indexname = 'payment_intents_slot_date_pending_unique';

-- Expected result: Should show 1 row with the index definition
-- If no rows returned, the index doesn't exist!

-- 2. Check all indexes on payment_intents table
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'payment_intents';

-- Look for: payment_intents_slot_date_pending_unique

-- 3. Test the unique constraint manually
-- WARNING: This will test with dummy data - clean up after!

BEGIN;

-- Try to create first payment intent
INSERT INTO payment_intents (user_id, service_id, slot_id, address_id, booking_date, amount, razorpay_order_id, status, expires_at)
VALUES (999, 999, 999, 999, '2026-03-05 00:00:00', 10000, 'test_order_1', 'pending', NOW() + INTERVAL '1 minute');

-- Try to create second payment intent with SAME slot_id and booking_date
-- This SHOULD FAIL with unique constraint violation
INSERT INTO payment_intents (user_id, service_id, slot_id, address_id, booking_date, amount, razorpay_order_id, status, expires_at)
VALUES (998, 998, 999, 999, '2026-03-05 00:00:00', 10000, 'test_order_2', 'pending', NOW() + INTERVAL '1 minute');

-- If you see "duplicate key value violates unique constraint", the index is working!
-- If both inserts succeed, the index is NOT working!

ROLLBACK; -- Clean up test data

-- 4. Check if there are any pending payment intents for a specific slot
SELECT
    id,
    slot_id,
    booking_date,
    status,
    expires_at,
    created_at
FROM payment_intents
WHERE status = 'pending'
  AND slot_id = <YOUR_SLOT_ID>
  AND booking_date = '2026-03-05';

-- 5. Verify partial index syntax
-- The index should only apply to rows where status='pending'
\d+ payment_intents

-- Look for: "payment_intents_slot_date_pending_unique" UNIQUE, btree (slot_id, booking_date) WHERE status = 'pending'::payment_intent_status
