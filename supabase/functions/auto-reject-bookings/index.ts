// Supabase Edge Function: Auto-reject expired bookings
// This function is called every hour by pg_cron

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Environment variables
const BACKEND_URL = Deno.env.get('BACKEND_URL') || 'https://homefixcare-backend.vercel.app';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || 'your-cron-secret-here';

serve(async (req: Request) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    console.log('Cron job: Auto-reject expired bookings...');

    // Call the backend internal cron endpoint
    const response = await fetch(`${BACKEND_URL}/cron/auto-reject-bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CRON_SECRET}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Backend error:', errorText);
      return new Response(`Backend error: ${response.status}`, { status: 500 });
    }

    const result = await response.json();
    console.log('Cron job completed:', result);

    return new Response(
      JSON.stringify({
        message: 'Cron job completed successfully',
        result,
        timestamp: new Date().toISOString(),
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Cron job error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
