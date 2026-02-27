const db = require("../config/db");
const { feedback, bookings, services, users } = require("../models/schema");
const { eq } = require("drizzle-orm");

// Get feedback by business ID
const getFeedbackByBusiness = async (req, res) => {
  try {
    const businessId = Number(req.params.businessId);

    if (!businessId) {
      return res.status(400).json({ message: "Business ID is required" });
    }

    // Get all bookings for this business with customer details
    const businessBookings = await db
      .select({
        id: bookings.id,
        feedbackId: feedback.id,
        rating: feedback.rating,
        comments: feedback.comments,
        createdAt: feedback.createdAt,
        customerId: bookings.customerId,
        customerName: users.name,
        customerAvatar: users.avatar,
        serviceId: bookings.serviceId,
      })
      .from(bookings)
      .innerJoin(users, eq(bookings.customerId, users.id))
      .where(eq(bookings.businessProfileId, businessId))
      .leftJoin(feedback, eq(feedback.bookingId, bookings.id))
      .orderBy(feedback.createdAt);

    // Transform to match frontend expectations
    const transformedFeedback = businessBookings
      .filter((fb) => fb.feedbackId !== null) // Only include bookings with feedback
      .map((fb) => ({
        id: fb.feedbackId,
        rating: fb.rating,
        comments: fb.comments,
        createdAt: fb.createdAt,
        customerId: fb.customerId,
        customer: {
          name: fb.customerName,
          avatar: fb.customerAvatar,
        },
      }));

    res.status(200).json({ feedback: transformedFeedback });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get feedback by service ID
const getFeedbackByService = async (req, res) => {
  try {
    const serviceId = Number(req.params.serviceId);

    if (!serviceId) {
      return res.status(400).json({ message: "Service ID is required" });
    }

    // Get all feedback for this service with customer details
    const serviceFeedback = await db
      .select({
        id: feedback.id,
        bookingId: feedback.bookingId,
        rating: feedback.rating,
        comments: feedback.comments,
        createdAt: feedback.createdAt,
        customerId: feedback.customerId,
        customerName: users.name,
        customerAvatar: users.avatar,
      })
      .from(feedback)
      .innerJoin(users, eq(feedback.customerId, users.id))
      .where(eq(feedback.serviceId, serviceId))
      .orderBy(feedback.createdAt);

    // Transform to match frontend expectations
    const transformedFeedback = serviceFeedback.map((fb) => ({
      id: fb.id,
      bookingId: fb.bookingId,
      rating: fb.rating,
      comments: fb.comments,
      createdAt: fb.createdAt,
      customerId: fb.customerId,
      customer: {
        name: fb.customerName,
        avatar: fb.customerAvatar,
      },
    }));

    res.status(200).json({ feedback: transformedFeedback });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const addFeedback = async (req, res) => {
  try {
    const userId = req.token.id;
    const { bookingId, rating, comments } = req.body;

    if (!bookingId || !rating) {
      return res
        .status(400)
        .json({ message: "Booking ID and rating are required" });
    }

    const booking = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (booking.length === 0) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking[0].status !== "completed") {
      return res.status(400).json({
        message: "Feedback can only be added for completed bookings",
      });
    }

    if (booking[0].customerId !== userId) {
      return res.status(403).json({
        message: "You are not authorized to add feedback for this booking",
      });
    }
    //cjeck if feedback already exists for this booking
    const existingFeedback = await db
      .select()
      .from(feedback)
      .where(eq(feedback.bookingId, bookingId));
    if (existingFeedback.length > 0) {
      return res
        .status(400)
        .json({ message: "Feedback already exists for this booking" });
    }

    const [newFeedback] = await db
      .insert(feedback)
      .values({
        bookingId,
        serviceId: booking[0].serviceId,
        customerId: booking[0].customerId,
        rating,
        comments,
      })
      .returning();

    // Update service rating
    const allFeedback = await db
      .select()
      .from(feedback)
      .where(eq(feedback.serviceId, booking[0].serviceId));

    const avgRating = allFeedback.reduce((sum, f) => sum + Number(f.rating), 0) / allFeedback.length;

    await db
      .update(services)
      .set({
        rating: avgRating.toFixed(2),
        totalReviews: allFeedback.length,
      })
      .where(eq(services.id, booking[0].serviceId));

    return res.status(201).json({
      message: "Feedback added successfully",
      feedback: newFeedback,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  getFeedbackByBusiness,
  getFeedbackByService,
  addFeedback,
};
