/**
 * Apply booking status restructure migration
 */

require("dotenv").config();
const db = require("./config/db");

async function applyMigration() {
  console.log("🔄 Applying booking status restructure migration...\n");

  try {
    // 1. Create provider_reschedule_settings table
    console.log("1. Creating provider_reschedule_settings table...");
    await db.execute(`
      CREATE TABLE IF NOT EXISTS provider_reschedule_settings (
        id SERIAL PRIMARY KEY,
        provider_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        allow_reschedule BOOLEAN DEFAULT true NOT NULL,
        max_reschedules INTEGER DEFAULT 3 NOT NULL,
        fee_1 INTEGER DEFAULT 5 NOT NULL,
        fee_2 INTEGER DEFAULT 10 NOT NULL,
        fee_3 INTEGER DEFAULT 15 NOT NULL,
        cancellation_hours INTEGER DEFAULT 24 NOT NULL,
        refund_pending_full INTEGER DEFAULT 100 NOT NULL,
        refund_confirmed_partial INTEGER DEFAULT 80 NOT NULL,
        refund_pending_late INTEGER DEFAULT 90 NOT NULL,
        refund_confirmed_late INTEGER DEFAULT 70 NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    console.log("✅ provider_reschedule_settings table created");

    // 2. Add new columns to bookings table
    console.log("\n2. Adding new columns to bookings table...");

    const columns = [
      { name: "reschedule_count", sql: "INTEGER DEFAULT 0 NOT NULL" },
      { name: "last_reschedule_fee", sql: "INTEGER" },
      { name: "is_refunded", sql: "BOOLEAN DEFAULT false NOT NULL" },
      { name: "cancelled_at", sql: "TIMESTAMP" },
      { name: "cancellation_reason", sql: "VARCHAR(500)" },
      { name: "cancelled_by", sql: "VARCHAR(20)" },
    ];

    for (const col of columns) {
      try {
        await db.execute(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ${col.name} ${col.sql}`);
        console.log(`   ✅ Added column: ${col.name}`);
      } catch (e) {
        console.log(`   ℹ️ Column ${col.name} may already exist: ${e.message}`);
      }
    }

    // 3. Create indexes
    console.log("\n3. Creating indexes...");
    try {
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_bookings_reschedule_count ON bookings(reschedule_count)`);
      console.log("   ✅ Created index: idx_bookings_reschedule_count");
    } catch (e) {
      console.log(`   ℹ️ Index may already exist`);
    }

    try {
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_bookings_is_refunded ON bookings(is_refunded)`);
      console.log("   ✅ Created index: idx_bookings_is_refunded");
    } catch (e) {
      console.log(`   ℹ️ Index may already exist`);
    }

    // 4. Initialize default settings for existing providers
    console.log("\n4. Initializing default settings for existing providers...");
    const result = await db.execute(`
      INSERT INTO provider_reschedule_settings (provider_id)
      SELECT DISTINCT u.id
      FROM users u
      INNER JOIN business_profiles bp ON u.id = bp.provider_id
      WHERE NOT EXISTS (
        SELECT 1 FROM provider_reschedule_settings prs WHERE prs.provider_id = u.id
      )
    `);
    console.log(`   ✅ Initialized settings for ${result.rowCount || 'existing'} providers`);

    // 5. Update existing bookings with default values
    console.log("\n5. Updating existing bookings with default values...");
    await db.execute(`
      UPDATE bookings
      SET reschedule_count = COALESCE(reschedule_count, 0),
          is_refunded = COALESCE(is_refunded, false)
      WHERE reschedule_count IS NULL OR is_refunded IS NULL
    `);
    console.log("   ✅ Updated existing bookings");

    console.log("\n✨ Migration completed successfully!\n");

  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

applyMigration()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
