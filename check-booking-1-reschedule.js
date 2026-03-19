const db = require('./config/db');
const { bookings } = require('./models/schema');
const { eq } = require('drizzle-orm');

(async () => {
  try {
    // Get booking #1 with ALL fields
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, 1));

    if (!booking) {
      console.log('❌ Booking #1 not found');
      process.exit(1);
    }

    console.log('📋 Booking #1 ALL fields:');
    console.log(JSON.stringify(booking, null, 2));

    console.log('\n🔍 Reschedule-specific fields:');
    console.log('   rescheduleOutcome:', booking.rescheduleOutcome);
    console.log('   previousSlotId:', booking.previousSlotId);
    console.log('   previousSlotTime:', booking.previousSlotTime);
    console.log('   previousBookingDate:', booking.previousBookingDate);
    console.log('   rescheduleReason:', booking.rescheduleReason);
    console.log('   rescheduleCount:', booking.rescheduleCount);
    console.log('   lastRescheduleFee:', booking.lastRescheduleFee);
    console.log('   rescheduledBy:', booking.rescheduledBy);
    console.log('   rescheduleBookingDate:', booking.rescheduleBookingDate);
    console.log('   rescheduleSlotTime:', booking.rescheduleSlotTime);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
