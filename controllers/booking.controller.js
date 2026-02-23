const db = require("../config/db");
const {
  businessProfiles,
  slots,
  services,
  Address,
  bookings,
} = require("../models/schema");
const { eq, and, gte, lte, desc } = require("drizzle-orm");

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

    if (booking.customerId !== userId && (!business[0] || business[0].providerId !== userId)) {
      return res.status(403).json({ message: "You are not authorized to view this booking" });
    }

    res.status(200).json({ booking });
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
      .orderBy(desc(bookings.createdAt));

    res.status(200).json({ bookings: customerBookings });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all bookings for logged-in provider
const getProviderBookings = async (req, res) => {
  try {
    const userId = req.token.id;

    // First get the business profile for this provider
    const business = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.providerId, userId))
      .limit(1);

    if (business.length === 0) {
      return res.status(404).json({ message: "Business profile not found" });
    }

    const providerBookings = await db
      .select()
      .from(bookings)
      .where(eq(bookings.businessProfileId, business[0].id))
      .orderBy(desc(bookings.createdAt));

    res.status(200).json({ bookings: providerBookings });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const addBooking = async (req, res) => {
  try {
    const userId = req.token.id;
    const { serviceId, slotId, addressId, bookingDate } = req.body;
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
      now.getDate()
    );
    const bookingDateStart = new Date(
      bookingDateObj.getFullYear(),
      bookingDateObj.getMonth(),
      bookingDateObj.getDate()
    );

    console.log("todayStart:", todayStart);
    console.log("bookingDateStart:", bookingDateStart);
    console.log(
      "Are they the same day?",
      bookingDateStart.getTime() === todayStart.getTime()
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
        slotSeconds
      );

      // Create slot datetime in local timezone using today's date
      const slotDateTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        slotHours,
        slotMinutes,
        slotSeconds
      );

      console.log("slotDateTime:", slotDateTime);
      console.log("slotDateTime ISO:", slotDateTime.toISOString());
      console.log("slotDateTime Local:", slotDateTime.toString());
      console.log("Current time:", now);
      console.log("Is slotDateTime <= now?", slotDateTime <= now);
      console.log(
        "Time difference (minutes):",
        (slotDateTime - now) / (1000 * 60)
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

    // Check if slot is not already booked for the booking date
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
          lte(bookings.bookingDate, endOfDay)
        )
      );

    if (existingBooking.length > 0) {
      return res
        .status(400)
        .json({ message: "Slot is already booked for the selected date" });
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
      .set({ status: "cancelled" })
      .where(eq(bookings.id, bookingId))
      .returning();

    return res.status(200).json({
      message: "Booking Cancelled successfully",
      booking: updatedBooking,
    });
  } catch (error) {
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
    // check if current time is after slot end time
    const slot = await db
      .select()
      .from(slots)
      .where(eq(slots.id, booking[0].slotId));
    // const currentTime = new Date();
    // Parse slot end time (Postgres TIME comes as string "HH:mm:ss")
    const [endHour, endMinute, endSecond] = slot[0].endTime
      .split(":")
      .map(Number);

    const slotEndDateTime = new Date(booking[0].bookingDate);
    slotEndDateTime.setHours(endHour, endMinute, endSecond || 0, 0);
    const now = new Date();
    const bookingDateTime = new Date(booking[0].bookingDate);

    // Normalize dates (ignore time)
    const todayDateOnly = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    const bookingDateOnly = new Date(
      bookingDateTime.getFullYear(),
      bookingDateTime.getMonth(),
      bookingDateTime.getDate()
    );

    // 🔴 Case 1: Booking date is in the future
    if (todayDateOnly < bookingDateOnly) {
      return res.status(400).json({
        message: "Booking date has not arrived yet",
      });
    }

    // 🟠 Case 2: Same day → check slot end time
    if (todayDateOnly.getTime() === bookingDateOnly.getTime()) {
      if (now < slotEndDateTime) {
        return res.status(400).json({
          message: "Slot time has not finished yet",
        });
      }
    }
    // 5. Update booking status
    const [updatedBooking] = await db
      .update(bookings)
      .set({ status: "completed" })
      .where(eq(bookings.id, bookingId))
      .returning();
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
module.exports = {
  getBookingById,
  getCustomerBookings,
  getProviderBookings,
  addBooking,
  acceptBooking,
  rejectBooking,
  completeBooking,
};
