/**
 * Manual test script to check and auto-reject expired bookings
 * Run with: node utils/checkExpiredBookings.js
 */

require("dotenv").config();
const { autoRejectExpiredBookings, getBookingsAboutToExpire } = require("./autoRejectExpiredBookings");

async function main() {
  console.log("=== Checking for expired pending bookings ===\n");

  try {
    // Check for bookings about to expire (for reminders)
    console.log("1. Bookings about to expire in next 2 hours:");
    const expiringSoon = await getBookingsAboutToExpire(2);
    console.log(`   Found: ${expiringSoon.length} bookings\n`);
    expiringSoon.forEach((b) => {
      console.log(`   - Booking #${b.bookingId}: ${b.serviceName} at ${b.slotTime} on ${b.bookingDate}`);
    });

    console.log("\n2. Processing expired bookings:");
    const results = await autoRejectExpiredBookings();
    console.log("\n=== Summary ===");
    console.log(`Processed: ${results.processed}`);
    console.log(`Rejected: ${results.rejected}`);
    console.log(`Refunded: ${results.refunded}`);
    if (results.errors.length > 0) {
      console.log(`Errors: ${results.errors.length}`);
      results.errors.forEach((err) => console.log(`   - ${JSON.stringify(err)}`));
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
