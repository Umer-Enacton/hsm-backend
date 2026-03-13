const db = require("./config/db");
const { services, bookings, payments, businessProfiles } = require("./models/schema");
const { eq } = require("drizzle-orm");

async function debugBusiness22() {
  try {
    console.log("🔍 DEBUGGING BUSINESS 22\n");

    // 1. Get business 22 details
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, 22))
      .limit(1);

    console.log("Business 22:", business);
    console.log("Provider ID:", business?.providerId);
    console.log("");

    // 2. Get services for business 22
    const businessServices = await db
      .select()
      .from(services)
      .where(eq(services.businessProfileId, 22));

    console.log(`Services for business 22: ${businessServices.length}`);
    businessServices.forEach(s => {
      console.log(`  - Service ID: ${s.id}, Name: "${s.name}", Price: ₹${s.price}`);
    });
    console.log("");

    // 3. Get ALL bookings for business 22
    const businessBookings = await db
      .select()
      .from(bookings)
      .where(eq(bookings.businessProfileId, 22));

    console.log(`Bookings for business 22: ${businessBookings.length}`);
    businessBookings.forEach(b => {
      console.log(`  - Booking ID: ${b.id}, Service ID: ${b.serviceId}, Status: ${b.status}, Price: ₹${b.totalPrice}`);
    });
    console.log("");

    // 4. For each service, check what revenue it would get
    console.log("Checking revenue calculation for each service:");
    for (const service of businessServices) {
      // Get bookings specifically for THIS service
      const serviceBookings = await db
        .select()
        .from(bookings)
        .where(eq(bookings.serviceId, service.id));

      console.log(`\n  Service ${service.id} ("${service.name}"):`);
      console.log(`    Bookings with this serviceId: ${serviceBookings.length}`);

      serviceBookings.forEach(b => {
        console.log(`      - Booking ID: ${b.id}, Business ID: ${b.businessProfileId}, Status: ${b.status}`);
      });

      // Now get payments for these bookings (ONLY business 22)
      const paymentsForService = await db
        .select()
        .from(payments);

      let totalRevenue = 0;
      for (const payment of paymentsForService) {
        if (payment.status !== "paid") continue;

        // Find booking for this payment
        const [booking] = await db
          .select()
          .from(bookings)
          .where(eq(bookings.id, payment.bookingId))
          .limit(1);

        if (booking && booking.serviceId === service.id && booking.businessProfileId === 22) {
          totalRevenue += Number(payment.providerShare || 0);
          console.log(`      ✓ Payment ${payment.id}: ₹${payment.providerShare / 100} (booking ${booking.id}, business ${booking.businessProfileId})`);
        }
      }

      console.log(`    Total revenue for this service: ₹${totalRevenue / 100}`);
    }

    // 5. Check ALL payments in database
    console.log("\n📊 ALL PAID PAYMENTS IN DATABASE:");
    const allPaidPayments = await db
      .select()
      .from(payments)
      .where(eq(payments.status, "paid"));

    allPaidPayments.forEach(p => {
      console.log(`  Payment ID: ${p.id}, Amount: ₹${p.amount / 100}, Provider Share: ₹${(p.providerShare || 0) / 100}, Booking ID: ${p.bookingId}`);
    });

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

debugBusiness22();
