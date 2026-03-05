/**
 * Debug Payment Lock
 *
 * Test endpoint to check why slots are being blocked
 */

const db = require("./config/db");
const { paymentIntents, bookings } = require("./models/schema");
const { eq, and, desc, gte } = require("drizzle-orm");

async function debugSlotLock({ slotId, serviceId, bookingDate }) {
  try {
    console.log("\n🔍 Debugging slot lock issue...\n");
    console.log(`Slot ID: ${slotId}`);
    console.log(`Service ID: ${serviceId}`);
    console.log(`Booking Date: ${bookingDate}\n`);

    // Check for pending payment intents
    console.log("1️⃣ Checking for PENDING payment intents...");
    const pendingIntents = await db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.slotId, slotId),
          eq(paymentIntents.serviceId, serviceId),
          eq(paymentIntents.status, "pending")
        )
      );

    console.log(`   Found ${pendingIntents.length} pending intents:`);
    pendingIntents.forEach((intent) => {
      const expiresAt = new Date(intent.expiresAt);
      const now = new Date();
      const isExpired = now > expiresAt;
      console.log(`   - Intent ${intent.id}:`);
      console.log(`     User: ${intent.userId}`);
      console.log(`     Expires: ${expiresAt}`);
      console.log(`     Expired: ${isExpired ? "YES ⚠️" : "NO"}`);
    });

    // Check for confirmed bookings
    console.log("\n2️⃣ Checking for CONFIRMED bookings...");
    const confirmedBookings = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.slotId, slotId),
          eq(bookings.serviceId, serviceId),
          eq(bookings.bookingDate, new Date(bookingDate))
        )
      );

    console.log(`   Found ${confirmedBookings.length} confirmed bookings:`);
    confirmedBookings.forEach((booking) => {
      console.log(`   - Booking ${booking.id}:`);
      console.log(`     User: ${booking.userId}`);
      console.log(`     Status: ${booking.status}`);
    });

    // Check ALL payment intents for this slot (regardless of status)
    console.log("\n3️⃣ Checking ALL payment intents for this slot...");
    const allIntents = await db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.slotId, slotId),
          eq(paymentIntents.serviceId, serviceId)
        )
      )
      .orderBy(desc(paymentIntents.createdAt))
      .limit(10);

    console.log(`   Found ${allIntents.length} total intents (recent 10):`);
    allIntents.forEach((intent) => {
      const expiresAt = new Date(intent.expiresAt);
      const now = new Date();
      const isExpired = now > expiresAt;
      console.log(`   - Intent ${intent.id}:`);
      console.log(`     Status: ${intent.status}`);
      console.log(`     User: ${intent.userId}`);
      console.log(`     Created: ${intent.createdAt}`);
      console.log(`     Expires: ${expiresAt}`);
      console.log(`     Expired: ${isExpired ? "YES" : "NO"}`);
    });

    console.log("\n✅ Debug complete\n");
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    process.exit(0);
  }
}

// Example usage: node debug-payment-lock.js <slotId> <serviceId> <bookingDate>
const args = process.argv.slice(2);
if (args.length !== 3) {
  console.log("Usage: node debug-payment-lock.js <slotId> <serviceId> <bookingDate>");
  console.log("Example: node debug-payment-lock.js 351 9 2026-03-07");
  process.exit(1);
}

debugSlotLock({
  slotId: parseInt(args[0]),
  serviceId: parseInt(args[1]),
  bookingDate: args[2],
});
