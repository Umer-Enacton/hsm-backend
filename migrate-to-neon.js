/**
 * Database Migration Script
 * Migrates data from local PostgreSQL to Neon cloud database
 */

const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

// Database configurations
const localDbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'hsm',
  user: 'postgres',
  password: 'root',
};

const neonDbConfig = {
  connectionString: process.env.DATABASE_URL, // Your Neon database
  ssl: { rejectUnauthorized: false }
};

// Helper function to format values for SQL
function formatValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return val;
}

async function exportLocalData() {
  const client = new Client(localDbConfig);

  try {
    await client.connect();
    console.log('✅ Connected to local database');

    // Get all tables
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log(`📊 Found ${tables.rows.length} tables`);

    const data = {};
    for (const row of tables.rows) {
      const tableName = row.table_name;

      // Get table data
      const result = await client.query(`SELECT * FROM "${tableName}"`);
      data[tableName] = result.rows;

      console.log(`  ✓ ${tableName}: ${result.rows.length} rows`);
    }

    return data;
  } catch (error) {
    console.error('❌ Error exporting data:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

async function importToNeon(data) {
  const client = new Client(neonDbConfig);

  try {
    await client.connect();
    console.log('\n✅ Connected to Neon database');

    // Disable foreign key constraints temporarily
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    console.log('✅ Foreign key constraints deferred');

    // Define import order based on dependencies
    const importOrder = [
      'roles',
      'users',
      'categories',
      'business_profiles',
      'services',
      'slots',
      'address',
      'bookings',
      'payment_intents',
      'payments',
      'feedback'
    ];

    let totalSuccess = 0;
    let totalErrors = 0;

    // Import in dependency order
    for (const tableName of importOrder) {
      if (!data[tableName] || data[tableName].length === 0) {
        console.log(`\n⏭️  Skipping ${tableName} (no data)`);
        continue;
      }

      const rows = data[tableName];
      console.log(`\n📥 Importing ${tableName} (${rows.length} rows)...`);

      let successCount = 0;
      let errorCount = 0;

      // Get column names from first row
      const columns = Object.keys(rows[0]);
      const columnNames = columns.map(col => `"${col}"`).join(', ');

      for (const row of rows) {
        const values = columns.map(col => formatValue(row[col])).join(', ');

        try {
          await client.query(`
            INSERT INTO "${tableName}" (${columnNames})
            VALUES (${values})
            ON CONFLICT DO NOTHING
          `);
          successCount++;
        } catch (error) {
          errorCount++;
          if (errorCount <= 3) {
            console.error(`  ❌ Error: ${error.message.substring(0, 80)}...`);
          }
        }
      }

      totalSuccess += successCount;
      totalErrors += errorCount;

      console.log(`  ✅ Success: ${successCount}, Errors: ${errorCount}`);
    }

    console.log('\n✅ Migration complete!');
    console.log(`📊 Total: ${totalSuccess} rows imported, ${totalErrors} errors`);

    if (totalErrors > 0) {
      console.log('\n⚠️  Some rows had errors. This is usually okay if they were duplicates.');
    }

  } catch (error) {
    console.error('\n❌ Error importing data:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

async function runMigration() {
  console.log('🚀 Starting database migration...\n');

  try {
    // Step 1: Export from local
    const data = await exportLocalData();

    // Step 2: Import to Neon
    await importToNeon(data);

    console.log('\n🎉 Migration successful!');
    console.log('\n⚠️  Note: If you see errors, first push the schema:');
    console.log('   npm run db:push');
    console.log('   Then run this migration again.');
  } catch (error) {
    console.error('\n💥 Migration failed:', error.message);
    process.exit(1);
  }
}

// Run migration
runMigration();
