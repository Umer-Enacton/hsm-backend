/**
 * Reminder Service
 * Sends automated reminders for:
 * 1. Pending bookings (accept reminders to providers)
 * 2. Upcoming services (reminder to customers)
 */

const db = require('../config/db');
const { bookings, slots, services, users } = require('../models/schema');
const { eq, and, sql, gte, lte } = require('drizzle-orm');
const { notificationTemplates } = require('./notificationHelper');

/**
 * Get current timestamp in readable format
 */
const getTimestamp = () => {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
};

/**
 * Send accept reminders to providers for pending bookings
 * Reminds providers to accept/reject bookings that are expiring soon
 *
 * Runs every 30 minutes via cron
 * Sends reminders for bookings expiring in the next 2 hours
 * Only sends if reminder hasn't been sent yet
 */
const sendAcceptReminders = async () => {
  const startTime = Date.now();
  const timestamp = getTimestamp();

  try {
    console.log(`[${timestamp}] 🔔 Checking for pending bookings needing accept reminders...`);

    // Find pending bookings that:
    // 1. Are scheduled within the next 2 hours
    // 2. Haven't had accept reminder sent yet
    const TWO_HOURS_FROM_NOW = sql`NOW() + INTERVAL '2 hours'`;

    const pendingBookings = await db
      .select({
        bookingId: bookings.id,
        providerId: sql`${services.providerId}`,
        customerId: bookings.customerId,
        serviceName: services.name,
        bookingDate: bookings.bookingDate,
        slotTime: slots.startTime,
        reminderSent: bookings.reminderSent,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(
        and(
          eq(bookings.status, 'pending'),
          eq(bookings.reminderSent, false),
          // Booking time is within next 2 hours
          sql`${bookings.bookingDate} + ${slots.startTime} <= ${TWO_HOURS_FROM_NOW}`,
          // But hasn't expired yet (still in the future)
          sql`${bookings.bookingDate} + ${slots.startTime} > NOW()`
        )
      );

    if (pendingBookings.length === 0) {
      console.log(`[${timestamp}] 📭 No pending bookings needing reminders`);
      return {
        sent: 0,
        duration: Date.now() - startTime,
      };
    }

    console.log(`[${timestamp}] 📬 Found ${pendingBookings.length} pending bookings needing reminders`);

    let sentCount = 0;

    for (const booking of pendingBookings) {
      try {
        // Send notification to provider
        await notificationTemplates.acceptReminder(booking.bookingId);

        // Mark reminder as sent
        await db
          .update(bookings)
          .set({ reminderSent: true })
          .where(eq(bookings.id, booking.bookingId));

        console.log(`[${timestamp}] ✅ Accept reminder sent for booking ${booking.bookingId} to provider ${booking.providerId}`);
        sentCount++;

      } catch (error) {
        console.error(`[${timestamp}] ❌ Failed to send reminder for booking ${booking.bookingId}:`, error.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[${timestamp}] 📊 Accept reminders completed: ${sentCount} sent | Took ${duration}ms`);

    return {
      sent: sentCount,
      duration,
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${timestamp}] ❌ Accept reminders failed after ${duration}ms:`, error.message);
    return { error: error.message, duration };
  }
};

/**
 * Send upcoming service reminders to customers
 * Reminds customers about their scheduled services
 *
 * Runs every 30 minutes via cron
 * Sends reminders for bookings happening tomorrow
 * Only sends if reminder hasn't been sent yet
 */
const sendUpcomingServiceReminders = async () => {
  const startTime = Date.now();
  const timestamp = getTimestamp();

  try {
    console.log(`[${timestamp}] 🔔 Checking for upcoming services needing reminders...`);

    // Find confirmed bookings that:
    // 1. Are scheduled for tomorrow (between 20-28 hours from now)
    // 2. Haven't had upcoming reminder sent yet
    const TOMORROW_START = sql`NOW() + INTERVAL '20 hours'`;
    const TOMORROW_END = sql`NOW() + INTERVAL '28 hours'`;

    const upcomingBookings = await db
      .select({
        bookingId: bookings.id,
        customerId: bookings.customerId,
        serviceName: services.name,
        bookingDate: bookings.bookingDate,
        slotTime: slots.startTime,
        reminderSent: bookings.upcomingReminderSent,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          eq(bookings.upcomingReminderSent, false),
          // Booking time is tomorrow (20-28 hours from now gives a good window)
          sql`${bookings.bookingDate} + ${slots.startTime} >= ${TOMORROW_START}`,
          sql`${bookings.bookingDate} + ${slots.startTime} <= ${TOMORROW_END}`
        )
      );

    if (upcomingBookings.length === 0) {
      console.log(`[${timestamp}] 📭 No upcoming services needing reminders`);
      return {
        sent: 0,
        duration: Date.now() - startTime,
      };
    }

    console.log(`[${timestamp}] 📬 Found ${upcomingBookings.length} upcoming services needing reminders`);

    let sentCount = 0;

    for (const booking of upcomingBookings) {
      try {
        // Send notification to customer
        await notificationTemplates.upcomingService(booking.bookingId);

        // Mark reminder as sent
        await db
          .update(bookings)
          .set({ upcomingReminderSent: true })
          .where(eq(bookings.id, booking.bookingId));

        console.log(`[${timestamp}] ✅ Upcoming service reminder sent for booking ${booking.bookingId} to customer ${booking.customerId}`);
        sentCount++;

      } catch (error) {
        console.error(`[${timestamp}] ❌ Failed to send reminder for booking ${booking.bookingId}:`, error.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[${timestamp}] 📊 Upcoming service reminders completed: ${sentCount} sent | Took ${duration}ms`);

    return {
      sent: sentCount,
      duration,
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${timestamp}] ❌ Upcoming service reminders failed after ${duration}ms:`, error.message);
    return { error: error.message, duration };
  }
};

/**
 * Send day-of service reminders to customers and providers
 * Reminds them about services scheduled for today
 *
 * Runs every 30 minutes via cron
 * Sends reminders for bookings happening today
 * Only sends if reminder hasn't been sent yet
 */
const sendDayOfReminders = async () => {
  const startTime = Date.now();
  const timestamp = getTimestamp();

  try {
    console.log(`[${timestamp}] 🔔 Checking for day-of services needing reminders...`);

    const NOW = sql`NOW()`;
    const TWELVE_HOURS_FROM_NOW = sql`NOW() + INTERVAL '12 hours'`;

    const dayOfBookings = await db
      .select({
        bookingId: bookings.id,
        bookingDate: bookings.bookingDate,
        slotTime: slots.startTime,
        reminderSent: bookings.dayOfReminderSent,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          eq(bookings.dayOfReminderSent, false),
          sql`${bookings.bookingDate} + ${slots.startTime} >= ${NOW}`,
          sql`${bookings.bookingDate} + ${slots.startTime} <= ${TWELVE_HOURS_FROM_NOW}`
        )
      );

    if (dayOfBookings.length === 0) {
      console.log(`[${timestamp}] 📭 No day-of services needing reminders`);
      return {
        sent: 0,
        duration: Date.now() - startTime,
      };
    }

    console.log(`[${timestamp}] 📬 Found ${dayOfBookings.length} day-of services needing reminders`);

    let sentCount = 0;

    for (const booking of dayOfBookings) {
      try {
        await notificationTemplates.dayOfReminderCustomer(booking.bookingId);
        await notificationTemplates.dayOfReminderProvider(booking.bookingId);

        await db
          .update(bookings)
          .set({ dayOfReminderSent: true })
          .where(eq(bookings.id, booking.bookingId));

        console.log(`[${timestamp}] ✅ Day-of service reminder sent for booking ${booking.bookingId}`);
        sentCount += 2;

      } catch (error) {
        console.error(`[${timestamp}] ❌ Failed to send day-of reminder for booking ${booking.bookingId}:`, error.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[${timestamp}] 📊 Day-of service reminders completed: ${sentCount} sent | Took ${duration}ms`);

    return {
      sent: sentCount,
      duration,
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${timestamp}] ❌ Day-of service reminders failed after ${duration}ms:`, error.message);
    return { error: error.message, duration };
  }
};

/**
 * Send periodic reminders to providers for un-actioned pending bookings
 *
 * Runs every 30 minutes via cron
 * Scans bookings that are 'pending'
 * And created > 30 minutes ago
 * And last reminder was > 2 hours ago (or never)
 */
const sendPendingBookingReminders = async () => {
  const startTime = Date.now();
  const timestamp = getTimestamp();

  try {
    console.log(`[${timestamp}] 🔔 Checking for pending action reminders...`);

    const THIRTY_MINS_AGO = sql`NOW() - INTERVAL '30 minutes'`;
    const TWO_HOURS_AGO = sql`NOW() - INTERVAL '2 hours'`;

    const pendingBookings = await db
      .select({
        bookingId: bookings.id,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, 'pending'),
          sql`${bookings.createdAt} <= ${THIRTY_MINS_AGO}`,
          sql`(${bookings.lastPendingReminderAt} IS NULL OR ${bookings.lastPendingReminderAt} <= ${TWO_HOURS_AGO})`
        )
      );

    if (pendingBookings.length === 0) {
      console.log(`[${timestamp}] 📭 No pending action reminders needed`);
      return { sent: 0, duration: Date.now() - startTime };
    }

    console.log(`[${timestamp}] 📬 Found ${pendingBookings.length} bookings needing pending action reminders`);

    let sentCount = 0;

    for (const booking of pendingBookings) {
      try {
        await notificationTemplates.providerPendingActionReminder(booking.bookingId);

        await db
          .update(bookings)
          .set({ lastPendingReminderAt: sql`NOW()` })
          .where(eq(bookings.id, booking.bookingId));

        console.log(`[${timestamp}] ✅ Pending action reminder sent for booking ${booking.bookingId}`);
        sentCount++;
      } catch (error) {
        console.error(`[${timestamp}] ❌ Failed to send pending action reminder for booking ${booking.bookingId}:`, error.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[${timestamp}] 📊 Pending action reminders completed: ${sentCount} sent | Took ${duration}ms`);

    return { sent: sentCount, duration };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${timestamp}] ❌ Pending action reminders failed after ${duration}ms:`, error.message);
    return { error: error.message, duration };
  }
};

/**
 * Run all reminder services
 * Called by cron job
 */
const runAllReminders = async () => {
  const timestamp = getTimestamp();
  console.log(`[${timestamp}] 🔄 Starting reminder services...`);

  const results = {
    acceptReminders: null,
    upcomingReminders: null,
    dayOfReminders: null,
    pendingActionReminders: null,
  };

  // Send accept reminders to providers
  try {
    results.acceptReminders = await sendAcceptReminders();
  } catch (error) {
    results.acceptReminders = { error: error.message };
  }

  // Send upcoming service reminders to customers
  try {
    results.upcomingReminders = await sendUpcomingServiceReminders();
  } catch (error) {
    results.upcomingReminders = { error: error.message };
  }

  // Send day-of service reminders to customers & providers
  try {
    results.dayOfReminders = await sendDayOfReminders();
  } catch (error) {
    results.dayOfReminders = { error: error.message };
  }

  // Send pending action reminders to un-actioned providers
  try {
    results.pendingActionReminders = await sendPendingBookingReminders();
  } catch (error) {
    results.pendingActionReminders = { error: error.message };
  }

  console.log(`[${timestamp}] ✅ All reminder services completed`);

  return results;
};

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--accept')) {
    sendAcceptReminders()
      .then((result) => {
        if (!result.error) {
          console.log(`\n✅ Accept reminders complete: ${result.sent} sent`);
          process.exit(0);
        } else {
          console.error(`\n❌ Failed: ${result.error}`);
          process.exit(1);
        }
      });
  } else if (args.includes('--upcoming')) {
    sendUpcomingServiceReminders()
      .then((result) => {
        if (!result.error) {
          console.log(`\n✅ Upcoming reminders complete: ${result.sent} sent`);
          process.exit(0);
        } else {
          console.error(`\n❌ Failed: ${result.error}`);
          process.exit(1);
        }
      });
  } else {
    // Run all
    runAllReminders()
      .then((results) => {
        console.log('\n=== SUMMARY ===');
        console.log('Accept reminders:', results.acceptReminders);
        console.log('Upcoming reminders:', results.upcomingReminders);
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Error:', error);
        process.exit(1);
      });
  }
}

module.exports = {
  sendAcceptReminders,
  sendUpcomingServiceReminders,
  sendDayOfReminders,
  sendPendingBookingReminders,
  runAllReminders,
};
