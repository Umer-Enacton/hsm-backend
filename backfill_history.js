const db = require("./config/db");
const { bookings, bookingHistory } = require("./models/schema");
const { logBookingHistory } = require("./utils/historyHelper");

async function backfill() {
  console.log("Starting booking history backfill...");
  try {
    const allBookings = await db.select().from(bookings);
    console.log(`Found ${allBookings.length} bookings.`);

    for (const b of allBookings) {
      // 1. Initial Creation Event
      await logBookingHistory(
        b.id,
        "booked",
        "Booking was created successfully.",
        "system",
        b.customerId
      );

      // 2. Reschedules (approximate)
      if (b.rescheduleCount > 0 && b.rescheduledAt) {
        await logBookingHistory(
          b.id,
          "reschedule_requested",
          "Reschedule requested.",
          b.rescheduledBy || "system",
          b.rescheduledBy === "customer" ? b.customerId : null
        );

        if (b.rescheduleOutcome === "accepted") {
          await logBookingHistory(
            b.id,
            "reschedule_accepted",
            "Provider accepted the requested reschedule.",
            "provider",
            null
          );
        } else if (b.rescheduleOutcome === "rejected") {
          await logBookingHistory(
            b.id,
            "reschedule_rejected",
            "Provider rejected the requested reschedule.",
            "provider",
            null
          );
        }
      }

      // 3. Status explicit events
      if (b.status === "confirmed") {
        await logBookingHistory(
          b.id,
          "confirmed",
          "Booking was confirmed by provider.",
          "provider",
          null
        );
      }

      if (b.status === "cancelled") {
        await logBookingHistory(
          b.id,
          "cancelled",
          `Booking was cancelled by ${b.cancelledBy || "system"}. Reason: ${b.cancellationReason || "Unknown"}`,
          b.cancelledBy || "system",
          b.cancelledBy === "customer" ? b.customerId : null
        );
      }

      if (b.status === "rejected") {
        await logBookingHistory(
          b.id,
          "rejected",
          "Booking was rejected by provider.",
          "provider",
          null
        );
      }

      if (b.status === "completed") {
        // Assume confirmed as prior step if it's completed
        await logBookingHistory(
           b.id,
           "confirmed",
           "Booking was confirmed by provider.",
           "provider",
           null
        );
        await logBookingHistory(
          b.id,
          "completed",
          "Booking was marked as completed.",
          "provider",
          null
        );
      }

      if (b.isRefunded) {
        await logBookingHistory(
          b.id,
          "refunded",
          "A refund was issued for this booking.",
          "system",
          null
        );
      }
    }
    console.log("Backfill complete!");
  } catch (error) {
    console.error("Backfill failed:", error);
  }
}

backfill().then(() => process.exit(0));
