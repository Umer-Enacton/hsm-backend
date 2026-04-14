/**
 * Reminder Service
 * Sends automated reminders for:
 * 1. Upcoming services (reminder to customers)
 */

const db = require("../config/db");
const { bookings, slots, services, users } = require("../models/schema");
const { eq, and, sql, gte, lte } = require("drizzle-orm");
const { notificationTemplates } = require("./notificationHelper");

/**
 * Get current timestamp in readable format
 */
const getTimestamp = () => {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
};


/**
 * Send upcoming service reminders to customers AND providers
 * Reminds both parties about scheduled services
 *
 * Runs every 30 minutes via cron
 * Sends reminders for bookings happening tomorrow (20-28 hours from now)
 * Only sends if reminder hasn't been sent yet
 */
const sendUpcomingServiceReminders = async () => {
  const startTime = Date.now();
  const timestamp = getTimestamp();

  try {
    console.log(
      `[${timestamp}] 🔔 Checking for upcoming services needing reminders...`,
    );

    // Find confirmed bookings that:
    // 1. Are scheduled for tomorrow (between 20-28 hours from now)
    // 2. Haven't had upcoming reminder sent yet
    const TOMORROW_START = sql`NOW() + INTERVAL '20 hours'`;
    const TOMORROW_END = sql`NOW() + INTERVAL '28 hours'`;

    // Combine booking date with slot time using PostgreSQL date arithmetic
    const bookingDateTime = sql`CAST(${bookings.bookingDate} AS date) + ${slots.startTime}`;

    // Get businessProfiles to access providerId
    const {
      businessProfiles: businessProfilesTable,
    } = require("../models/schema");

    // Alias users table for customer and provider
    const customerUsers = sql`${users} AS customer_users`;
    const providerUsers = sql`${users} AS provider_users`;

    const upcomingBookings = await db
      .select({
        bookingId: bookings.id,
        customerId: bookings.customerId,
        customerName: sql`customer_users.name`,
        businessProfileId: bookings.businessProfileId,
        providerId: businessProfilesTable.providerId,
        providerName: sql`provider_users.name`,
        serviceName: services.name,
        bookingDate: bookings.bookingDate,
        slotTime: slots.startTime,
        reminderSent: bookings.upcomingReminderSent,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .innerJoin(
        businessProfilesTable,
        eq(bookings.businessProfileId, businessProfilesTable.id),
      )
      .innerJoin(
        sql`${users} AS customer_users`,
        eq(bookings.customerId, sql`customer_users.id`),
      )
      .innerJoin(
        sql`${users} AS provider_users`,
        eq(businessProfilesTable.providerId, sql`provider_users.id`),
      )
      .where(
        and(
          eq(bookings.status, "confirmed"),
          eq(bookings.upcomingReminderSent, false),
          // Booking time is tomorrow (20-28 hours from now gives a good window)
          sql`${bookingDateTime} >= ${TOMORROW_START}`,
          sql`${bookingDateTime} <= ${TOMORROW_END}`,
        ),
      );

    if (upcomingBookings.length === 0) {
      console.log(`[${timestamp}] 📭 No upcoming services needing reminders`);
      return {
        processed: 0,
        sent: 0,
        notified: [],
        duration: Date.now() - startTime,
      };
    }

    console.log(
      `[${timestamp}] 📬 Found ${upcomingBookings.length} upcoming services needing reminders`,
    );

    let sentCount = 0;
    const notified = []; // Track who was notified

    for (const booking of upcomingBookings) {
      try {
        // Send notification to customer
        await notificationTemplates.upcomingService(booking.bookingId);

        // Send notification to provider
        await notificationTemplates.providerUpcomingService(booking.bookingId);

        // Mark reminder as sent
        await db
          .update(bookings)
          .set({ upcomingReminderSent: true })
          .where(eq(bookings.id, booking.bookingId));

        console.log(
          `[${timestamp}] ✅ Upcoming reminders sent for booking ${booking.bookingId} - Customer: ${booking.customerName} (ID: ${booking.customerId}), Provider: ${booking.providerName} (ID: ${booking.providerId})`,
        );
        sentCount++;

        // Track who was notified with names
        notified.push({
          bookingId: booking.bookingId,
          serviceName: booking.serviceName,
          customer: { id: booking.customerId, name: booking.customerName },
          provider: { id: booking.providerId, name: booking.providerName },
        });
      } catch (error) {
        console.error(
          `[${timestamp}] ❌ Failed to send reminder for booking ${booking.bookingId}:`,
          error.message,
        );
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[${timestamp}] 📊 Upcoming service reminders completed: ${sentCount} bookings, ${sentCount * 2} notifications | Took ${duration}ms`,
    );

    return {
      processed: upcomingBookings.length,
      sent: sentCount * 2, // Count both customer + provider notifications
      notified,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `[${timestamp}] ❌ Upcoming service reminders failed after ${duration}ms:`,
      error.message,
    );
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
    console.log(
      `[${timestamp}] 🔔 Checking for day-of services needing reminders...`,
    );

    const NOW = sql`NOW()`;
    const TWELVE_HOURS_FROM_NOW = sql`NOW() + INTERVAL '12 hours'`;

    // Combine booking date with slot time using PostgreSQL date arithmetic
    const bookingDateTime = sql`CAST(${bookings.bookingDate} AS date) + ${slots.startTime}`;

    // Get businessProfiles to access providerId
    const {
      businessProfiles: businessProfilesTable,
    } = require("../models/schema");

    // Alias users table for customer and provider
    const customerUsers = sql`${users} AS customer_users`;
    const providerUsers = sql`${users} AS provider_users`;

    const dayOfBookings = await db
      .select({
        bookingId: bookings.id,
        customerId: bookings.customerId,
        customerName: sql`customer_users.name`,
        businessProfileId: bookings.businessProfileId,
        providerId: businessProfilesTable.providerId,
        providerName: sql`provider_users.name`,
        serviceName: services.name,
        bookingDate: bookings.bookingDate,
        slotTime: slots.startTime,
        reminderSent: bookings.dayOfReminderSent,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .innerJoin(
        businessProfilesTable,
        eq(bookings.businessProfileId, businessProfilesTable.id),
      )
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .innerJoin(
        sql`${users} AS customer_users`,
        eq(bookings.customerId, sql`customer_users.id`),
      )
      .innerJoin(
        sql`${users} AS provider_users`,
        eq(businessProfilesTable.providerId, sql`provider_users.id`),
      )
      .where(
        and(
          eq(bookings.status, "confirmed"),
          eq(bookings.dayOfReminderSent, false),
          sql`${bookingDateTime} >= ${NOW}`,
          sql`${bookingDateTime} <= ${TWELVE_HOURS_FROM_NOW}`,
        ),
      );

    if (dayOfBookings.length === 0) {
      console.log(`[${timestamp}] 📭 No day-of services needing reminders`);
      return {
        processed: 0,
        sent: 0,
        notified: [],
        duration: Date.now() - startTime,
      };
    }

    console.log(
      `[${timestamp}] 📬 Found ${dayOfBookings.length} day-of services needing reminders`,
    );

    let sentCount = 0;
    const notified = []; // Track who was notified

    for (const booking of dayOfBookings) {
      try {
        await notificationTemplates.dayOfReminderCustomer(booking.bookingId);
        await notificationTemplates.dayOfReminderProvider(booking.bookingId);

        await db
          .update(bookings)
          .set({ dayOfReminderSent: true })
          .where(eq(bookings.id, booking.bookingId));

        console.log(
          `[${timestamp}] ✅ Day-of reminders sent for booking ${booking.bookingId} - Customer: ${booking.customerName} (ID: ${booking.customerId}), Provider: ${booking.providerName} (ID: ${booking.providerId})`,
        );
        sentCount += 2;

        // Track who was notified with names
        notified.push({
          bookingId: booking.bookingId,
          serviceName: booking.serviceName,
          customer: { id: booking.customerId, name: booking.customerName },
          provider: { id: booking.providerId, name: booking.providerName },
        });
      } catch (error) {
        console.error(
          `[${timestamp}] ❌ Failed to send day-of reminder for booking ${booking.bookingId}:`,
          error.message,
        );
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[${timestamp}] 📊 Day-of service reminders completed: ${sentCount} notifications for ${dayOfBookings.length} bookings | Took ${duration}ms`,
    );

    return {
      processed: dayOfBookings.length,
      sent: sentCount,
      notified,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `[${timestamp}] ❌ Day-of service reminders failed after ${duration}ms:`,
      error.message,
    );
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
    upcomingReminders: null,
    dayOfReminders: null,
  };

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

  console.log(`[${timestamp}] ✅ All reminder services completed`);

  return results;
};

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--upcoming")) {
    sendUpcomingServiceReminders().then((result) => {
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
        console.log("\n=== SUMMARY ===");
        console.log("Accept reminders:", results.acceptReminders);
        console.log("Upcoming reminders:", results.upcomingReminders);
        process.exit(0);
      })
      .catch((error) => {
        console.error("\n❌ Error:", error);
        process.exit(1);
      });
  }
}

module.exports = {
  sendUpcomingServiceReminders,
  sendDayOfReminders,
  runAllReminders,
};
