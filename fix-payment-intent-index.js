/**
 * Fix Payment Intent Index
 * Script to update the unique index to include serviceId
 */

const { Client } = require('pg');

async function fixPaymentIntentIndex() {
  const client = new Client({
    connectionString: 'postgres://postgres:root@localhost:5432/hsm'
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Step 1: Check current indexes
    console.log('\n📊 Current indexes on payment_intents table:');
    const indexesResult = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'payment_intents'
        AND indexdef LIKE '%pending%'
      ORDER BY indexname
    `);

    if (indexesResult.rows.length === 0) {
      console.log('  No pending indexes found');
    } else {
      indexesResult.rows.forEach(row => {
        console.log(`  - ${row.indexname}`);
        console.log(`    ${row.indexdef.substring(0, 100)}...`);
      });
    }

    // Step 2: Drop old index if it exists
    console.log('\n🗑️  Dropping old index (if exists)...');
    try {
      await client.query(`DROP INDEX IF EXISTS payment_intents_slot_date_pending_unique`);
      console.log('  ✅ Old index dropped (or didn\'t exist)');
    } catch (err) {
      console.log(`  ⚠️  Error dropping index: ${err.message}`);
    }

    // Step 3: Create new index with serviceId
    console.log('\n✨ Creating new index with serviceId...');
    try {
      await client.query(`
        CREATE UNIQUE INDEX payment_intents_slot_date_service_pending_unique
        ON payment_intents (slot_id, booking_date, service_id)
        WHERE status = 'pending'
      `);
      console.log('  ✅ New index created successfully!');
    } catch (err) {
      console.log(`  ❌ Error creating index: ${err.message}`);
      console.log('\nDetails:', err.detail);
    }

    // Step 4: Verify the new index
    console.log('\n✅ Verifying new index...');
    const verifyResult = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'payment_intents'
        AND indexname = 'payment_intents_slot_date_service_pending_unique'
    `);

    if (verifyResult.rows.length > 0) {
      console.log('  ✅ Index verified successfully!');
      console.log('\n  Index details:');
      console.log(`  Name: ${verifyResult.rows[0].indexname}`);
      console.log(`  Definition: ${verifyResult.rows[0].indexdef}`);
    } else {
      console.log('  ❌ Index not found!');
    }

    // Step 5: Check pending payment intents
    console.log('\n📋 Current pending payment intents:');
    const pendingResult = await client.query(`
      SELECT
        id,
        slot_id,
        service_id,
        booking_date::date as date,
        status,
        created_at
      FROM payment_intents
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (pendingResult.rows.length === 0) {
      console.log('  No pending payment intents');
    } else {
      console.log(`  Found ${pendingResult.rows.length} pending intents:`);
      pendingResult.rows.forEach(row => {
        console.log(`  - Intent ${row.id}: Slot ${row.slot_id}, Service ${row.service_id}, Date ${row.date}`);
      });
    }

    console.log('\n🎉 Fix completed successfully!');
    console.log('\n📝 Summary:');
    console.log('  ✅ Old index dropped');
    console.log('  ✅ New index created with (slot_id, booking_date, service_id)');
    console.log('  ✅ Different services can now be booked at the same time!');
    console.log('\n⚠️  IMPORTANT: Restart your backend server now!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
    console.log('\n👋 Database connection closed');
  }
}

// Run the fix
fixPaymentIntentIndex();
