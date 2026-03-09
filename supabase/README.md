# Supabase Edge Function + pg_cron Setup Guide

## Overview
Automatically reject expired pending bookings and process refunds every hour.

---

## Step 1: Deploy Edge Function to Supabase

### Option A: Using Supabase CLI
```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref mzigocwqszrcevmylgyk

# Deploy the function
supabase functions deploy auto-reject-bookings
```

### Option B: Using Supabase Dashboard
1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **Edge Functions**
4. Click **New Function**
5. Name: `auto-reject-bookings`
6. Copy contents from `supabase/functions/auto-reject-bookings/index.ts`
7. Set environment variables:
   - `CRON_SECRET` = Your secret (e.g., `auto-reject-12345`)
   - `BACKEND_URL` = `https://homefixcare-backend.vercel.app`
   - `SUPABASE_URL` = Your project URL (auto-filled)
   - `SUPABASE_SERVICE_ROLE_KEY` = Service role key (auto-filled)
8. Click **Deploy**

---

## Step 2: Set up pg_cron Job

1. Go to **SQL Editor** in Supabase Dashboard
2. Run the SQL from `supabase/setup-cron-simple.sql`
3. Replace `YOUR_CRON_SECRET_HERE` with your actual secret
4. Execute the SQL

---

## Step 3: Set Environment Variables in Backend

Add to `.env`:
```env
# Supabase (already set)
DATABASE_URL=postgresql://postgres:UmerEnacton1@db.mzigocwqszrcevmylgyk.supabase.co:5432/postgres

# For cron security (optional, if you want to call directly)
CRON_SECRET=your-secure-random-string
```

---

## Step 4: Test the Setup

### Test Edge Function manually:
```bash
curl -X POST https://mzigocwqszrcevmylgyk.supabase.co/functions/v1/auto-reject-bookings \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### Check cron job status:
```sql
-- In Supabase SQL Editor
SELECT * FROM cron.job WHERE jobname = 'auto-reject-expired-bookings';
SELECT * FROM cron.schedule WHERE jobname = 'auto-reject-expired-bookings';
```

---

## How It Works

```
Every Hour (pg_cron)
    ↓
Calls Edge Function
    ↓
Finds expired pending bookings
    ↓
1. Updates status → rejected
    ↓
2. Calls Razorpay refund API
    ↓
3. Updates payment status → refunded
```

---

## File Structure Created

```
home-service-management-backend/
├── supabase/
│   ├── functions/
│   │   └── auto-reject-bookings/
│   │       └── index.ts          # Edge Function code
│   └── setup-cron-simple.sql       # SQL to set up cron job
└── utils/
    ├── autoRejectExpiredBookings.js  # Standalone version
    └── checkExpiredBookings.js        # Test script
```

---

## Monitoring

**View logs in Supabase:**
- Dashboard → Edge Functions → auto-reject-bookings → Logs

**Check processed bookings:**
```sql
-- Get rejected bookings in last 24 hours
SELECT * FROM bookings
WHERE status = 'rejected'
AND updated_at > NOW() - INTERVAL '24 hours';
```

---

## Troubleshooting

**Edge Function not firing:**
- Check cron job exists: `SELECT * FROM cron.job;`
- Check function is deployed: Dashboard → Edge Functions
- Check logs for errors

**Refund failing:**
- Check Razorpay API is accessible from Supabase
- Check `BACKEND_URL` environment variable
- Check backend refund endpoint is working

---

## Important Notes

1. **Timezone**: pg_cron uses UTC by default. Adjust if needed.
2. **Cost**: This is FREE on Supabase Hobby plan!
3. **Reliability**: Runs on Supabase's infrastructure, very reliable.
4. **Security**: Uses CRON_SECRET to prevent unauthorized access.
