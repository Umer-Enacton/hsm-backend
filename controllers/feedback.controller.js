const db = require("../config/db");
const {
  feedback,
  bookings,
  services,
  users,
  businessProfiles,
} = require("../models/schema");
const { eq, and, gte, lte, desc, or, like, isNull, sql, inArray } = require("drizzle-orm");
const { initiateRefund, paiseToRupees } = require("../utils/razorpay");

// Get feedback by business ID (customer facing - only visible reviews)
const getFeedbackByBusiness = async (req, res) => {
  try {
    const businessId = Number(req.params.businessId);

    if (!businessId) {
      return res.status(400).json({ message: "Business ID is required" });
    }

    // Get all visible feedback for this business's services
    const businessServices = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessProfileId, businessId));

    if (businessServices.length === 0) {
      return res.status(200).json({ feedback: [] });
    }

    const serviceIds = businessServices.map((s) => s.id);

    const feedbackList = await db
      .select({
        id: feedback.id,
        rating: feedback.rating,
        comments: feedback.comments,
        createdAt: feedback.createdAt,
        customerId: feedback.customerId,
        customerName: users.name,
        customerAvatar: users.avatar,
      })
      .from(feedback)
      .innerJoin(users, eq(feedback.customerId, users.id))
      .where(
        and(
          inArray(feedback.serviceId, serviceIds),
          eq(feedback.isVisible, true) // Only show visible reviews to customers
        )
      )
      .orderBy(desc(feedback.createdAt));

    // Transform to match frontend expectations
    const transformedFeedback = feedbackList.map((fb) => ({
      id: fb.id,
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

// Get feedback by service ID (customer facing - only visible reviews)
const getFeedbackByService = async (req, res) => {
  try {
    const serviceId = Number(req.params.serviceId);

    if (!serviceId) {
      return res.status(400).json({ message: "Service ID is required" });
    }

    // Get all visible feedback for this service with customer details
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
      .where(
        and(
          eq(feedback.serviceId, serviceId),
          eq(feedback.isVisible, true) // Only show visible reviews to customers
        )
      )
      .orderBy(desc(feedback.createdAt));

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

// Toggle review visibility (hide/show)
const toggleReviewVisibility = async (req, res) => {
  try {
    const feedbackId = Number(req.params.id);
    const userId = req.token.id;

    if (!feedbackId) {
      return res.status(400).json({ message: "Feedback ID is required" });
    }

    // Get the feedback
    const feedbackRecords = await db
      .select()
      .from(feedback)
      .where(eq(feedback.id, feedbackId));

    if (feedbackRecords.length === 0) {
      return res.status(404).json({ message: "Review not found" });
    }

    const feedbackRecord = feedbackRecords[0];

    // Get the service to find the business
    const serviceRecords = await db
      .select()
      .from(services)
      .where(eq(services.id, feedbackRecord.serviceId));

    if (serviceRecords.length === 0) {
      return res.status(404).json({ message: "Service not found" });
    }

    const service = serviceRecords[0];

    // Get business profile to verify provider ownership
    const businessRecords = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, service.businessProfileId));

    if (businessRecords.length === 0 || businessRecords[0].providerId !== userId) {
      return res.status(403).json({ message: "Only the provider can manage reviews" });
    }

    // Toggle visibility
    const newVisibility = !feedbackRecord.isVisible;
    const updatedRecords = await db
      .update(feedback)
      .set({
        isVisible: newVisibility,
        // If hiding, track who hid it and when
        ...(!newVisibility && {
          hiddenBy: userId,
          hiddenAt: new Date(),
        }),
        // If showing, clear hidden tracking
        ...(newVisibility && {
          hiddenBy: null,
          hiddenAt: null,
        }),
      })
      .where(eq(feedback.id, feedbackId))
      .returning();

    return res.status(200).json({
      message: newVisibility ? "Review is now visible" : "Review is now hidden",
      feedback: updatedRecords[0],
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Add provider reply to review
const addProviderReply = async (req, res) => {
  try {
    const feedbackId = Number(req.params.id);
    const userId = req.token.id;
    const { reply } = req.body;

    if (!feedbackId) {
      return res.status(400).json({ message: "Feedback ID is required" });
    }

    if (!reply || reply.trim().length === 0) {
      return res.status(400).json({ message: "Reply cannot be empty" });
    }

    if (reply.length > 1000) {
      return res.status(400).json({ message: "Reply cannot exceed 1000 characters" });
    }

    // Get the feedback
    const feedbackRecords = await db
      .select()
      .from(feedback)
      .where(eq(feedback.id, feedbackId));

    if (feedbackRecords.length === 0) {
      return res.status(404).json({ message: "Review not found" });
    }

    const feedbackRecord = feedbackRecords[0];

    // Get the service to find the business
    const serviceRecords = await db
      .select()
      .from(services)
      .where(eq(services.id, feedbackRecord.serviceId));

    if (serviceRecords.length === 0) {
      return res.status(404).json({ message: "Service not found" });
    }

    const service = serviceRecords[0];

    // Get business profile to verify provider ownership
    const businessRecords = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, service.businessProfileId));

    if (businessRecords.length === 0 || businessRecords[0].providerId !== userId) {
      return res.status(403).json({ message: "Only the provider can reply to reviews" });
    }

    // Update with reply
    const updatedRecords = await db
      .update(feedback)
      .set({
        providerReply: reply.trim(),
        repliedAt: new Date(),
      })
      .where(eq(feedback.id, feedbackId))
      .returning();

    return res.status(200).json({
      message: "Reply added successfully",
      feedback: updatedRecords[0],
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Delete review (for inappropriate content)
const deleteReview = async (req, res) => {
  try {
    const feedbackId = Number(req.params.id);
    const userId = req.token.id;

    if (!feedbackId) {
      return res.status(400).json({ message: "Feedback ID is required" });
    }

    // Get the feedback
    const feedbackRecords = await db
      .select()
      .from(feedback)
      .where(eq(feedback.id, feedbackId));

    if (feedbackRecords.length === 0) {
      return res.status(404).json({ message: "Review not found" });
    }

    const feedbackRecord = feedbackRecords[0];

    // Get the service to find the business
    const serviceRecords = await db
      .select()
      .from(services)
      .where(eq(services.id, feedbackRecord.serviceId));

    if (serviceRecords.length === 0) {
      return res.status(404).json({ message: "Service not found" });
    }

    const service = serviceRecords[0];

    // Get business profile to verify provider ownership
    const businessRecords = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, service.businessProfileId));

    if (businessRecords.length === 0 || businessRecords[0].providerId !== userId) {
      return res.status(403).json({ message: "Only the provider can delete reviews" });
    }

    // Delete the review
    await db.delete(feedback).where(eq(feedback.id, feedbackId));

    return res.status(200).json({ message: "Review deleted successfully" });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get filtered feedback for business
const getFilteredFeedbackByBusiness = async (req, res) => {
  try {
    const businessId = Number(req.params.businessId);
    const { rating, serviceId, isVisible, search } = req.query;

    if (!businessId) {
      return res.status(400).json({ message: "Business ID is required" });
    }

    // Build conditions
    const conditions = [];

    if (rating) {
      const ratingNum = Number(rating);
      conditions.push(
        sql`${feedback.rating} >= ${ratingNum - 0.5} AND ${feedback.rating} < ${ratingNum + 0.5}`
      );
    }

    if (serviceId) {
      conditions.push(eq(feedback.serviceId, Number(serviceId)));
    }

    if (isVisible !== undefined) {
      conditions.push(eq(feedback.isVisible, isVisible === "true"));
    }

    if (search) {
      conditions.push(
        or(
          like(users.name, `%${search}%`),
          like(feedback.comments, `%${search}%`)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get feedback for business's services with filters
    const businessServices = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessProfileId, businessId));

    if (businessServices.length === 0) {
      return res.status(200).json({ feedback: [] });
    }

    const serviceIds = businessServices.map((s) => s.id);

    const businessBookings = await db
      .select({
        id: feedback.id,
        bookingId: feedback.bookingId,
        rating: feedback.rating,
        comments: feedback.comments,
        createdAt: feedback.createdAt,
        customerId: feedback.customerId,
        customerName: users.name,
        customerAvatar: users.avatar,
        serviceId: feedback.serviceId,
        isVisible: feedback.isVisible,
        providerReply: feedback.providerReply,
        repliedAt: feedback.repliedAt,
      })
      .from(feedback)
      .innerJoin(users, eq(feedback.customerId, users.id))
      .where(
        and(
          inArray(feedback.serviceId, serviceIds),
          whereClause || sql`1=1`
        )
      )
      .orderBy(desc(feedback.createdAt));

    // Transform to match frontend expectations
    const transformedFeedback = businessBookings.map((fb) => ({
      id: fb.id,
      bookingId: fb.bookingId,
      rating: Number(fb.rating),
      comments: fb.comments,
      createdAt: fb.createdAt,
      customerId: fb.customerId,
      customer: {
        name: fb.customerName,
        avatar: fb.customerAvatar,
      },
      serviceId: fb.serviceId,
      isVisible: fb.isVisible,
      providerReply: fb.providerReply,
      repliedAt: fb.repliedAt,
    }));

    res.status(200).json({ feedback: transformedFeedback });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getFeedbackByBusiness,
  getFeedbackByService,
  addFeedback,
  toggleReviewVisibility,
  addProviderReply,
  deleteReview,
  getFilteredFeedbackByBusiness,
};
