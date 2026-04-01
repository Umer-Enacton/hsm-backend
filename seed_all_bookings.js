const db = require("./config/db");
const {
  users, Address, businessProfiles, services, slots, bookings,
  bookingHistory, payments, paymentIntents, notifications, feedback
} = require("./models/schema");
const { inArray, eq } = require("drizzle-orm");
const fs = require("fs");
const path = require("path");

const CUSTOMER_IDS = [2, 9, 18];
const PROVIDER_IDS = [4, 3, 6];

async function runSeed() {
  console.log("Starting rigorous seed for all booking statuses across specific scenarios...");
  
  const seededBookingIds = [];
  const seededNotificationIds = [];
  
  // 1. Fetch data
  const customers = await db.select().from(users).where(inArray(users.id, CUSTOMER_IDS));
  const addresses = await db.select().from(Address).where(inArray(Address.userId, CUSTOMER_IDS));
  
  const providers = await db.select().from(users).where(inArray(users.id, PROVIDER_IDS));
  const businesses = await db.select().from(businessProfiles).where(inArray(businessProfiles.providerId, PROVIDER_IDS));
  
  const businessIds = businesses.map(b => b.id);
  const allServices = await db.select().from(services).where(inArray(services.businessProfileId, businessIds));
  const allSlots = await db.select().from(slots).where(inArray(slots.businessProfileId, businessIds));
  
  if (businesses.length === 0 || allServices.length === 0 || allSlots.length === 0) {
    console.error("Missing business profiles, services, or slots for these providers.");
    return;
  }
  
  console.log(`Found ${customers.length} customers, ${providers.length} providers with ${businesses.length} businesses.`);
  
  // 2. Define 21 explicitly requested booking scenarios
  const scenarios = [
    // Completed - 11 Total (some had reschedules before completion, so they carry ₹100 reschedule fees)
    { status: "completed", rating: "5.0", comment: "Incredible work, highly recommended!", hasFeedback: true, daysOffset: -1, hadReschedule: true },
    { status: "completed", rating: "4.0", comment: "Very good service, but arrived a bit late.", hasFeedback: true, daysOffset: -2 },
    { status: "completed", rating: "5.0", comment: "Excellent experience.", hasFeedback: true, daysOffset: -3, hadReschedule: true },
    { status: "completed", rating: "5.0", comment: "The provider was very professional.", hasFeedback: true, daysOffset: -4 },
    { status: "completed", rating: "3.0", comment: "Average, could be better.", hasFeedback: true, daysOffset: -5, hadReschedule: true },
    { status: "completed", rating: "4.0", comment: "Solid job out there.", hasFeedback: true, daysOffset: -6 },
    { status: "completed", rating: "5.0", comment: "Best service I've booked on here.", hasFeedback: true, daysOffset: -10, hadReschedule: true },
    { status: "completed", rating: "4.0", comment: "Nicely done.", hasFeedback: true, daysOffset: -12 },
    { status: "completed", rating: "5.0", comment: "Perfect across all parameters.", hasFeedback: true, daysOffset: -15, hadReschedule: true },
    { status: "completed", hasFeedback: false, daysOffset: -2 },
    { status: "completed", hasFeedback: false, daysOffset: -8, hadReschedule: true },

    // Confirmed (Upcoming) - 2 Total
    { status: "confirmed", daysOffset: 1 }, // Tomorrow
    { status: "confirmed", daysOffset: 3 }, // In 3 Days

    // Pending (Need Action) - 2 Total
    { status: "pending", daysOffset: 0 }, // Today
    { status: "pending", daysOffset: 2 }, // In 2 Days

    // Cancelled - 2 Total
    { status: "cancelled", cancelledBy: "customer", daysOffset: -4 },
    { status: "cancelled", cancelledBy: "provider", daysOffset: -7 },

    // Rejected - 2 Total
    { status: "rejected", daysOffset: -1 },
    { status: "rejected", daysOffset: -3 },

    // Reschedule Pending (Future) - 2 Total
    { status: "reschedule_pending", daysOffset: 2 },
    { status: "reschedule_pending", daysOffset: 4 }
  ];
  
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    
    // Distribute among customers and providers
    const customer = customers[i % customers.length];
    const provider = providers[i % providers.length];
    
    const customerAddress = addresses.find(a => a.userId === customer.id) || addresses[0];
    const business = businesses.find(b => b.providerId === provider.id);
    
    if (!business || !customerAddress) continue;
    
    const businessServices = allServices.filter(s => s.businessProfileId === business.id);
    const businessSlots = allSlots.filter(s => s.businessProfileId === business.id);
    
    if (businessServices.length === 0 || businessSlots.length === 0) continue;
    
    // Pick different services per loop sequence to make use of all of them!
    const service = businessServices[i % businessServices.length];
    const slot = businessSlots[0];
    
    // Set explicit date based on scenario offset (ensures 'upcoming' works properly)
    let bookingDate = new Date();
    bookingDate.setDate(bookingDate.getDate() + scenario.daysOffset);
    
    // Create base booking
    const bookingValues = {
      customerId: customer.id,
      businessProfileId: business.id,
      serviceId: service.id,
      slotId: slot.id,
      addressId: customerAddress.id,
      bookingDate: bookingDate,
      status: scenario.status,
      totalPrice: service.price,
      paymentStatus: ["pending", "rejected"].includes(scenario.status) ? "pending" : "paid",
    };
    
    if (scenario.status === "completed") {
      bookingValues.beforePhotoUrl = "https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg"; 
      bookingValues.afterPhotoUrl = "https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg";
      bookingValues.actualCompletionTime = new Date(bookingDate.getTime() + 2 * 60 * 60 * 1000); // 2 hrs later
    }
    
    if (scenario.status === "cancelled") {
      bookingValues.cancellationReason = `Cancelled by ${scenario.cancelledBy}`;
      bookingValues.cancelledBy = scenario.cancelledBy;
      bookingValues.cancelledAt = new Date();
      if (scenario.cancelledBy === "customer" && bookingValues.paymentStatus === "paid") {
        bookingValues.isRefunded = true;
        bookingValues.refundAmount = service.price * 100;
        bookingValues.providerPayoutAmount = 0;
      }
    }
    
    if (scenario.status === "reschedule_pending") {
      bookingValues.rescheduleCount = 1;
      bookingValues.lastRescheduleFee = 10000; // 100 rs in paise
      bookingValues.rescheduleReason = "Need a different time";
      bookingValues.rescheduledBy = "customer"; // Enacton logic usually customer reschedules
      bookingValues.rescheduledAt = new Date();
      bookingValues.rescheduleOutcome = "pending";
    }
    
    const [newBooking] = await db.insert(bookings).values(bookingValues).returning();
    console.log(`Created ${scenario.status} booking #${newBooking.id} bound to service '${service.name}' on date ${bookingDate.toISOString().split('T')[0]}`);
    seededBookingIds.push(newBooking.id);
    
    // History log for booking creation
    await db.insert(bookingHistory).values({
      bookingId: newBooking.id,
      action: "booked",
      message: "Booking was created successfully.",
      actor: "customer",
      actorId: customer.id
    });
    
    // Main Payment processing
    if (bookingValues.paymentStatus === "paid") {
      // 50% are 'paid', 50% are 'pending' payout status to fill out both sides of provider's earnings chart properly
      const payoutStatus = i % 2 === 0 ? "paid" : "pending";

      await db.insert(paymentIntents).values({
        userId: customer.id,
        serviceId: service.id,
        slotId: slot.id,
        addressId: customerAddress.id,
        bookingDate: bookingDate,
        amount: service.price * 100, // paise
        status: "completed",
        expiresAt: new Date(bookingDate.getTime() + 60*60*1000),
        razorpayOrderId: `order_mock_${newBooking.id}`
      });
      
      await db.insert(payments).values({
        bookingId: newBooking.id,
        userId: customer.id,
        razorpayOrderId: `order_mock_${newBooking.id}`,
        razorpayPaymentId: `pay_mock_${newBooking.id}`,
        amount: service.price * 100,
        currency: "INR",
        status: "paid",
        platformFee: Math.floor((service.price * 100) * 0.05), // 5%
        providerShare: Math.floor((service.price * 100) * 0.95), // 95%
        providerPayoutStatus: ["cancelled", "refunded"].includes(scenario.status) ? "failed" : payoutStatus, 
        completedAt: new Date()
      });
      
      await db.insert(bookingHistory).values({
        bookingId: newBooking.id,
        action: "payment",
        message: "Payment was successful.",
        actor: "customer",
        actorId: customer.id
      });
    }

    // EXTRA PAYMENT FOR RESCHEDULE FEE (for reschedule_pending AND completed bookings that had reschedules)
    if (scenario.status === "reschedule_pending" || scenario.hadReschedule) {
      await db.insert(payments).values({
        bookingId: newBooking.id,
        userId: customer.id,
        razorpayOrderId: `order_mock_resched_${newBooking.id}`,
        razorpayPaymentId: `pay_mock_resched_${newBooking.id}`,
        amount: 10000, 
        currency: "INR",
        status: "paid",
        platformFee: 0, 
        providerShare: 10000, 
        providerPayoutStatus: "paid", 
        rescheduleFeePayoutStatus: "paid",
        completedAt: new Date()
      });
      console.log(`-- Inserted ₹100 Reschedule Fee Payment for booking #${newBooking.id} (${scenario.status})`);
    }
    
    // Status specific updates
    if (scenario.status === "completed") {
      await db.insert(bookingHistory).values({
        bookingId: newBooking.id,
        action: "completed",
        message: "Booking was marked as completed.",
        actor: "provider",
        actorId: provider.id
      });
      
      // Calculate Feedback!
      if (scenario.hasFeedback) {
        await db.insert(feedback).values({
          bookingId: newBooking.id,
          serviceId: service.id,
          customerId: customer.id,
          rating: scenario.rating,
          comments: scenario.comment,
        });
        console.log(`-- Added feedback (${scenario.rating} star) for booking #${newBooking.id}`);
      }
    }
    
    if (scenario.status === "cancelled") {
      await db.insert(bookingHistory).values({
        bookingId: newBooking.id,
        action: "cancelled",
        message: `Booking was cancelled by ${scenario.cancelledBy}.`,
        actor: scenario.cancelledBy,
        actorId: scenario.cancelledBy === "customer" ? customer.id : provider.id
      });
    }
    
    if (scenario.status === "rejected") {
      await db.insert(bookingHistory).values({
        bookingId: newBooking.id,
        action: "rejected",
        message: "Booking was rejected by provider.",
        actor: "provider",
        actorId: provider.id
      });
    }
  }

  // 3. Dynamic Recalculation of Ratings for Services ONLY
  console.log("\\nRecalculating ratings for services so UI doesn't say 0.0...");
  const allFeedback = await db.select().from(feedback);
  const serviceStats = {};
  
  for (const f of allFeedback) {
    if (!serviceStats[f.serviceId]) serviceStats[f.serviceId] = { sum: 0, count: 0 };
    serviceStats[f.serviceId].sum += parseFloat(f.rating);
    serviceStats[f.serviceId].count += 1;
  }
  
  // Apply service rating updates to the table directly
  for (const [sId, stats] of Object.entries(serviceStats)) {
    const avg = (stats.sum / stats.count).toFixed(2);
    await db.update(services)
      .set({ rating: avg, totalReviews: stats.count })
      .where(eq(services.id, parseInt(sId)));
  }
  
  console.log("Service ratings successfully updated!");
  
  // 4. Trace IDs
  const trackingData = {
    bookingIds: seededBookingIds,
    notificationIds: seededNotificationIds
  };
  fs.writeFileSync(path.join(__dirname, "seeded_data_tracking.json"), JSON.stringify(trackingData, null, 2));
  
  console.log("\\nSeed execution completed! Tracking data saved for rollback.");
  process.exit(0);
}

runSeed().catch(console.error);
