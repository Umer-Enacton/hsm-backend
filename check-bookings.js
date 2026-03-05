/**
 * Check Recent Bookings
 *
 * This script shows recent bookings to see if slots are being blocked by confirmed bookings.
 */

const db = require("./config/db");
const { bookings, slots, services } = require("./models/schema");
const { eq, desc, and } = require("drizzle-orm");

async function checkRecentBookings() {
  try {
    console.log("🔍 Fetching recent bookings from database...\n");

    const recentBookings = await db
      .select({
        bookingId: bookings.id,
        slotId: bookings.slotId,
        serviceId: bookings.serviceId,
        userId: bookings.userId,
        bookingDate: bookings.bookingDate,
        status: bookings.status,
        createdAt: bookings.createdAt,
        slotStartTime: slots.startTime,
        serviceId: services.id,
      })
      .from(bookings)
      .leftJoin(slots, eq(bookings.slotId, slots.id))
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .orderBy(desc(bookings.createdAt))
      .limit(20);

    if (recentBookings.length === 0) {
      console.log("✅ No bookings found in database.");
      return;
    }

    console.log(`📊 Found ${recentBookings.length} recent bookings:\n`);

    recentBookings.forEach((booking, index) => {
      console.log(`${index + 1}. Booking ID: ${booking.bookingId}`);
      console.log(`   Status: ${booking.status}`);
      console.log(`   Slot ID: ${booking.slotId}`);
      console.log(`   Service ID: ${booking.serviceId}`);
      console.log(`   User ID: ${booking.userId}`);
      console.log(`   Booking Date: ${booking.bookingDate}`);
      console.log(`   Created: ${booking.createdAt}`);
      console.log("");
    });

    // Count by status
    const statusCounts = recentBookings.reduce((acc, booking) => {
      acc[booking.status] = (acc[booking.status] || 0) + 1;
      return acc;
    }, {});

    console.log("\n📈 Status Distribution:");
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`);
    });
  } catch (error) {
    console.error("❌ Error checking bookings:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

checkRecentBookings();
