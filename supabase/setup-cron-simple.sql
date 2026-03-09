-- Simplified pg_cron setup for auto-rejecting expired bookings
-- Run this in Supabase SQL Editor

-- Step 1: Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Step 2: Store your cron secret securely (run once)
-- Replace 'YOUR_CRON_SECRET_HERE' with a secure random string
INSERT INTO vault.secrets (name, description, secret)
VALUES ('CRON_SECRET', 'Secret for auto-reject cron job', 'YOUR_CRON_SECRET_HERE')
ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;

-- Step 3: Create the cron job - runs every hour
SELECT cron.schedule(
  'auto-reject-expired-bookings',
  '0 * * * *',  -- Every hour at minute 0
  $$
  SELECT
    net.http_post(
      url := 'https://mzigocwqszrcevmylgyk.supabase.co/functions/v1/auto-reject-bookings',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET')
      ),
      timeout_milliseconds := 30000
    );
  $$
);

-- Step 4: Verify the cron job was created
SELECT * FROM cron.job WHERE jobname = 'auto-reject-expired-bookings';

-- Step 5: View cron job schedule
SELECT jobname, schedule, next_run FROM cron.job_run_details WHERE jobname = 'auto-reject-expired-bookings';

-- To remove the cron job later:
-- SELECT cron.unschedule('auto-reject-expired-bookings');
