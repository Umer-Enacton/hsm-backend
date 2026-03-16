// Supabase Edge Function: Auto-handle expired bookings and reschedule requests
// This function is called by pg_cron

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Environment variables
const BACKEND_URL = Deno.env.get('BACKEND_URL') || 'https://homefixcare-backend.vercel.app';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || 'your-cron-secret-here';

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    console.log('=== Cron job started ===');
    console.log('BACKEND_URL:', BACKEND_URL);

    const results = {
      autoRejectBookings: null,
      autoHandleRescheduleRequests: null,
      sendAcceptReminders: null,
      sendUpcomingReminders: null,
      timestamp: new Date().toISOString(),
    };

    // 1. Auto-reject expired pending bookings
    console.log('Step 1: Processing expired pending bookings...');
    try {
      const rejectResponse = await fetch(`${BACKEND_URL}/cron/auto-reject-bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
      });

      if (rejectResponse.ok) {
        results.autoRejectBookings = await rejectResponse.json();
        console.log('✅ Auto-reject completed:', results.autoRejectBookings);
      } else {
        const errorText = await rejectResponse.text();
        console.error('❌ Auto-reject failed:', rejectResponse.status, errorText);
        results.autoRejectBookings = { error: `HTTP ${rejectResponse.status}` };
      }
    } catch (error) {
      console.error('❌ Auto-reject error:', error);
      results.autoRejectBookings = { error: error.message };
    }

    // 2. Auto-handle expired reschedule requests
    console.log('Step 2: Processing expired reschedule requests...');
    try {
      const rescheduleResponse = await fetch(`${BACKEND_URL}/cron/auto-handle-reschedule-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
      });

      if (rescheduleResponse.ok) {
        results.autoHandleRescheduleRequests = await rescheduleResponse.json();
        console.log('✅ Auto-handle reschedule completed:', results.autoHandleRescheduleRequests);
      } else {
        const errorText = await rescheduleResponse.text();
        console.error('❌ Auto-handle reschedule failed:', rescheduleResponse.status, errorText);
        results.autoHandleRescheduleRequests = { error: `HTTP ${rescheduleResponse.status}` };
      }
    } catch (error) {
      console.error('❌ Auto-handle reschedule error:', error);
      results.autoHandleRescheduleRequests = { error: error.message };
    }

    // 3. Send accept reminders to providers
    console.log('Step 3: Sending accept reminders...');
    try {
      const acceptRemindersResponse = await fetch(`${BACKEND_URL}/cron/send-accept-reminders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
      });

      if (acceptRemindersResponse.ok) {
        results.sendAcceptReminders = await acceptRemindersResponse.json();
        console.log('✅ Accept reminders completed:', results.sendAcceptReminders);
      } else {
        const errorText = await acceptRemindersResponse.text();
        console.error('❌ Accept reminders failed:', acceptRemindersResponse.status, errorText);
        results.sendAcceptReminders = { error: `HTTP ${acceptRemindersResponse.status}` };
      }
    } catch (error) {
      console.error('❌ Accept reminders error:', error);
      results.sendAcceptReminders = { error: error.message };
    }

    // 4. Send upcoming service reminders to customers
    console.log('Step 4: Sending upcoming service reminders...');
    try {
      const upcomingRemindersResponse = await fetch(`${BACKEND_URL}/cron/send-upcoming-reminders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
      });

      if (upcomingRemindersResponse.ok) {
        results.sendUpcomingReminders = await upcomingRemindersResponse.json();
        console.log('✅ Upcoming service reminders completed:', results.sendUpcomingReminders);
      } else {
        const errorText = await upcomingRemindersResponse.text();
        console.error('❌ Upcoming service reminders failed:', upcomingRemindersResponse.status, errorText);
        results.sendUpcomingReminders = { error: `HTTP ${upcomingRemindersResponse.status}` };
      }
    } catch (error) {
      console.error('❌ Upcoming service reminders error:', error);
      results.sendUpcomingReminders = { error: error.message };
    }

    console.log('=== Cron job completed ===');

    return new Response(
      JSON.stringify({
        message: 'Cron jobs completed successfully',
        ...results,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Cron job error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error.message,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
});
