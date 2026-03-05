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

    // Import each table
    for (const [tableName, rows] of Object.entries(data)) {
      if (rows.length === 0) continue;

      console.log(`\n📥 Importing ${tableName}...`);

      // Get column names from first row
      const columns = Object.keys(rows[0]);

      for (const row of rows) {
        const columnNames = columns.map(col => `"${col}"`).join(', ');
        const values = columns.map(col => {
          const val = row[col];
          if (val === null) return 'NULL';
          if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
          if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
          return val;
        }).join(', ');

        try {
          await client.query(`
            INSERT INTO "${tableName}" (${columnNames})
            VALUES (${values})
            ON CONFLICT DO NOTHING
          `);
        } catch (error) {
          console.error(`  ❌ Error inserting row: ${error.message}`);
        }
      }

      console.log(`  ✓ Imported ${rows.length} rows`);
    }

    console.log('\n✅ Migration complete!');
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
  } catch (error) {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
runMigration();
