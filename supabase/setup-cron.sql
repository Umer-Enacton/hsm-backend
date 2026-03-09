-- Setup pg_cron for auto-rejecting expired bookings
-- Run this once in Supabase SQL Editor

-- 1. Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Create the cron job - runs every hour
-- This will call your Supabase Edge Function
SELECT cron.schedule(
  'auto-reject-expired-bookings',
  '0 * * * *',  -- Every hour at minute 0
  $$
  SELECT
    net.http_post(
      url := 'https://mzigocwqszrcevmylgyk.supabase.co/functions/v1/auto-reject-bookings',
      headers := '{"Authorization": "Bearer ' || (SELECT id FROM vault.decrypted_tokens WHERE name = 'CRON_SECRET') || '"}',
      timeout_milliseconds := 30000
    );
  $$
);

-- 3. Verify the cron job was created
SELECT * FROM cron.job WHERE jobname = 'auto-reject-expired-bookings';

-- 4. To remove the cron job later:
-- SELECT cron.unschedule('auto-reject-expired-bookings');
