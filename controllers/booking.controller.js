const db = require("../config/db");
const {
  businessProfiles,
  slots,
  services,
  Address,
  bookings,
  users,
  feedback,
  payments,
} = require("../models/schema");
const {
  eq,
  and,
  gte,
  lte,
  desc,
  or,
  isNull,
  sql,
  ne,
  inArray,
} = require("drizzle-orm");
const { logBookingHistory } = require("../utils/historyHelper");
const {
  initiateRefund,
  paiseToRupees,
  rupeesToPaise,
} = require("../utils/razorpay");
const { notificationTemplates } = require("../utils/notificationHelper");
// Import email service
const { sendCompletionOTPEmail } = require("../helper/emailService");

// Get booking by ID
const getBookingById = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Check if user is either customer or provider
    const business = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking.businessProfileId))
      .limit(1);

    if (
      booking.customerId !== userId &&
      (!business[0] || business[0].providerId !== userId)
    ) {
      return res
        .status(403)
        .json({ message: "You are not authorized to view this booking" });
    }

    // Fetch related data
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, booking.serviceId))
      .limit(1);

    const [serviceBusinessProfile] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking.businessProfileId))
      .limit(1);

    // Fetch feedback for this booking if exists
    const [bookingFeedback] = await db
      .select()
      .from(feedback)
      .where(eq(feedback.bookingId, bookingId))
      .limit(1);

    const [address] = await db
      .select()
      .from(Address)
      .where(eq(Address.id, booking.addressId))
      .limit(1);

    const [slot] = await db
      .select()
      .from(slots)
      .where(eq(slots.id, booking.slotId))
      .limit(1);

    // Enrich booking with related data
    const enrichedBooking = {
      ...booking,
      service: service
        ? {
            id: service.id,
            name: service.name,
            description: service.description,
            price: service.price,
            duration: service.EstimateDuration || service.duration,
            EstimateDuration: service.EstimateDuration || service.duration,
            imageUrl: service.imageUrl,
            provider: serviceBusinessProfile
              ? {
                  id: serviceBusinessProfile.id,
                  businessName: serviceBusinessProfile.businessName,
                  rating: serviceBusinessProfile.rating,
                  totalReviews: serviceBusinessProfile.totalReviews,
                  isVerified: serviceBusinessProfile.isVerified,
                }
              : undefined,
          }
        : null,
      address: address
        ? {
            id: address.id,
            street: address.street,
            city: address.city,
            state: address.state,
            zipCode: address.zipCode,
          }
        : null,
      slot: slot
        ? {
            id: slot.id,
            startTime: slot.startTime,
            endTime: slot.endTime,
          }
        : null,
      feedback: bookingFeedback
        ? {
            id: bookingFeedback.id,
            rating: bookingFeedback.rating,
            comments: bookingFeedback.comments,
          }
        : null,
    };

    res.status(200).json({ booking: enrichedBooking });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all bookings for logged-in customer
