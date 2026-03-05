/**
 * Apply payment intent index migration
 */

const db = require("./config/db");
const { sql } = require("drizzle-orm");

async function applyMigration() {
  try {
    console.log("🔄 Applying payment intent unique index migration...\n");

    // Drop old index
    console.log("1️⃣ Dropping old index (payment_intents_slot_date_service_pending_unique)...");
    await db.execute(sql`
      DROP INDEX IF EXISTS payment_intents_slot_date_service_pending_unique;
    `);
    console.log("✅ Old index dropped\n");

    // Create new index
    console.log("2️⃣ Creating new index (payment_intents_slot_date_pending_unique)...");
    await db.execute(sql`
      CREATE UNIQUE INDEX payment_intents_slot_date_pending_unique
      ON payment_intents (slot_id, booking_date)
      WHERE status = 'pending';
    `);
    console.log("✅ New index created\n");

    console.log("✅ Migration applied successfully!");
    console.log("📝 Summary:");
    console.log("   - Payment intents now lock slots for ALL services");
    console.log("   - Confirmed bookings can still share slots across services");
    console.log("   - This prevents race conditions during payment flow\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

applyMigration();
