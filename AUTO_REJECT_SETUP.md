# Auto-Reject with Refund - Complete Setup Guide

## What It Does
Every hour, automatically:
1. Finds pending bookings where scheduled time has passed
2. Marks them as `rejected`
3. Processes refund via Razorpay
4. Updates payment status to `refunded`

## Architecture

```
pg_cron (Supabase)
    ↓ every hour
Edge Function (Supabase)
    ↓ HTTP POST
Backend: /cron/auto-reject-bookings
    ↓ (with CRON_SECRET auth)
Finds expired bookings
    ↓
Reject + Refund via Razorpay
```

## Files Created

```
home-service-management-backend/
├── routes/cron.route.js              ← NEW: Internal cron endpoint
├── supabase/
│   └── functions/auto-reject-bookings/
│       └── index.ts                   ← Edge Function
└── .env
    └── CRON_SECRET=...               ← NEW: Secret for cron auth
```

## Setup Steps

### 1. Deploy to Vercel
```bash
cd home-service-management-backend
git add .
git commit -m "Add auto-reject with refund cron"
git push
```

### 2. Deploy Edge Function to Supabase
```bash
npx supabase functions deploy auto-reject-bookings
```

**Or via Dashboard:**
- Dashboard → Edge Functions → New Function
- Name: `auto-reject-bookings`
- Set env vars:
  - `CRON_SECRET` = `auto-reject-secure-key-12345`
  - `BACKEND_URL` = `https://homefixcare-backend.vercel.app`
- Deploy

### 3. Set up pg_cron in Supabase
Run in **SQL Editor:**
```sql
-- Enable pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create cron job (every hour)
SELECT cron.schedule(
  'auto-reject-expired-bookings',
  '0 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://mzigocwqszrcevmylgyk.supabase.co/functions/v1/auto-reject-bookings',
      headers := jsonb_build_object(
        'Authorization', 'Bearer auto-reject-secure-key-12345'
      ),
      timeout_milliseconds := 30000
    );
  $$
);
```

### 4. Test Manually
```bash
# Test internal endpoint
curl -X POST https://homefixcare-backend.vercel.app/cron/auto-reject-bookings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer auto-reject-secure-key-12345"

# Test Edge Function
curl -X POST https://mzigocwqszrcevmylgyk.supabase.co/functions/v1/auto-reject-bookings \
  -H "Authorization: Bearer auto-reject-secure-key-12345"
```

## Important Notes

✅ **CRON_SECRET** must match in:
- `.env` file (backend)
- Edge Function environment variables
- pg_cron SQL

✅ **Backend URL** must point to production:
- Local: `http://localhost:8000`
- Production: `https://homefixcare-backend.vercel.app`

✅ **pg_cron runs on Supabase server**, NOT on local or Vercel

## Monitoring

Check if cron is running:
```sql
SELECT * FROM cron.job_run_details
WHERE jobname = 'auto-reject-expired-bookings'
ORDER BY starttime DESC
LIMIT 10;
```

Check rejected bookings:
```sql
SELECT * FROM bookings
WHERE status = 'rejected'
ORDER BY updated_at DESC
LIMIT 20;
```

## Troubleshooting

**Not working?**
1. Check Edge Function logs in Supabase Dashboard
2. Check backend is deployed on Vercel
3. Verify CRON_SECRET matches everywhere
4. Check pg_cron job exists: `SELECT * FROM cron.job;`

**Refund failing?**
1. Check Razorpay keys are correct
2. Check Razorpay payment ID exists
3. Check backend logs for refund errors
