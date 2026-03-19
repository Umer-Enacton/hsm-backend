const db = require('./config/db');

(async () => {
  try {
    // Check if reschedule columns exist in bookings table
    const result = await db.execute(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'bookings'
      AND column_name IN (
        'reschedule_outcome',
        'previous_slot_id',
        'previous_slot_time',
        'previous_booking_date',
        'reschedule_reason',
        'reschedule_count',
        'last_reschedule_fee',
        'rescheduled_by',
        'reschedule_booking_date',
        'reschedule_slot_time'
      )
      ORDER BY column_name;
    `);

    console.log('📊 Reschedule columns in bookings table:');
    const rows = result.rows || result;
    if (!rows || rows.length === 0) {
      console.log('❌ NO RESCHEDULE COLUMNS FOUND!');
      console.log('');
      console.log('⚠️  You need to run: npm run db:push');
      console.log('   This will add the missing columns to the database.');
    } else {
      console.log('✅ Found columns:');
      rows.forEach(row => {
        console.log(`   - ${row.column_name}: ${row.data_type}`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
