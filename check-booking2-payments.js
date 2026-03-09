require("dotenv").config();
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const { payments } = require("./models/schema");
const { eq, desc, and } = require("drizzle-orm");

const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString);
const db = drizzle(client);

async function checkPayments() {
  console.log("\n=== PAYMENTS FOR BOOKING 2 WITH refundId=null ===\n");

  const paymentsFound = await db
    .select()
    .from(payments)
    .where(and(eq(payments.bookingId, 2), eq(payments.refundId, null)))
    .orderBy(desc(payments.createdAt))
    .limit(5);

  console.log(`Found ${paymentsFound.length} payments\n`);

  for (const p of paymentsFound) {
    console.log(`  ID: ${p.id}, Amount: ₹${p.amount / 100}, Created: ${p.createdAt.toISOString()}`);
  }

  await client.end();
  process.exit(0);
}

checkPayments().catch(console.error);
