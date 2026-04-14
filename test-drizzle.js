// Reproduce the error from auto-assign-staff cron
const db = require('./config/db');
const { bookings, staff, slots, services, businessProfiles, users, staffLeave, staffAssignmentTracking } = require('./models/schema');
const { eq, and, isNull, inArray, count, sql, desc } = require('drizzle-orm');

async function test() {
  try {
    const ONE_HOUR_FROM_NOW = sql`NOW() + INTERVAL '1 hour'`;
    const bookingDateTime = sql`CAST(${bookings.bookingDate} AS date) + ${slots.startTime}`;

    const bookingsToAssign = await db
      .select({
        bookingId: bookings.id,
        businessProfileId: bookings.businessProfileId,
        slotId: bookings.slotId,
        bookingDate: bookings.bookingDate,
        totalPrice: bookings.totalPrice,
        slotStartTime: slots.startTime,
        providerId: businessProfiles.providerId,
        providerName: users.name,
        providerEmail: users.email,
        serviceName: services.name,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .innerJoin(
        businessProfiles,
        eq(bookings.businessProfileId, businessProfiles.id),
      )
      .innerJoin(users, eq(businessProfiles.providerId, users.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(
        and(
          eq(bookings.status, "confirmed"),
          isNull(bookings.assignedStaffId),
        ),
      );

    console.log(`Found ${bookingsToAssign.length} bookings`);
    
    for (const booking of bookingsToAssign) {
      console.log(`\nProcessing booking ${booking.bookingId}, businessProfileId: ${booking.businessProfileId}`);
      
      try {
        // Get active staff
        const activeStaff = await db
          .select()
          .from(staff)
          .where(and(
            eq(staff.businessProfileId, booking.businessProfileId),
            eq(staff.status, "active"),
          ));
        
        console.log(`Active staff: ${activeStaff.length}`);
        if (activeStaff.length === 0) {
          console.log('No active staff, skipping');
          continue;
        }

        const bookingDate = booking.bookingDate.toISOString().split("T")[0];
        console.log('bookingDate string:', bookingDate);

        // Filter out staff on leave
        const staffOnLeave = await db
          .select({ staffId: staffLeave.staffId })
          .from(staffLeave)
          .where(and(
            eq(staffLeave.businessProfileId, booking.businessProfileId),
            eq(staffLeave.status, "approved"),
            sql`${staffLeave.startDate} <= ${bookingDate} AND ${staffLeave.endDate} >= ${bookingDate}`,
          ));

        console.log(`Staff on leave: ${staffOnLeave.length}`);

        const leaveStaffIds = new Set(staffOnLeave.map((l) => l.staffId));
        const availableStaff = activeStaff.filter((s) => !leaveStaffIds.has(s.id));
        console.log(`Available staff: ${availableStaff.length}`);

        if (availableStaff.length === 0) {
          console.log('All staff on leave, skipping');
          continue;
        }

        // Count today's bookings for each available staff
        const staffBookingCounts = [];
        for (const s of availableStaff) {
          console.log(`Checking count for staff ${s.id}, date: ${bookingDate}`);
          const [countResult] = await db
            .select({ count: count() })
            .from(bookings)
            .where(and(
              eq(bookings.assignedStaffId, s.id),
              eq(bookings.bookingDate, bookingDate),
              inArray(bookings.status, ["confirmed", "reschedule_pending"]),
            ));

          console.log('Count result:', countResult);
          staffBookingCounts.push({
            staffId: s.id,
            count: countResult.count || 0,
          });
        }

        console.log('Staff booking counts:', staffBookingCounts);
        
        // Find staff with minimum bookings
        const minCount = Math.min(...staffBookingCounts.map((s) => s.count));
        console.log('Min count:', minCount);
        
      } catch (error) {
        console.error(`Error for booking ${booking.bookingId}:`, error.message);
        console.error('Stack:', error.stack);
      }
    }

  } catch (error) {
    console.error('OUTER ERROR:', error.message);
    console.error('Stack:', error.stack);
  }

  process.exit(0);
}

test();
