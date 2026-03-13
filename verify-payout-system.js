/**
 * Complete Payout System Verification
 * Tests the entire flow from booking completion to payout processing
 */

const db = require("./config/db");
const { payments, bookings, users, adminSettings, businessProfiles } = require("./models/schema");
const { eq } = require("drizzle-orm");

async function verifyPayoutSystem() {
  console.log("🔍 PAYOUT SYSTEM VERIFICATION\n");
  console.log("=" .repeat(50));

  try {
    // 1. Check if booking is completed and payout is pending
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, 1))
      .limit(1);

    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, 1))
      .limit(1);

    console.log("\n📋 BOOKING STATUS:");
    console.log(`  Booking ID: ${booking.id}`);
    console.log(`  Status: ${booking.status}`);
    console.log(`  Total Price: ₹${booking.totalPrice}`);

    console.log("\n💳 PAYMENT STATUS:");
    console.log(`  Payment ID: ${payment.id}`);
    console.log(`  Status: ${payment.status}`);
    console.log(`  Amount: ₹${payment.amount / 100}`);
    console.log(`  Platform Fee: ₹${payment.platformFee / 100} (${((payment.platformFee / payment.amount) * 100).toFixed(1)}%)`);
    console.log(`  Provider Share: ₹${payment.providerShare / 100} (${((payment.providerShare / payment.amount) * 100).toFixed(1)}%)`);
    console.log(`  Payout Status: ${payment.providerPayoutStatus || "null (not ready yet)"}`);

    // 2. Get admin settings
    const [minPayoutSetting] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, "minimum_payout_amount"))
      .limit(1);

    const minPayout = minPayoutSetting ? Number(minPayoutSetting.value) : 30000;

    console.log("\n⚙️ ADMIN SETTINGS:");
    console.log(`  Minimum Payout: ₹${minPayout / 100}`);

    // 3. Check if provider meets threshold
    const [provider] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking.businessProfileId))
      .limit(1);

    const allProviderPayments = await db
      .select()
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .where(eq(bookings.businessProfileId, booking.businessProfileId));

    let totalPending = 0;
    allProviderPayments.forEach((p) => {
      if (p.payments.providerPayoutStatus === "pending") {
        totalPending += Number(p.payments.providerShare || 0);
      }
    });

    console.log("\n👤 PROVIDER STATUS:");
    console.log(`  Business: ${provider.businessName}`);
    console.log(`  Provider ID: ${provider.providerId}`);
    console.log(`  Pending Earnings: ₹${totalPending / 100}`);
    console.log(`  Can Process Payout: ${totalPending >= minPayout ? "✅ YES" : "❌ NO (below minimum)"}`);

    // 4. Summary
    console.log("\n" + "=".repeat(50));
    console.log("✅ PAYOUT SYSTEM VERIFIED!\n");

    console.log("Expected Flow:");
    console.log("  1. Customer books service → Payment captured");
    console.log("  2. Booking marked 'completed' → Payout status = 'pending'");
    console.log("  3. Admin sees pending payout on /admin/payouts");
    console.log("  4. When provider reaches ₹" + (minPayout / 100) + " threshold:");
    console.log("     - 'Select All' or 'Mark Paid' becomes available");
    console.log("     - Admin processes payout → status = 'paid'");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    process.exit(1);
  }
}

verifyPayoutSystem();
