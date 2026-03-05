/**
 * Revert payment intent index - restore serviceId
 */

const db = require("./config/db");
const { sql } = require("drizzle-orm");

async function revertMigration() {
  try {
    console.log("🔄 Reverting payment intent index migration...\n");

    // Drop new index
    console.log("1️⃣ Dropping new index (payment_intents_slot_date_pending_unique)...");
    await db.execute(sql`
      DROP INDEX IF EXISTS payment_intents_slot_date_pending_unique;
    `);
    console.log("✅ New index dropped\n");

    // Restore old index with serviceId
    console.log("2️⃣ Restoring old index (payment_intents_slot_date_service_pending_unique)...");
    await db.execute(sql`
      CREATE UNIQUE INDEX payment_intents_slot_date_service_pending_unique
      ON payment_intents (slot_id, booking_date, service_id)
      WHERE status = 'pending';
    `);
    console.log("✅ Old index restored with serviceId\n");

    console.log("✅ Migration reverted successfully!");
    console.log("📝 Summary:");
    console.log("   - Payment intents now lock slots PER SERVICE");
    console.log("   - Different services can be booked simultaneously at same slot");
    console.log("   - Example: Service A at 10 AM and Service B at 10 AM can both be booked\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

revertMigration();