const getCustomerBookings = async (req, res) => {
  try {
    const userId = req.token.id;
    const customerBookings = await db
      .select()
      .from(bookings)
      .where(eq(bookings.customerId, userId))
      .orderBy(desc(bookings.bookingDate));

    // Fetch related data for each booking
    const bookingsWithDetails = await Promise.all(
      customerBookings.map(async (booking) => {
        // Get service info
        const [service] = await db
          .select()
          .from(services)
          .where(eq(services.id, booking.serviceId))
          .limit(1);

        // Get business profile info (provider)
        const [businessProfile] = await db
          .select()
          .from(businessProfiles)
          .where(eq(businessProfiles.id, booking.businessProfileId))
          .limit(1);

        // Get address info
        const [address] = await db
          .select()
          .from(Address)
          .where(eq(Address.id, booking.addressId))
          .limit(1);

        // Get slot info
        const [slot] = await db
          .select()
          .from(slots)
          .where(eq(slots.id, booking.slotId))
          .limit(1);

        // Get feedback info if exists
        const [bookingFeedback] = await db
          .select()
          .from(feedback)
          .where(eq(feedback.bookingId, booking.id))
          .limit(1);

        return {
          ...booking,
          service: service
            ? {
                id: service.id,
                name: service.name,
                description: service.description,
                price: service.price,
                duration: service.duration,
                imageUrl: service.imageUrl,
                provider: businessProfile
                  ? {
                      id: businessProfile.id,
                      businessName: businessProfile.businessName,
                      rating: businessProfile.rating,
                      totalReviews: businessProfile.totalReviews,
                      isVerified: businessProfile.isVerified,
                    }
                  : undefined,
              }
            : null,
          address: address
            ? {
                id: address.id,
                street: address.street,
                city: address.city,
                state: address.state,
                zipCode: address.zipCode,
              }
            : null,
          slot: slot
            ? {
                id: slot.id,
                startTime: slot.startTime,
                endTime: slot.endTime,
              }
            : null,
          feedback: bookingFeedback
            ? {
                id: bookingFeedback.id,
                rating: bookingFeedback.rating,
                comments: bookingFeedback.comments,
              }
            : null,
        };
      }),
    );

    res.status(200).json({ bookings: bookingsWithDetails });
  } catch (error) {
    console.error("Error fetching customer bookings:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all bookings for logged-in provider
const getProviderBookings = async (req, res) => {
  try {
    console.log("════════════════════════════════════════════════════════════");
    console.log("🔥🔥🔥 getProviderBookings CALLED!!! 🔥🔥🔥");
    console.log("════════════════════════════════════════════════════════════");
    const userId = req.token.id;
    console.log("[getProviderBookings] Fetching bookings for userId:", userId);

    // First get the business profile for this provider
    const business = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, userId))
      .limit(1);

    console.log(
      "[getProviderBookings] Found business profiles:",
      business.length,
    );

    if (business.length === 0) {
      console.log(
        "[getProviderBookings] No business profile found for userId:",
        userId,
      );
      return res.status(404).json({
        message: "Business profile not found",
        debug: {
          userId,
          hint: "Your account may not be linked to a business profile",
        },
      });
    }

    console.log(
      "[getProviderBookings] Using business ID:",
      business[0].id,
      "name:",
      business[0].businessName,
    );

    // Get all bookings for this provider
    const providerBookings = await db
      .select()
      .from(bookings)
      .where(eq(bookings.businessProfileId, business[0].id))
      .orderBy(desc(bookings.bookingDate));

    console.log(
      "[getProviderBookings] Found bookings:",
      providerBookings.length,
    );

    if (providerBookings.length === 0) {
      return res.status(200).json({ bookings: [] });
    }

    // Collect all IDs for batch queries
    const customerIds = [...new Set(providerBookings.map((b) => b.customerId))];
    const serviceIds = [
      ...new Set(providerBookings.map((b) => b.serviceId).filter(Boolean)),
    ];
    const slotIds = [
      ...new Set(providerBookings.map((b) => b.slotId).filter(Boolean)),
    ];
    const addressIds = [
      ...new Set(providerBookings.map((b) => b.addressId).filter(Boolean)),
    ];
    const completedBookingIds = providerBookings
      .filter((b) => b.status === "completed")
      .map((b) => b.id);

    // Batch fetch all related data in parallel (4 queries instead of N*4)
    const [customers, serviceList, slotsData, addresses, feedbackRecords] =
      await Promise.all([
        customerIds.length > 0
          ? db.select().from(users).where(inArray(users.id, customerIds))
          : Promise.resolve([]),
        serviceIds.length > 0
          ? db.select().from(services).where(inArray(services.id, serviceIds))
          : Promise.resolve([]),
        slotIds.length > 0
          ? db.select().from(slots).where(inArray(slots.id, slotIds))
          : Promise.resolve([]),
        addressIds.length > 0
          ? db.select().from(Address).where(inArray(Address.id, addressIds))
          : Promise.resolve([]),
        completedBookingIds.length > 0
          ? db
              .select()
              .from(feedback)
              .where(inArray(feedback.bookingId, completedBookingIds))
          : Promise.resolve([]),
      ]);

    // Create maps for O(1) lookup
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    const serviceMap = new Map(serviceList.map((s) => [s.id, s]));
    const slotMap = new Map(slotsData.map((s) => [s.id, s]));
    const addressMap = new Map(addresses.map((a) => [a.id, a]));
    const feedbackMap = new Map(feedbackRecords.map((f) => [f.bookingId, f]));

    // Format the response using maps
    const bookingsWithCustomers = providerBookings.map((booking) => {
      const customer = customerMap.get(booking.customerId);
      const service = serviceMap.get(booking.serviceId);
      const slot = slotMap.get(booking.slotId);
      const address = addressMap.get(booking.addressId);
      const feedbackData = feedbackMap.get(booking.id);

      // DEBUG: Log reschedule fields for pending bookings
      if (booking.status === "reschedule_pending") {
        console.log(`[DEBUG] Booking #${booking.id} reschedule fields:`, {
          previousBookingDate: booking.previousBookingDate,
          previousSlotTime: booking.previousSlotTime,
          rescheduleReason: booking.rescheduleReason,
          lastRescheduleFee: booking.lastRescheduleFee,
        });
      }

      return {
        id: booking.id,
        customerId: booking.customerId,
        serviceId: booking.serviceId,
        slotId: booking.slotId,
        addressId: booking.addressId,
        businessProfileId: booking.businessProfileId,
        date: booking.bookingDate,
        bookingDate: booking.bookingDate,
        status: booking.status,
        totalPrice: booking.totalPrice,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        // Legacy reschedule fields
        rescheduledFromSlotId: booking.rescheduledFromSlotId,
        rescheduledAt: booking.rescheduledAt,
        // New reschedule fields
        rescheduleCount: booking.rescheduleCount,
        lastRescheduleFee: booking.lastRescheduleFee,
        rescheduleOutcome: booking.rescheduleOutcome,
        rescheduleReason: booking.rescheduleReason,
        rescheduledBy: booking.rescheduledBy,
        // Previous slot info (for reschedule display)
        previousSlotId: booking.previousSlotId,
        previousSlotTime: booking.previousSlotTime,
        previousBookingDate: booking.previousBookingDate,
        // New slot info (requested for reschedule)
        rescheduleBookingDate: booking.rescheduleBookingDate,
        rescheduleSlotTime: booking.rescheduleSlotTime,
        // Refund tracking
        isRefunded: booking.isRefunded,
        refundAmount: booking.refundAmount,
        // Provider payout tracking
        providerPayoutAmount: booking.providerPayoutAmount,
        providerPayoutStatus: booking.providerPayoutStatus,
        // Completion verification photos
        beforePhotoUrl: booking.beforePhotoUrl || null,
        afterPhotoUrl: booking.afterPhotoUrl || null,
        completionNotes: booking.completionNotes || null,
        actualCompletionTime: booking.actualCompletionTime || null,
        completionOtp: booking.completionOtp || null,
        completionOtpExpiry: booking.completionOtpExpiry || null,
        completionOtpVerifiedAt: booking.completionOtpVerifiedAt || null,
        customerName: customer?.name || "Unknown",
        customerPhone: customer?.phone || "",
        customerEmail: customer?.email || "",
        customerAvatar: customer?.avatar || null,
        serviceName: service?.name || "Unknown Service",
        price: service?.price || booking.totalPrice || 0,
        startTime: slot?.startTime || "",
        address: address
          ? `${address.street}, ${address.city}, ${address.state} ${address.zipCode}`
          : "Unknown Address",
        feedback: feedbackData
          ? {
              rating: feedbackData.rating,
              comments: feedbackData.comments,
              createdAt: feedbackData.createdAt,
            }
          : null,
      };
    });

    // DEBUG: Log first booking to verify all fields
    if (bookingsWithCustomers.length > 0) {
      console.log(
        "[DEBUG] First booking in response:",
        JSON.stringify(bookingsWithCustomers[0], null, 2),
      );
    }

    res.status(200).json({ bookings: bookingsWithCustomers });
  } catch (error) {
    console.error("Error fetching provider bookings:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const addBooking = async (req, res) => {
  console.log("🔔 addBooking called");
  try {
    const userId = req.token.id;
    const { serviceId, slotId, addressId, bookingDate } = req.body;
    console.log("🔔 Request body:", {
      serviceId,
      slotId,
      addressId,
      bookingDate,
    });
    if (!serviceId || !slotId || !bookingDate || !addressId) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Validate booking date format
    const bookingDateObj = new Date(bookingDate);
    if (isNaN(bookingDateObj.getTime())) {
      return res.status(400).json({ message: "Invalid bookingDate format" });
    }

    console.log("=== DEBUG START ===");
    console.log("bookingDate from request:", bookingDate);
    console.log("bookingDateObj:", bookingDateObj);
    console.log("bookingDateObj ISO:", bookingDateObj.toISOString());
    console.log("bookingDateObj Local:", bookingDateObj.toString());

    // Get current time in local timezone
    const now = new Date();
    console.log("Current time (now):", now);
    console.log("Current time ISO:", now.toISOString());
    console.log("Current time Local:", now.toString());

    // Check if booking date is in the past (compare at day level in local time)
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const bookingDateStart = new Date(
      bookingDateObj.getFullYear(),
      bookingDateObj.getMonth(),
      bookingDateObj.getDate(),
    );

    console.log("todayStart:", todayStart);
    console.log("bookingDateStart:", bookingDateStart);
    console.log(
      "Are they the same day?",
      bookingDateStart.getTime() === todayStart.getTime(),
    );

    if (bookingDateStart < todayStart) {
      return res
        .status(400)
        .json({ message: "Cannot book slots for past dates" });
    }

    //check if address belongs to user
    const address = await db
      .select()
      .from(Address)
      .where(and(eq(Address.id, addressId), eq(Address.userId, userId)));

    if (address.length === 0) {
      return res.status(404).json({ message: "Please add an address first" });
    }

    //check if service exists
    const service = await db
      .select()
      .from(services)
      .where(eq(services.id, serviceId));

    if (service.length === 0) {
      return res.status(404).json({ message: "Service not found" });
    }

    //check if slot exists
    const slot = await db.select().from(slots).where(eq(slots.id, slotId));
    if (slot.length === 0) {
      return res.status(404).json({ message: "Slot not found" });
    }

    console.log("Slot data:", slot[0]);
    console.log("Slot startTime:", slot[0].startTime);

    // Check if booking is for today and slot time has already passed
    const isToday = bookingDateStart.getTime() === todayStart.getTime();
    console.log("Is booking for today?", isToday);

    if (isToday) {
      // Parse slot start time (format: "HH:MM:SS")
      const [slotHours, slotMinutes, slotSeconds = 0] = slot[0].startTime
        .split(":")
        .map(Number);
      console.log(
        "Parsed slot time - Hours:",
        slotHours,
        "Minutes:",
        slotMinutes,
        "Seconds:",
        slotSeconds,
      );

      // Create slot datetime in local timezone using today's date
      const slotDateTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        slotHours,
        slotMinutes,
        slotSeconds,
      );

      console.log("slotDateTime:", slotDateTime);
      console.log("slotDateTime ISO:", slotDateTime.toISOString());
      console.log("slotDateTime Local:", slotDateTime.toString());
      console.log("Current time:", now);
      console.log("Is slotDateTime <= now?", slotDateTime <= now);
      console.log(
        "Time difference (minutes):",
        (slotDateTime - now) / (1000 * 60),
      );
      console.log("=== DEBUG END ===");

      if (slotDateTime <= now) {
        return res.status(400).json({
          message: "Cannot book slots that have already passed for today",
        });
      }
    }

    //check slot belongs to service business
    const businessProfile = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, slot[0].businessProfileId));

    if (businessProfile.length === 0) {
      return res
        .status(404)
        .json({ message: "Business profile for the slot not found" });
    }

    // Check if provider has payment details (required for receiving payments)
    if (!businessProfile[0].hasPaymentDetails) {
      return res.status(400).json({
        message:
          "Service provider is not accepting bookings at this time. Please try again later.",
        code: "PROVIDER_NO_PAYMENT_DETAILS",
      });
    }

    // Check if slot is not already booked for the booking date (same service only)
    // Different services can use the same time slot
    const startOfDay = new Date(bookingDateObj);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDateObj);
    endOfDay.setHours(23, 59, 59, 999);

    const existingBooking = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.slotId, slotId),
          eq(bookings.serviceId, serviceId), // Only check same service
          gte(bookings.bookingDate, startOfDay),
          lte(bookings.bookingDate, endOfDay),
        ),
      );

    if (existingBooking.length > 0) {
      return res.status(400).json({
        message: "Slot is already booked for this service on the selected date",
      });
    }

    const [newBooking] = await db
      .insert(bookings)
      .values({
        customerId: userId,
        businessProfileId: businessProfile[0].id,
        serviceId,
        slotId,
        addressId,
        bookingDate: bookingDateObj,
        totalPrice: service[0].price,
      })
      .returning();

    console.log("🔔 Booking created successfully, ID:", newBooking.id);

    // Log history
    await logBookingHistory(
      newBooking.id,
      "booked",
      "Booking was created successfully.",
      "customer",
      userId
    );

    // Send notification to provider about new booking
    console.log("🔔 Creating notification for new booking:", newBooking.id);
    try {
      await notificationTemplates.bookingCreated(newBooking.id);
      console.log("✅ Notification sent successfully");
    } catch (notifError) {
      console.error("❌ Error sending notification:", notifError);
      // Don't fail the booking if notification fails
    }

    res
      .status(201)
      .json({ message: "Booking created successfully", booking: newBooking });
  } catch (error) {
    console.error("Booking error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
// const addBooking = async (req, res) => {
//   try {
//     const userId = req.token.id;
//     const { serviceId, slotId, addressId, bookingDate } = req.body;
//     if (!serviceId || !slotId || !bookingDate || !addressId) {
//       return res.status(400).json({ message: "All fields are required" });
//     }
//     console.log(bookingDate);
//     console.log(userId);
//     //check if address belongs to user
//     const address = await db
//       .select()
//       .from(Address)
//       .where(and(eq(Address.id, addressId), eq(Address.userId, userId)));
//     console.log(address);
//     if (address.length === 0) {
//       return res.status(404).json({ message: "please Add an Address First" });
//     }
//     //check if service exists

//     const service = await db
//       .select()
//       .from(services)
//       .where(eq(services.id, serviceId));
//     console.log(service);
//     if (service.length === 0) {
//       return res.status(404).json({ message: "Service not found" });
//     }
//     //check if slot exists
//     const slot = await db.select().from(slots).where(eq(slots.id, slotId));
//     if (slot.length === 0) {
//       return res.status(404).json({ message: "Slot not found" });
//     }
//     console.log(slot);
//     //check slot belongs to service business
//     const businessProfile = await db
//       .select()
//       .from(businessProfiles)
//       .where(eq(businessProfiles.id, slot[0].businessProfileId));
//     console.log(businessProfile);
//     if (businessProfile.length === 0) {
//       return res
//         .status(404)
//         .json({ message: "Business profile for the slot not found" });
//     }
//     //check slot status is available
//     const bookingDateObj = new Date(bookingDate);

//     if (isNaN(bookingDateObj.getTime())) {
//       return res.status(400).json({ message: "Invalid bookingDate format" });
//     }
//     const startOfDay = new Date(bookingDate);
//     startOfDay.setHours(0, 0, 0, 0);

//     const endOfDay = new Date(bookingDate);
//     endOfDay.setHours(23, 59, 59, 999);

//     //check slot is not already booked for the booking date
//     const existingBooking = await db
//       .select()
//       .from(bookings)
//       .where(
//         and(
//           eq(bookings.slotId, slotId),
//           gte(bookings.bookingDate, startOfDay),
//           lte(bookings.bookingDate, endOfDay)
//         )
//       );

//     console.log(existingBooking);
//     if (existingBooking.length > 0) {
//       return res
//         .status(400)
//         .json({ message: "Slot is already booked for the selected date" });
//     }

//     const [newBooking] = await db
//       .insert(bookings)
//       .values({
//         customerId: userId,
//         businessProfileId: businessProfile[0].id,
//         serviceId,
//         slotId,
//         addressId,
//         bookingDate: bookingDateObj,
//         totalPrice: service[0].price,
//       })
//       .returning();
//     res
//       .status(201)
//       .json({ message: "Booking created successfully", booking: newBooking });
//   } catch (error) {
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };
//acceptbooking by business owner
const acceptBooking = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    console.log(bookingId);
    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    // 1. Fetch booking
    const booking = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (booking.length === 0) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // 2. Check booking status
    if (booking[0].status !== "pending") {
      return res
        .status(400)
        .json({ message: "Only pending bookings can be accepted" });
    }

    // 3. Fetch business profile
    const businessProfile = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking[0].businessProfileId));

    if (businessProfile.length === 0) {
      return res.status(404).json({ message: "Business profile not found" });
    }

    // 4. Verify provider owns the business
    if (businessProfile[0].providerId !== userId) {
      return res
        .status(403)
        .json({ message: "You are not authorized to accept this booking" });
    }

    // 5. Update booking status
    const [updatedBooking] = await db
      .update(bookings)
      .set({ status: "confirmed" })
      .where(eq(bookings.id, bookingId))
      .returning();

    // 6. Send notification to customer
    await notificationTemplates.bookingConfirmed(bookingId);

    return res.status(200).json({
      message: "Booking accepted successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
const rejectBooking = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    console.log(bookingId);
    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    // 1. Fetch booking
    const booking = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (booking.length === 0) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // 2. Check booking status - providers can only reject PENDING bookings
    // For confirmed bookings, providers must reschedule instead
    if (booking[0].status !== "pending") {
      if (booking[0].status === "confirmed") {
        return res.status(400).json({
          message:
            "Cannot reject confirmed bookings. Please use the reschedule option instead.",
          currentStatus: booking[0].status,
          bookingId: bookingId,
        });
      }
      return res.status(400).json({
        message: `This booking cannot be rejected. Current status: ${booking[0].status}. Only pending bookings can be rejected.`,
        currentStatus: booking[0].status,
        bookingId: bookingId,
      });
    }

    // 3. Fetch business profile
    const businessProfile = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking[0].businessProfileId));

    if (businessProfile.length === 0) {
      return res.status(404).json({ message: "Business profile not found" });
    }

    // 4. Verify provider owns the business
    if (businessProfile[0].providerId !== userId) {
      return res
        .status(403)
        .json({ message: "You are not authorized to cancel this booking" });
    }

    // 5. Check if booking has been paid and initiate refund if so
    let refundDetails = null;
    if (booking[0].paymentStatus === "paid") {
      // Fetch payment record
      const [payment] = await db
        .select()
        .from(payments)
        .where(eq(payments.bookingId, bookingId));

      if (payment && payment.razorpayPaymentId) {
        // Initiate refund via Razorpay
        const refund = await initiateRefund(
          payment.razorpayPaymentId,
          payment.amount, // Full refund
          {
            reason: "Booking cancelled by provider",
            bookingId: bookingId.toString(),
          },
        );

        // Update payment record
        await db
          .update(payments)
          .set({
            status: "refunded",
            refundId: refund.id,
            refundAmount: refund.amount,
            refundReason: "Booking cancelled by provider",
            refundedAt: new Date(),
          })
          .where(eq(payments.id, payment.id));

        refundDetails = {
          refundId: refund.id,
          refundAmount: paiseToRupees(refund.amount),
        };
      }
    }

    // 6. Update booking status - provider rejection always sets status to "rejected"
    const [updatedBooking] = await db
      .update(bookings)
      .set({
        status: "rejected",
        isRefunded: !!refundDetails,
        cancelledAt: new Date(),
        cancellationReason: "Rejected by provider",
        cancelledBy: "provider",
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    // 7. Send notification to customer
    await notificationTemplates.bookingRejected(bookingId);

    return res.status(200).json({
      message: refundDetails
        ? "Booking cancelled and refund initiated successfully"
        : "Booking cancelled successfully",
      booking: updatedBooking,
      refund: refundDetails,
    });
  } catch (error) {
    console.error("Error rejecting booking:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// ============================================
// Helper Functions
// ============================================

/**
 * Calculate reschedule fee - Flat ₹100 per reschedule
 * @param {number} rescheduleCount - Current number of reschedules
 * @param {number} bookingAmount - Booking amount in paise (unused, kept for compatibility)
 * @param {object} settings - Provider settings (unused, kept for compatibility)
 * @returns {object} - { feeAmount, feePercentage, nextRescheduleNumber }
 */
function calculateRescheduleFee(rescheduleCount, bookingAmount, settings) {
  // Flat ₹100 reschedule fee (10000 paise)
  const RESCHEDULE_FEE = 10000; // ₹100 in paise
  const MAX_RESCHEDULES = 2; // Maximum 2 reschedules per booking

  const nextRescheduleNumber = rescheduleCount + 1;

  // Check if max reschedules reached
  if (rescheduleCount >= MAX_RESCHEDULES) {
    throw new Error(
      `Maximum reschedule limit (${MAX_RESCHEDULES}) reached for this booking`,
    );
  }

  return {
    feeAmount: RESCHEDULE_FEE,
    feePercentage: null, // Flat fee, not percentage-based
    nextRescheduleNumber,
  };
}

/**
 * Calculate cancellation refund based on booking status
 * NEW RULES:
 * - Pending/Reschedule_Pending: 100% refund to customer
 * - Confirmed: 85% refund to customer, 10% payout to provider, 5% platform fee
 * @param {string} bookingStatus - Current booking status
 * @param {number} servicePrice - Service price in paise
 * @returns {object} - { customerRefundAmount, customerRefundPercentage, providerPayoutAmount, providerPayoutPercentage, platformFeeAmount, platformFeePercentage }
 */
function calculateCancellationRefund(bookingStatus, servicePrice) {
  // Fixed refund percentages
  const PENDING_REFUND = 100; // 100% refund for pending
  const CONFIRMED_CUSTOMER_REFUND = 85; // 85% refund to customer for confirmed
  const CONFIRMED_PROVIDER_PAYOUT = 10; // 10% payout to provider for confirmed
  const CONFIRMED_PLATFORM_FEE = 5; // 5% platform fee for confirmed

  let customerRefundAmount = 0;
  let customerRefundPercentage = 0;
  let providerPayoutAmount = 0;
  let providerPayoutPercentage = 0;
  let platformFeeAmount = 0;
  let platformFeePercentage = 0;

  if (bookingStatus === "pending" || bookingStatus === "reschedule_pending") {
    // Full refund for pending bookings
    customerRefundPercentage = PENDING_REFUND;
    customerRefundAmount = servicePrice; // 100%
  } else if (bookingStatus === "confirmed") {
    // 85% refund to customer, 10% to provider, 5% platform fee for confirmed bookings
    customerRefundPercentage = CONFIRMED_CUSTOMER_REFUND;
    customerRefundAmount = Math.round(
      (servicePrice * CONFIRMED_CUSTOMER_REFUND) / 100,
    );
    providerPayoutPercentage = CONFIRMED_PROVIDER_PAYOUT;
    providerPayoutAmount = Math.round(
      (servicePrice * CONFIRMED_PROVIDER_PAYOUT) / 100,
    );
    platformFeePercentage = CONFIRMED_PLATFORM_FEE;
    platformFeeAmount = Math.round(
      (servicePrice * CONFIRMED_PLATFORM_FEE) / 100,
    );
  }

  return {
    customerRefundAmount,
    customerRefundPercentage,
    providerPayoutAmount,
    providerPayoutPercentage,
    platformFeeAmount,
    platformFeePercentage,
  };
}

// ============================================
// Provider Settings Management
// ============================================

// ============================================
// Reschedule Functions with Fee Logic
// ============================================

/**
 * Customer request reschedule - initiates reschedule with fee
 * PUT /booking/:id/reschedule-request
 */
const requestReschedule = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    const { slotId, bookingDate, reason } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }
    if (!slotId || !bookingDate) {
      return res
        .status(400)
        .json({ message: "slotId and bookingDate are required" });
    }

    // Validate booking date format
    const bookingDateObj = new Date(bookingDate);
    if (isNaN(bookingDateObj.getTime())) {
      return res.status(400).json({ message: "Invalid bookingDate format" });
    }

    // Check if booking date is in the past
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const bookingDateStart = new Date(
      bookingDateObj.getFullYear(),
      bookingDateObj.getMonth(),
      bookingDateObj.getDate(),
    );

    if (bookingDateStart < todayStart) {
      return res
        .status(400)
        .json({ message: "Cannot reschedule to past dates" });
    }

    // Fetch the booking
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Verify user owns this booking
    if (booking.customerId !== userId) {
      return res
        .status(403)
        .json({ message: "You are not authorized to reschedule this booking" });
    }

    // Check if booking can be rescheduled (only pending or confirmed)
    if (!["pending", "confirmed"].includes(booking.status)) {
      return res.status(400).json({
        message: `Cannot reschedule ${booking.status} bookings. Only pending and confirmed bookings can be rescheduled.`,
      });
    }

    // Get provider settings
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking.businessProfileId))
      .limit(1);

    if (!business) {
      return res.status(404).json({ message: "Business profile not found" });
    }

    // Fixed reschedule settings (not configurable by provider)
    const MAX_RESCHEDULES = 2;
    const RESCHEDULE_HOURS_BEFORE_SLOT = 1; // Cannot reschedule within 1 hour of slot

    // Check if reschedule count limit reached
    if (booking.rescheduleCount >= MAX_RESCHEDULES) {
      return res.status(400).json({
        message: `Maximum reschedule limit (${MAX_RESCHEDULES}) reached for this booking`,
      });
    }

    // Check if current slot is within 1 hour from now (prevent last-minute reschedule)
    const currentSlotTime = await db
      .select({ startTime: slots.startTime })
      .from(slots)
      .where(eq(slots.id, booking.slotId))
      .limit(1);

    if (currentSlotTime.length > 0) {
      const slotDateTime = new Date(booking.bookingDate);
      const [hours, minutes] = currentSlotTime[0].startTime
        .split(":")
        .map(Number);
      slotDateTime.setHours(hours, minutes, 0, 0);

      const now = new Date();
      const hoursUntilSlot = (slotDateTime - now) / (1000 * 60 * 60);

      if (hoursUntilSlot < RESCHEDULE_HOURS_BEFORE_SLOT) {
        return res.status(400).json({
          message: `Cannot reschedule within ${RESCHEDULE_HOURS_BEFORE_SLOT} hour(s) of the booking time`,
        });
      }
    }

    // Validate the new slot exists
    const [slot] = await db.select().from(slots).where(eq(slots.id, slotId));

    if (!slot) {
      return res.status(404).json({ message: "Slot not found" });
    }

    // Verify slot belongs to the same business
    if (slot.businessProfileId !== booking.businessProfileId) {
      return res.status(400).json({
        message: "Selected slot does not belong to the service provider",
      });
    }

    // Check if new slot is available for the selected date
    const startOfDay = new Date(bookingDateObj);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDateObj);
    endOfDay.setHours(23, 59, 59, 999);

    // Check if new slot is available for the selected date (same service only)
    // Different services can use the same time slot
    const [conflictingBooking] = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.slotId, slotId),
          eq(bookings.serviceId, booking.serviceId), // Only check same service
          gte(bookings.bookingDate, startOfDay),
          lte(bookings.bookingDate, endOfDay),
          or(eq(bookings.status, "pending"), eq(bookings.status, "confirmed")),
          ne(bookings.id, bookingId), // Exclude the current booking itself
        ),
      )
      .limit(1);

    if (conflictingBooking) {
      return res.status(400).json({
        message: "Slot is already booked for this service on the selected date",
      });
    }

    // Calculate reschedule fee (flat ₹100)
    const { feeAmount, feePercentage, nextRescheduleNumber } =
      calculateRescheduleFee(
        booking.rescheduleCount,
        booking.totalPrice,
        null, // Settings no longer used
      );

    // Fetch current slot to get its startTime for previousSlotTime
    const [currentSlot] = await db
      .select({ startTime: slots.startTime })
      .from(slots)
      .where(eq(slots.id, booking.slotId))
      .limit(1);

    // Store current slot/date as previous before updating
    const [updatedBooking] = await db
      .update(bookings)
      .set({
        slotId: slotId,
        bookingDate: bookingDateObj,
        status: "reschedule_pending",
        rescheduleOutcome: "pending", // Track reschedule state for display
        // Store original values in case of decline
        previousSlotId: booking.slotId,
        previousBookingDate: booking.bookingDate,
        previousSlotTime: currentSlot?.startTime || null, // Store slot time for display
        rescheduleReason: reason,
        rescheduledBy: "customer",
        rescheduledAt: new Date(),
        // Increment reschedule count
        rescheduleCount: booking.rescheduleCount + 1,
        lastRescheduleFee: feeAmount,
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    // Send notification to provider about reschedule request
    await notificationTemplates.rescheduleRequested(bookingId);

    return res.status(200).json({
      message:
        "Reschedule request submitted. Provider will review your request.",
      booking: updatedBooking,
      rescheduleFee: {
        amount: paiseToRupees(feeAmount), // Flat ₹100
        rescheduleNumber: nextRescheduleNumber,
        maxReschedules: MAX_RESCHEDULES,
      },
      requiresPayment: feeAmount > 0,
    });
  } catch (error) {
    console.error("Error requesting reschedule:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/**
 * Customer cancels their reschedule request
 * PUT /booking/:id/cancel-reschedule
 * Reverts to original slot and refunds reschedule fee
 */
const cancelRescheduleRequest = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    // Fetch the booking
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Verify user owns this booking
    if (booking.customerId !== userId) {
      return res.status(403).json({
        message: "You are not authorized to cancel this reschedule request",
      });
    }

    // Check if booking is in reschedule_pending status
    if (booking.status !== "reschedule_pending") {
      return res.status(400).json({
        message: `No pending reschedule request to cancel. Current status: ${booking.status}`,
      });
    }

    // Check if there are previous slot values to restore
    if (!booking.previousSlotId || !booking.previousBookingDate) {
      return res.status(400).json({
        message:
          "Cannot restore previous slot details. Please contact support.",
      });
    }

    // Start transaction to revert booking and process refund (50/50 split)
    let refundDetails = null;
    let providerPayoutDetails = null;

    await db.transaction(async (tx) => {
      // Restore original slot and date
      await tx
        .update(bookings)
        .set({
          slotId: booking.previousSlotId,
          bookingDate: booking.previousBookingDate,
          status: booking.previousStatus || "confirmed", // Restore to previous status
          rescheduleOutcome: "cancelled", // Mark reschedule as cancelled by customer
          // Keep reschedule tracking fields for invoice/history - don't clear them
          // previousSlotId/previousBookingDate now represent the original slot that was restored
          // Note: Don't decrement rescheduleCount - customer attempted reschedule (counts toward limit)
        })
        .where(eq(bookings.id, bookingId));

      // Find and process partial refund (50%) for reschedule fee
      const [reschedulePayment] = await tx
        .select()
        .from(payments)
        .where(
          and(eq(payments.bookingId, bookingId), isNull(payments.refundId)),
        )
        .orderBy(desc(payments.createdAt))
        .limit(1);

      if (reschedulePayment && reschedulePayment.amount > 0) {
        const rescheduleFeeAmount = reschedulePayment.amount; // Total fee (₹100)
        const customerRefundAmount = Math.round(rescheduleFeeAmount / 2); // 50% to customer (₹50)
        const providerPayoutAmount = rescheduleFeeAmount - customerRefundAmount; // 50% to provider (₹50)

        try {
          // Refund 50% to customer
          const refundResult = await initiateRefund(
            reschedulePayment.razorpayPaymentId,
            customerRefundAmount,
            "Reschedule fee 50% refunded - Customer cancelled reschedule request",
          );

          await tx
            .update(payments)
            .set({
              refundId: refundResult.id,
              refundAmount: customerRefundAmount,
              refundReason:
                "Reschedule fee 50% refunded - Customer cancelled reschedule request (50% kept by provider)",
              refundedAt: new Date(),
              status: "partially_refunded", // New status for partial refunds
              // Track provider's share of reschedule fee using existing providerShare field
              providerShare: providerPayoutAmount,
              // Track that this providerShare is from reschedule fee cancellation
              rescheduleFeePayoutStatus: "pending",
            })
            .where(eq(payments.id, reschedulePayment.id));

          refundDetails = {
            refundId: refundResult.id,
            refundAmount: paiseToRupees(customerRefundAmount),
            originalFee: paiseToRupees(rescheduleFeeAmount),
          };

          providerPayoutDetails = {
            amount: paiseToRupees(providerPayoutAmount),
            percentage: 50,
            status: "pending",
          };

          console.log(
            `✅ 50% Refund initiated for reschedule fee: ${refundResult.id}, Provider keeps: ₹${paiseToRupees(providerPayoutAmount)}`,
          );
        } catch (refundError) {
          console.error("Failed to initiate refund:", refundError);
          // Don't throw - allow booking revert even if refund fails
        }
      }
    });

    return res.status(200).json({
      message: refundDetails
        ? "Reschedule request cancelled. Original booking time restored. 50% refund processed."
        : "Reschedule request cancelled. Original booking time restored.",
      refund: refundDetails,
      providerPayout: providerPayoutDetails,
    });
  } catch (error) {
    console.error("Error cancelling reschedule request:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/**
 * Customer cancels booking with refund calculation
 * DELETE /booking/:id/cancel
 * Optional query param: ?reason=...
 */
const cancelBooking = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    // Get reason from query param or body (for flexibility)
    const reason =
      req.query.reason || req.body?.reason || "Cancelled by customer";

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    // Fetch the booking
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Verify user owns this booking
    if (booking.customerId !== userId) {
      return res
        .status(403)
        .json({ message: "You are not authorized to cancel this booking" });
    }

    // Check if booking can be cancelled
    if (
      !["pending", "confirmed", "reschedule_pending"].includes(booking.status)
    ) {
      return res.status(400).json({
        message: `Cannot cancel ${booking.status} bookings.`,
      });
    }

    // Get provider business profile (for provider payout info)
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking.businessProfileId))
      .limit(1);

    if (!business) {
      return res.status(404).json({ message: "Business profile not found" });
    }

    // Calculate refund and provider payout based on new rules
    const {
      customerRefundAmount,
      customerRefundPercentage,
      providerPayoutAmount,
      providerPayoutPercentage,
      platformFeeAmount,
      platformFeePercentage,
    } = calculateCancellationRefund(booking.status, booking.totalPrice);

    // Check if payment exists and process refund
    let refundDetails = null;
    let providerPayoutDetails = null;
    let platformFeeDetails = null;
    const [payment] = await db
      .select()
      .from(payments)
      .where(
        and(eq(payments.bookingId, bookingId), eq(payments.status, "paid")),
      )
      .limit(1);

    if (payment && payment.razorpayPaymentId && customerRefundAmount > 0) {
      try {
        // Refund customer portion
        const refund = await initiateRefund(
          payment.razorpayPaymentId,
          customerRefundAmount,
          `Booking cancelled by customer - ${customerRefundPercentage}% refund`,
        );

        await db
          .update(payments)
          .set({
            status: "refunded",
            refundId: refund.id,
            refundAmount: refund.amount,
            refundReason: `Booking cancelled by customer - ${customerRefundPercentage}% refund`,
            refundedAt: new Date(),
          })
          .where(eq(payments.id, payment.id));

        refundDetails = {
          refundId: refund.id,
          refundAmount: paiseToRupees(refund.amount),
          refundPercentage: customerRefundPercentage,
        };
      } catch (refundError) {
        console.error("Refund failed:", refundError);
        return res.status(500).json({
          message:
            "Failed to process refund. Please try again or contact support.",
          error: refundError.message,
        });
      }
    }

    // For confirmed bookings, track provider payout (10%) and platform fee (5%)
    // Note: Actual payout to provider would be processed via Razorpay Payouts API
    // or settled separately. For now, we track it as pending.
    if (booking.status === "confirmed") {
      if (providerPayoutAmount > 0) {
        providerPayoutDetails = {
          amount: paiseToRupees(providerPayoutAmount),
          percentage: providerPayoutPercentage,
          status: "pending", // To be processed via payout system
        };
      }
      if (platformFeeAmount > 0) {
        platformFeeDetails = {
          amount: paiseToRupees(platformFeeAmount),
          percentage: platformFeePercentage,
          status: "retained", // Platform retains this fee
        };
      }
    }

    // Update booking status - customer cancellation sets status to "cancelled"
    const [updatedBooking] = await db
      .update(bookings)
      .set({
        status: "cancelled",
        isRefunded: customerRefundAmount > 0,
        refundAmount: customerRefundAmount, // Track customer refund amount
        // Provider payout tracking
        providerPayoutAmount: providerPayoutAmount || null,
        providerPayoutStatus: providerPayoutAmount > 0 ? "pending" : null,
        // Platform fee tracking
        platformFeeAmount: platformFeeAmount || null,
        // Cancellation details
        cancelledAt: new Date(),
        cancellationReason: reason || "Cancelled by customer",
        cancelledBy: "customer",
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    // Send notification to provider about cancellation
    await notificationTemplates.bookingCancelled(bookingId);

    return res.status(200).json({
      message: refundDetails
        ? "Booking cancelled and refund initiated successfully"
        : "Booking cancelled successfully",
      booking: updatedBooking,
      refund: refundDetails,
      providerPayout: providerPayoutDetails,
      platformFee: platformFeeDetails,
    });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ============================================
// Updated Approve/Decline Reschedule
// ============================================

/**
 * Approve customer's reschedule request
 * PUT /booking/:id/reschedule-approve
 * Provider confirms the new time requested by customer
 */
const approveReschedule = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    // Fetch the booking
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Verify user is the provider for this booking
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking.businessProfileId))
      .limit(1);

    if (!business || business.providerId !== userId) {
      return res
        .status(403)
        .json({ message: "Only the provider can approve reschedule requests" });
    }

    // Check if booking is in reschedule_pending status
    if (booking.status !== "reschedule_pending") {
      return res.status(400).json({
        message: `Cannot approve reschedule. Booking status is ${booking.status}, expected reschedule_pending.`,
      });
    }

    // Update booking status to confirmed with accepted reschedule
    // Reschedule fee (₹100) goes to provider - track this
    const [updatedBooking] = await db
      .update(bookings)
      .set({
        status: "confirmed",
        rescheduleOutcome: "accepted", // Mark reschedule as accepted
        rescheduleFeeProviderPayout: booking.lastRescheduleFee || 0, // Track fee going to provider
        rescheduleFeePayoutStatus: "pending", // Pending payout to provider
        // Keep previousSlotId and previousBookingDate for invoice/history
        // Don't clear them - we need them to show "Previous → New" slot
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    // Send notification to customer about approved reschedule
    await notificationTemplates.rescheduleApproved(bookingId);

    return res.status(200).json({
      message:
        "Reschedule approved successfully. Booking is now confirmed with the new time.",
      booking: updatedBooking,
      rescheduleFeeToProvider: booking.lastRescheduleFee
        ? paiseToRupees(booking.lastRescheduleFee)
        : null,
    });
  } catch (error) {
    console.error("Error approving reschedule:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Decline customer's reschedule request
 * PUT /booking/:id/reschedule-decline
 * Provider rejects the reschedule - restores original slot and initiates refund
 */
const declineReschedule = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    const { reason } = req.body; // Optional reason for declining

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    // Fetch the booking
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Verify user is the provider for this booking
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking.businessProfileId))
      .limit(1);

    if (!business || business.providerId !== userId) {
      return res
        .status(403)
        .json({ message: "Only the provider can decline reschedule requests" });
    }

    // Check if booking is in reschedule_pending status
    if (booking.status !== "reschedule_pending") {
      return res.status(400).json({
        message: `Cannot decline reschedule. Booking status is ${booking.status}, expected reschedule_pending.`,
      });
    }

    // Check if there are previous slot values to restore
    if (!booking.previousSlotId || !booking.previousBookingDate) {
      return res.status(400).json({
        message:
          "Cannot restore previous slot details. Please contact support.",
      });
    }

    // Start transaction to revert booking and process refund
    await db.transaction(async (tx) => {
      // Store the requested slot before reverting (for invoice/history)
      const requestedSlotId = booking.slotId;
      const requestedDate = booking.bookingDate;

      // Restore original slot and date
      await tx
        .update(bookings)
        .set({
          slotId: booking.previousSlotId,
          bookingDate: booking.previousBookingDate,
          status: "confirmed", // Back to confirmed with original time
          rescheduleOutcome: "rejected", // Mark reschedule as rejected
          // Keep reschedule tracking fields for invoice/history - don't clear them
          // previousSlotId/previousBookingDate now represent the original slot that was restored
          // The current slotId/bookingDate are the original confirmed slot
          // We need to store what was requested - use rescheduleReason field or add comment
          // For now, keep all fields for invoice display
          // Note: Don't decrement rescheduleCount - customer attempted reschedule
        })
        .where(eq(bookings.id, bookingId));

      // Find the reschedule fee payment
      const [reschedulePayment] = await tx
        .select()
        .from(payments)
        .where(
          and(eq(payments.bookingId, bookingId), isNull(payments.refundId)),
        )
        .orderBy(desc(payments.createdAt))
        .limit(1);

      if (reschedulePayment) {
        try {
          const refundResult = await initiateRefund(
            reschedulePayment.razorpayPaymentId,
            null, // Full refund
            reason || "Reschedule request declined by provider",
          );

          await tx
            .update(payments)
            .set({
              refundId: refundResult.id,
              refundAmount: reschedulePayment.amount,
              refundReason: reason || "Reschedule request declined by provider",
              refundedAt: new Date(),
              status: "refunded",
            })
            .where(eq(payments.id, reschedulePayment.id));

          console.log(
            `✅ Refund initiated for reschedule fee: ${refundResult.id}`,
          );
        } catch (refundError) {
          console.error("Failed to initiate refund:", refundError);
          throw new Error(
            "Reschedule declined but failed to process refund. Please contact support.",
          );
        }
      }
    });

    // Send notification to customer about declined reschedule
    await notificationTemplates.rescheduleDeclined(bookingId);

    return res.status(200).json({
      message:
        "Reschedule declined. Original booking time restored and refund initiated.",
    });
  } catch (error) {
    console.error("Error declining reschedule:", error);
    return res.status(500).json({
      message: error.message || "Server error",
    });
  }
};

// ============================================
// Legacy Functions (kept for backward compatibility)
// ============================================

// Reschedule booking - customer can reschedule pending or confirmed bookings
const rescheduleBooking = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    const { slotId, bookingDate } = req.body;

    // Validate input
    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }
    if (!slotId || !bookingDate) {
      return res
        .status(400)
        .json({ message: "slotId and bookingDate are required" });
    }

    // Validate booking date format
    const bookingDateObj = new Date(bookingDate);
    if (isNaN(bookingDateObj.getTime())) {
      return res.status(400).json({ message: "Invalid bookingDate format" });
    }

    // Check if booking date is in the past
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const bookingDateStart = new Date(
      bookingDateObj.getFullYear(),
      bookingDateObj.getMonth(),
      bookingDateObj.getDate(),
    );

    if (bookingDateStart < todayStart) {
      return res
        .status(400)
        .json({ message: "Cannot reschedule to past dates" });
    }

    // Fetch the booking
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Verify user owns this booking
    if (booking.customerId !== userId) {
      return res
        .status(403)
        .json({ message: "You are not authorized to reschedule this booking" });
    }

    // Check if booking can be rescheduled (only pending or confirmed)
    if (!["pending", "confirmed"].includes(booking.status)) {
      return res.status(400).json({
        message: `Cannot reschedule ${booking.status} bookings. Only pending and confirmed bookings can be rescheduled.`,
      });
    }

    // Validate the new slot exists
    const [slot] = await db.select().from(slots).where(eq(slots.id, slotId));

    if (!slot) {
      return res.status(404).json({ message: "Slot not found" });
    }

    // Verify slot belongs to the same business as original booking
    if (slot.businessProfileId !== booking.businessProfileId) {
      return res.status(400).json({
        message: "Selected slot does not belong to the service provider",
      });
    }

    // Check if new slot is available for the selected date
    const startOfDay = new Date(bookingDateObj);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDateObj);
    endOfDay.setHours(23, 59, 59, 999);

    const existingBooking = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.slotId, slotId),
          gte(bookings.bookingDate, startOfDay),
          lte(bookings.bookingDate, endOfDay),
          // Exclude the current booking itself
          eq(bookings.id, bookingId),
        ),
      );

    // Check if there's any other booking for this slot on this date
    const otherBookings = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.slotId, slotId),
          gte(bookings.bookingDate, startOfDay),
          lte(bookings.bookingDate, endOfDay),
        ),
      );

    // Filter out the current booking from the results
    const conflictingBookings = otherBookings.filter((b) => b.id !== bookingId);

    if (conflictingBookings.length > 0) {
      return res
        .status(400)
        .json({ message: "Slot is already booked for the selected date" });
    }

    // If rescheduling to today, check if slot time is in the past
    if (bookingDateStart.getTime() === todayStart.getTime()) {
      const [slotHours, slotMinutes, slotSeconds = 0] = slot.startTime
        .split(":")
        .map(Number);

      const slotDateTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        slotHours,
        slotMinutes,
        slotSeconds,
      );

      // Allow rescheduling if slot is at least 30 minutes in the future
      const bufferMinutes = 30;
      if (slotDateTime <= new Date(now.getTime() + bufferMinutes * 60 * 1000)) {
        return res.status(400).json({
          message:
            "Cannot reschedule to a slot that has already passed or is too soon",
        });
      }
    }

    // Update the booking with new slot and date
    const [updatedBooking] = await db
      .update(bookings)
      .set({
        slotId: slotId,
        bookingDate: bookingDateObj,
        // Keep status the same (pending or confirmed)
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    return res.status(200).json({
      message: "Booking rescheduled successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Reschedule booking error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

//complete booking by business owner after slot time passed
const completeBooking = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }
    // 1. Fetch booking
    const booking = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (booking.length === 0) {
      return res.status(404).json({ message: "Booking not found" });
    }
    // 2. Check booking status
    if (booking[0].status !== "confirmed") {
      return res
        .status(400)
        .json({ message: "Only confirmed bookings can be completed" });
    }
    // 3. Fetch business profile
    const businessProfile = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking[0].businessProfileId));
    if (businessProfile.length === 0) {
      return res.status(404).json({ message: "Business profile not found" });
    }
    // 4. Verify provider owns the business
    if (businessProfile[0].providerId !== userId) {
      return res
        .status(403)
        .json({ message: "You are not authorized to complete this booking" });
    }
    // check if slot exists
    const slot = await db
      .select()
      .from(slots)
      .where(eq(slots.id, booking[0].slotId));

    if (slot.length === 0) {
      return res.status(404).json({ message: "Slot not found" });
    }

    // For simplicity, allow completing confirmed bookings without time check
    // The provider can manually complete when service is done
    // If you want to enforce time-based completion, uncomment below:

    // // Parse slot start time (Postgres TIME comes as string "HH:mm:ss")
    // const [startHour, startMinute] = slot[0].startTime.split(":").map(Number);
    // // Assume 1 hour duration for service, or use service.duration
    // const slotEndDateTime = new Date(booking[0].bookingDate);
    // slotEndDateTime.setHours(startHour + 1, startMinute, 0, 0); // +1 hour for service duration
    // const now = new Date();
    // const bookingDateTime = new Date(booking[0].bookingDate);

    // // 🔴 Case 1: Booking date is in the future
    // if (now < bookingDateTime.setHours(0,0,0,0)) {
    //   return res.status(400).json({
    //     message: "Booking date has not arrived yet",
    //   });
    // }

    // // 🟠 Case 2: Same day → check if slot time has passed
    // const todayDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // const bookingDateOnly = new Date(bookingDateTime.getFullYear(), bookingDateTime.getMonth(), bookingDateTime.getDate());

    // if (todayDateOnly.getTime() === bookingDateOnly.getTime() && now < slotEndDateTime) {
    //   return res.status(400).json({
    //     message: "Slot time has not finished yet",
    //   });
    // 5. Update booking status
    const [updatedBooking] = await db
      .update(bookings)
      .set({ status: "completed" })
      .where(eq(bookings.id, bookingId))
      .returning();

    // 6. Set provider payout status to "pending" for the payment
    // This marks that the provider has earned the money and is ready for payout
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .limit(1);

    if (payment && payment.status === "paid") {
      await db
        .update(payments)
        .set({ providerPayoutStatus: "pending" })
        .where(eq(payments.id, payment.id));
      console.log(`✅ Payment ${payment.id} marked as "pending" for payout`);
    }

    // Send notification to customer about booking completion
    await notificationTemplates.bookingCompleted(bookingId);

    return res.status(200).json({
      message: "Booking completed successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Provider-initiated reschedule
 * PUT /booking/:id/provider-reschedule
 * Provider can reschedule with reason - auto-approved
 */
const providerReschedule = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    const { slotId, bookingDate, reason } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }
    if (!slotId || !bookingDate) {
      return res
        .status(400)
        .json({ message: "slotId and bookingDate are required" });
    }
    if (!reason) {
      return res
        .status(400)
        .json({ message: "Reason is required for provider reschedule" });
    }

    // Validate booking date format
    const bookingDateObj = new Date(bookingDate);
    if (isNaN(bookingDateObj.getTime())) {
      return res.status(400).json({ message: "Invalid bookingDate format" });
    }

    // Fetch the booking
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Verify user is the provider for this booking
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking.businessProfileId))
      .limit(1);

    if (!business || business.providerId !== userId) {
      return res
        .status(403)
        .json({ message: "Only the provider can reschedule bookings" });
    }

    // Check if booking can be rescheduled
    if (!["pending", "confirmed"].includes(booking.status)) {
      return res.status(400).json({
        message: `Cannot reschedule ${booking.status} bookings.`,
      });
    }

    // Validate the new slot exists
    const [slot] = await db.select().from(slots).where(eq(slots.id, slotId));

    if (!slot) {
      return res.status(404).json({ message: "Slot not found" });
    }

    // Verify slot belongs to the same business
    if (slot.businessProfileId !== booking.businessProfileId) {
      return res.status(400).json({
        message: "Selected slot does not belong to your business",
      });
    }

    // Check if new slot is available
    const startOfDay = new Date(bookingDateObj);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDateObj);
    endOfDay.setHours(23, 59, 59, 999);

    // Check if new slot is already booked for the SAME service
    // Different services can use the same time slot simultaneously
    const [conflictingBooking] = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.slotId, slotId),
          eq(bookings.serviceId, booking.serviceId), // Only check same service
          gte(bookings.bookingDate, startOfDay),
          lte(bookings.bookingDate, endOfDay),
          or(eq(bookings.status, "pending"), eq(bookings.status, "confirmed")),
          ne(bookings.id, bookingId), // Exclude the current booking itself
        ),
      )
      .limit(1);

    if (conflictingBooking) {
      return res.status(409).json({
        message:
          "This slot is already booked for this service. Please select a different time.",
      });
    }

    // Update booking with new slot (provider reschedule is auto-approved)
    const [updatedBooking] = await db
      .update(bookings)
      .set({
        slotId: slotId,
        bookingDate: bookingDateObj,
        status: "confirmed", // Auto-confirmed for provider reschedule
        rescheduleReason: reason,
        rescheduledBy: "provider",
        rescheduledAt: new Date(),
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    return res.status(200).json({
      message: "Booking rescheduled successfully. Customer will be notified.",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Error in provider reschedule:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Get all bookings (admin only)
 * GET /admin/bookings/all
 */
const getAllBookingsForAdmin = async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    // Fetch all bookings
    let allBookings = await db
      .select()
      .from(bookings)
      .orderBy(desc(bookings.bookingDate))
      .limit(Number(limit))
      .offset(Number(offset));

    // Enrich bookings with related data
    const enrichedBookings = await Promise.all(
      allBookings.map(async (booking) => {
        // Get customer info (note: bookings table uses customerId, not userId)
        const [customer] = await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            phone: users.phone,
          })
          .from(users)
          .where(eq(users.id, booking.customerId))
          .limit(1);

        // Get business profile
        const [business] = await db
          .select({
            id: businessProfiles.id,
            name: businessProfiles.businessName,
            phone: businessProfiles.phone,
            city: businessProfiles.city,
            state: businessProfiles.state,
          })
          .from(businessProfiles)
          .where(eq(businessProfiles.id, booking.businessProfileId))
          .limit(1);

        // Get service info
        const [service] = await db
          .select({
            id: services.id,
            name: services.name,
            price: services.price,
          })
          .from(services)
          .where(eq(services.id, booking.serviceId))
          .limit(1);

        // Get address info
        const [address] = await db
          .select()
          .from(Address)
          .where(eq(Address.id, booking.addressId))
          .limit(1);

        return {
          ...booking,
          // Map bookingDate to createdAt for frontend compatibility
          createdAt: booking.bookingDate,
          user: customer || null,
          businessProfile: business || null,
          service: service || null,
          address: address || null,
          slot: booking.bookingDate
            ? {
                date: booking.bookingDate,
                startTime: booking.slotStartTime,
                endTime: booking.slotEndTime,
              }
            : null,
        };
      }),
    );

    // Apply status filter if provided
    let filteredBookings = enrichedBookings;
    if (status && status !== "all") {
      filteredBookings = enrichedBookings.filter((b) => b.status === status);
    }

    // Get total count
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(bookings);

    return res.status(200).json({
      bookings: filteredBookings,
      total: count,
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (error) {
    console.error("Error fetching all bookings:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// ============================================
// OTP-Based Service Completion Verification
// ============================================

/**
 * Generate a 6-digit OTP for completion verification
 */
function generateCompletionOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Initiate completion - Generate and send OTP to customer
 * POST /api/booking/:id/complete-initiate
 */
const initiateCompletion = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    const { beforePhotoUrl, afterPhotoUrl, completionNotes } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    console.log(
      `[initiateCompletion] Provider ${userId} initiating completion for booking ${bookingId}`,
    );

    // 1. Fetch booking with business profile and service
    const [booking] = await db
      .select({
        booking: bookings,
        business: businessProfiles,
        service: services,
      })
      .from(bookings)
      .innerJoin(
        businessProfiles,
        eq(bookings.businessProfileId, businessProfiles.id),
      )
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // 2. Check booking status
    if (booking.booking.status !== "confirmed") {
      return res.status(400).json({
        message: "Only confirmed bookings can be marked for completion",
        currentStatus: booking.booking.status,
      });
    }

    // 3. Verify provider owns the business
    if (booking.business.providerId !== userId) {
      return res
        .status(403)
        .json({ message: "You are not authorized to complete this booking" });
    }

    // 4. Generate OTP
    const otp = generateCompletionOTP();
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // 5. Update booking with OTP and optional photos/notes
    const updateData = {
      completionOtp: otp,
      completionOtpExpiry: otpExpiry,
    };

    if (beforePhotoUrl) updateData.beforePhotoUrl = beforePhotoUrl;
    if (afterPhotoUrl) updateData.afterPhotoUrl = afterPhotoUrl;
    if (completionNotes) updateData.completionNotes = completionNotes;

    await db.update(bookings).set(updateData).where(eq(bookings.id, bookingId));
    await logBookingHistory(bookingId, "completed", "Booking was marked as completed.", "provider", userId);

    // 6. Send OTP email to customer
    const customer = await db
      .select()
      .from(users)
      .where(eq(users.id, booking.booking.customerId))
      .limit(1);

    if (customer.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    console.log(
      "[initiateCompletion] Customer email:",
      customer[0].email,
      "Customer name:",
      customer[0].name,
    );

    if (!customer[0].email) {
      return res.status(400).json({ message: "Customer email not found" });
    }

    // Get slot time for email
    const slot = await db
      .select()
      .from(slots)
      .where(eq(slots.id, booking.booking.slotId))
      .limit(1);

    const slotTime = slot.length > 0 ? slot[0].startTime : "N/A";
    const serviceName =
      booking.service?.name || booking.booking.serviceName || "Service";

    // Send OTP email (don't fail if email error occurs)
    try {
      // Format date for email
      const formattedDate = booking.booking.bookingDate
        ? new Date(booking.booking.bookingDate).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "";

      await sendCompletionOTPEmail(customer[0].email, otp, {
        customerName: customer[0].name,
        providerName: booking.business.businessName,
        serviceName,
        date: formattedDate,
        time: slotTime,
      });
    } catch (emailError) {
      console.error(
        "Email send failed (but OTP generated):",
        emailError.message,
      );
      // Continue anyway - OTP is saved in database
    }

    return res.status(200).json({
      message: "OTP sent to customer email for verification",
      otpExpiry: otpExpiry,
      canResendAfter: new Date(Date.now() + 60 * 1000), // Can resend after 1 minute
    });
  } catch (error) {
    console.error("Error initiating completion:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Verify OTP and complete booking
 * POST /api/booking/:id/complete-verify
 */
const verifyCompletionOTP = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    const { otp } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    if (!otp || otp.length !== 6) {
      return res.status(400).json({ message: "Invalid OTP format" });
    }

    console.log(`[verifyCompletionOTP] Verifying OTP for booking ${bookingId}`);

    // 1. Fetch booking with business profile
    const [booking] = await db
      .select({
        booking: bookings,
        business: businessProfiles,
      })
      .from(bookings)
      .innerJoin(
        businessProfiles,
        eq(bookings.businessProfileId, businessProfiles.id),
      )
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // 2. Verify provider owns the business
    if (booking.business.providerId !== userId) {
      return res
        .status(403)
        .json({ message: "You are not authorized to verify this booking" });
    }

    // 3. Check if OTP was generated
    if (!booking.booking.completionOtp) {
      return res.status(400).json({
        message: "No OTP generated. Please initiate completion first.",
      });
    }

    // 4. Check if OTP has expired
    if (new Date() > new Date(booking.booking.completionOtpExpiry)) {
      return res.status(400).json({
        message: "OTP has expired. Please request a new OTP.",
        expired: true,
      });
    }

    // 5. Verify OTP matches
    if (booking.booking.completionOtp !== otp) {
      return res.status(400).json({
        message: "Invalid OTP. Please try again.",
        success: false,
      });
    }

    // 6. OTP is correct - complete the booking
    const [updatedBooking] = await db
      .update(bookings)
      .set({
        status: "completed",
        completionOtp: null, // Clear OTP
        completionOtpExpiry: null,
        completionOtpVerifiedAt: new Date(),
        actualCompletionTime: new Date(),
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    // 7. Set provider payout status to "pending"
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .limit(1);

    if (payment && payment.status === "paid") {
      await db
        .update(payments)
        .set({ providerPayoutStatus: "pending" })
        .where(eq(payments.id, payment.id));
      console.log(`✅ Payment ${payment.id} marked as "pending" for payout`);
    }

    // 8. Send notification to customer
    await notificationTemplates.bookingCompleted(bookingId);

    return res.status(200).json({
      message: "Booking completed successfully",
      success: true,
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Error verifying completion OTP:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Resend completion OTP
 * POST /api/booking/:id/complete-resend
 */
const resendCompletionOTP = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    console.log(`[resendCompletionOTP] Resending OTP for booking ${bookingId}`);

    // 1. Fetch booking with business profile, customer, and service
    const [booking] = await db
      .select({
        booking: bookings,
        business: businessProfiles,
        customer: users,
        service: services,
      })
      .from(bookings)
      .innerJoin(
        businessProfiles,
        eq(bookings.businessProfileId, businessProfiles.id),
      )
      .innerJoin(users, eq(bookings.customerId, users.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // 2. Verify provider owns the business
    if (booking.business.providerId !== userId) {
      return res
        .status(403)
        .json({ message: "You are not authorized for this action" });
    }

    // 3. Check booking status
    if (booking.booking.status === "completed") {
      return res.status(400).json({ message: "Booking is already completed" });
    }

    // 4. Generate new OTP
    const otp = generateCompletionOTP();
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // 5. Update booking with new OTP
    await db
      .update(bookings)
      .set({
        completionOtp: otp,
        completionOtpExpiry: otpExpiry,
      })
      .where(eq(bookings.id, bookingId));

    // 6. Send OTP email
    console.log(
      "[resendCompletionOTP] Customer email:",
      booking.customer.email,
      "Customer name:",
      booking.customer.name,
    );

    if (!booking.customer.email) {
      return res.status(400).json({ message: "Customer email not found" });
    }

    const slot = await db
      .select()
      .from(slots)
      .where(eq(slots.id, booking.booking.slotId))
      .limit(1);

    const slotTime = slot.length > 0 ? slot[0].startTime : "N/A";
    const serviceName =
      booking.service?.name || booking.booking.serviceName || "Service";

    // Send OTP email (don't fail if email error occurs)
    try {
      // Format date for email
      const formattedDate = booking.booking.bookingDate
        ? new Date(booking.booking.bookingDate).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "";

      await sendCompletionOTPEmail(booking.customer.email, otp, {
        customerName: booking.customer.name,
        providerName: booking.business.businessName,
        serviceName,
        date: formattedDate,
        time: slotTime,
      });
    } catch (emailError) {
      console.error(
        "Email send failed (but OTP was regenerated):",
        emailError.message,
      );
      // Continue anyway - OTP is saved in database
    }

    return res.status(200).json({
      message: "New OTP sent to customer email",
      otpExpiry: otpExpiry,
    });
  } catch (error) {
    console.error("Error resending completion OTP:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Upload completion photos (before/after)
 * POST /api/booking/:id/completion-photos
 */
const uploadCompletionPhotos = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    const { beforePhotoUrl, afterPhotoUrl } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    if (!beforePhotoUrl && !afterPhotoUrl) {
      return res.status(400).json({
        message: "At least one photo (before or after) is required",
      });
    }

    console.log(
      `[uploadCompletionPhotos] Uploading photos for booking ${bookingId}`,
    );

    // 1. Fetch booking with business profile
    const [booking] = await db
      .select({
        booking: bookings,
        business: businessProfiles,
      })
      .from(bookings)
      .innerJoin(
        businessProfiles,
        eq(bookings.businessProfileId, businessProfiles.id),
      )
      .where(eq(bookings.id, bookingId));
    await logBookingHistory(bookingId, "reschedule_rejected", "Provider rejected the requested reschedule.", "provider", userId);
    await logBookingHistory(bookingId, "reschedule_accepted", "Provider accepted the requested reschedule.", "provider", userId);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // 2. Verify provider owns the business
    if (booking.business.providerId !== userId) {
      return res.status(403).json({
        message: "You are not authorized to upload photos for this booking",
      });
    }

    // 3. Update booking with photo URLs
    const updateData = {};
    if (beforePhotoUrl) updateData.beforePhotoUrl = beforePhotoUrl;
    if (afterPhotoUrl) updateData.afterPhotoUrl = afterPhotoUrl;

    const [updatedBooking] = await db
      .update(bookings)
      .set(updateData)
      .where(eq(bookings.id, bookingId))
      .returning();
    if (req.body.reason) { await logBookingHistory(bookingId, "reschedule_requested", `Reschedule requested.`, "customer", userId); }

    return res.status(200).json({
      message: "Photos uploaded successfully",
      beforePhotoUrl: updatedBooking.beforePhotoUrl,
      afterPhotoUrl: updatedBooking.afterPhotoUrl,
    });
  } catch (error) {
    console.error("Error uploading completion photos:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

const { bookingHistory } = require("../models/schema");

const getBookingHistory = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    if (!bookingId) return res.status(400).json({ message: "Booking ID is required" });
    const [booking] = await db.select({ booking: bookings, business: businessProfiles }).from(bookings).leftJoin(businessProfiles, eq(bookings.businessProfileId, businessProfiles.id)).where(eq(bookings.id, bookingId));
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.booking.customerId !== userId && (!booking.business || booking.business.providerId !== userId) && req.token.roleId !== 3) return res.status(403).json({ message: "Not authorized" });
    const history = await db.select().from(bookingHistory).where(eq(bookingHistory.bookingId, bookingId)).orderBy(bookingHistory.createdAt);
    return res.status(200).json({ history });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
module.exports = {
  getBookingById,
  getCustomerBookings,
  getProviderBookings,
  getAllBookingsForAdmin,
  addBooking,
  acceptBooking,
  rejectBooking,
  completeBooking,
  rescheduleBooking,
  // New reschedule functions with fee logic
  requestReschedule,
  cancelRescheduleRequest,
  cancelBooking,
  // Existing reschedule management
  approveReschedule,
  declineReschedule,
  providerReschedule,
  // OTP-based completion verification
  initiateCompletion,
  verifyCompletionOTP,
  resendCompletionOTP,
  uploadCompletionPhotos,
  getBookingHistory,
};


