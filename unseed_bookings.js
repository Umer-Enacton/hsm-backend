const db = require("./config/db");
const { bookings, notifications } = require("./models/schema");
const { inArray } = require("drizzle-orm");

const CUSTOMER_IDS = [2, 9, 18];

async function forceUnseed() {
  console.log(`Unseeding all bookings for customer IDs: ${CUSTOMER_IDS.join(", ")}`);
  
  // Wipe bookings
  const b = await db.delete(bookings).where(inArray(bookings.customerId, CUSTOMER_IDS)).returning();
  console.log(`Deleted ${b.length} bookings and all cascaded related records.`);

  // Wipe notifications for customers and providers
  const ALL_IDS = [2, 9, 18, 4, 3, 6];
  const n = await db.delete(notifications).where(inArray(notifications.userId, ALL_IDS)).returning();
  console.log(`Deleted ${n.length} notifications.`);

  // Reset ratings to 0 ONLY on services
  await db.execute(`UPDATE services SET rating = 0, total_reviews = 0`);
  console.log("Reset all ratings to 0 on services.");
  
  process.exit(0);
}

forceUnseed().catch(err => {
  console.error(err);
  process.exit(1);
});
