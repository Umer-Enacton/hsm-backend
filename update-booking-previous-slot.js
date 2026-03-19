const db = require('./config/db');
const schema = require('./models/schema');
const { eq } = require('drizzle-orm');

const { bookings, slots } = schema;

(async () => {
  try {
    // Get booking #2
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, 2));

    if (!booking) {
      console.log('Booking #2 not found');
      process.exit(1);
    }

    console.log('Current booking data:');
    console.log('- previousSlotId:', booking.previousSlotId);
    console.log('- previousBookingDate:', booking.previousBookingDate);
    console.log('- previousSlotTime:', booking.previousSlotTime);
    console.log('- slotId:', booking.slotId);
    console.log('- status:', booking.status);

    // If we have previousSlotId but no previousSlotTime, fetch the slot time
    if (booking.previousSlotId && !booking.previousSlotTime) {
      const [previousSlot] = await db.select({ startTime: slots.startTime })
        .from(slots)
        .where(eq(slots.id, booking.previousSlotId))
        .limit(1);

      if (previousSlot) {
        console.log('\nFound previous slot time:', previousSlot.startTime);

        // Update the booking
        await db.update(bookings)
          .set({ previousSlotTime: previousSlot.startTime })
          .where(eq(bookings.id, 2));

        console.log('✅ Updated booking #2 with previousSlotTime');
      } else {
        console.log('❌ Previous slot not found');
      }
    } else if (booking.previousSlotTime) {
      console.log('✅ previousSlotTime already exists:', booking.previousSlotTime);
    } else {
      console.log('⚠️ No previousSlotId found');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
