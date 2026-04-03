require("dotenv").config();
const { drizzle } = require("drizzle-orm/node-postgres");
const { Pool } = require("pg");
const { eq } = require("drizzle-orm");
const { bookings } = require("../models/schema");

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool);

  try {
    console.log("Starting migration: replacing 'rejected' status with 'cancelled'...");
    
    // Find how many rejected bookings exist
    const rejectedBookings = await db.select().from(bookings).where(eq(bookings.status, "rejected"));
    console.log(`Found ${rejectedBookings.length} booking(s) with 'rejected' status.`);

    if (rejectedBookings.length > 0) {
      // Update them
      const result = await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.status, "rejected")).returning();
      console.log(`Successfully updated ${result.length} booking(s) to 'cancelled'.`);
    } else {
      console.log("No bookings needed updating.");
    }
    
    console.log("Migration complete.");
  } catch (error) {
    console.error("Error during migration:", error);
  } finally {
    pool.end();
  }
}

main();
