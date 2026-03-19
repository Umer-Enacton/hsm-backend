const {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  boolean,
  decimal,
  time,
  pgEnum,
  uniqueIndex,
  text,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");

// Define all enums first
const roleEnum = pgEnum("role_type", ["customer", "provider", "admin"]);

const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "payment_pending",
  "confirmed",
  "reschedule_pending", // Customer rescheduled, waiting provider approval
  "completed",
  "cancelled",
  "rejected", // Provider rejected the booking
  "refunded",
]);

const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "initiated",
  "paid",
  "failed",
  "refunded",
]);

const paymentIntentStatusEnum = pgEnum("payment_intent_status", [
  "pending",
  "completed",
  "failed",
  "expired",
  "cancelled",
]);

const addressEnum = pgEnum("address_type", [
  "home",
  "work",
  "billing",
  "shipping",
  "other",
]);
// Tables
const Roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: roleEnum("name").notNull().unique(),
  description: varchar("description", { length: 255 }),
});

const Address = pgTable("address", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  addressType: addressEnum("address_type").default("home"),
  street: varchar("street", { length: 255 }).notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 100 }).notNull(),
  zipCode: varchar("zip_code", { length: 20 }).notNull(),
});

const Category = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  description: varchar("description", { length: 1000 }),
  image: varchar("image", { length: 500 }), // Cloudinary URL for category image
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  roleId: integer("role_id")
    .notNull()
    .references(() => Roles.id, { onDelete: "cascade" })
    .default(1),
  email: varchar("email", { length: 255 }).notNull().unique(),
  phone: varchar("phone", { length: 20 }), // Made nullable for OAuth users
  password: varchar("password", { length: 255 }), // Made nullable for OAuth users
  avatar: varchar("avatar", { length: 500 }), // Cloudinary URL for profile picture
  googleId: varchar("google_id", { length: 255 }).unique(), // Google OAuth ID
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

const businessProfiles = pgTable("business_profiles", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  categoryId: integer("category_id").references(() => Category.id, {
    onDelete: "set null",
  }),
  businessName: varchar("business_name", { length: 255 }).notNull(),
  description: varchar("description", { length: 1000 }),
  phone: varchar("phone", { length: 20 }).notNull(),
  state: varchar("state", { length: 100 }).notNull(), // State/Province
  city: varchar("city", { length: 100 }).notNull(), // City within state
  website: varchar("website", { length: 255 }),
  logo: varchar("logo", { length: 500 }), // Cloudinary URL for business logo
  coverImage: varchar("cover_image", { length: 500 }), // Cloudinary URL for cover/banner image
  isVerified: boolean("is_verified").default(false).notNull(),
  hasPaymentDetails: boolean("has_payment_details").default(false).notNull(), // Provider has added payment details
  isBlocked: boolean("is_blocked").default(false).notNull(), // Business blocked by admin
  blockedReason: text("blocked_reason"), // Reason for blocking
  blockedAt: timestamp("blocked_at"), // When business was blocked
  blockedBy: integer("blocked_by").references(() => users.id), // Admin who blocked
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

const services = pgTable("services", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: varchar("description", { length: 1000 }),
  price: integer("price").notNull(),
  EstimateDuration: integer("EstimateDuration").notNull(),
  image: varchar("image", { length: 500 }), // Cloudinary URL for service image
  isActive: boolean("is_active").default(true).notNull(), // Service can be deactivated by admin
  deactivationReason: text("deactivation_reason"), // Reason for deactivation
  deactivatedAt: timestamp("deactivated_at"), // When service was deactivated
  deactivatedBy: integer("deactivated_by").references(() => users.id), // Admin who deactivated
  rating: decimal("rating", { precision: 3, scale: 2 }).default(0),
  totalReviews: integer("total_reviews").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

const slots = pgTable("slots", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  startTime: time("start_time").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  serviceId: integer("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "cascade" }),
  slotId: integer("slot_id")
    .notNull()
    .references(() => slots.id, { onDelete: "cascade" }),
  addressId: integer("address_id")
    .notNull()
    .references(() => Address.id, { onDelete: "cascade" }),
  bookingDate: timestamp("booking_date").defaultNow().notNull(),
  status: bookingStatusEnum("status").default("pending").notNull(),
  totalPrice: integer("total_price").notNull(),
  paymentStatus: paymentStatusEnum("payment_status").default("pending").notNull(),
  // Reschedule tracking fields
  rescheduleCount: integer("reschedule_count").default(0).notNull(), // Number of times rescheduled
  lastRescheduleFee: integer("last_reschedule_fee"), // Last reschedule fee charged (in paise)
  rescheduleOutcome: varchar("reschedule_outcome", { length: 20 }), // "pending", "accepted", "rejected", "cancelled"
  rescheduleFeeProviderPayout: integer("reschedule_fee_provider_payout"), // Reschedule fee amount going to provider (in paise)
  rescheduleFeePayoutStatus: varchar("reschedule_fee_payout_status", { length: 20 }), // "pending", "paid"
  previousSlotId: integer("previous_slot_id"), // Stores original slot before reschedule (for revert if declined)
  previousSlotTime: varchar("previous_slot_time", { length: 20 }), // Stores original slot time (e.g., "09:00:00") before reschedule
  previousBookingDate: timestamp("previous_booking_date"), // Stores original date before reschedule
  rescheduleReason: varchar("reschedule_reason", { length: 500 }), // Reason for reschedule
  rescheduledBy: varchar("rescheduled_by", { length: 20 }), // "customer" or "provider"
  rescheduledAt: timestamp("rescheduled_at"), // When reschedule was initiated
  // Refund tracking
  isRefunded: boolean("is_refunded").default(false).notNull(), // Whether payment has been refunded
  refundAmount: integer("refund_amount"), // Amount refunded to customer (in paise)
  // Platform fee tracking (5% when customer cancels confirmed booking)
  platformFeeAmount: integer("platform_fee_amount"), // Platform fee retained (in paise)
  // Provider payout tracking (10% when customer cancels confirmed booking)
  providerPayoutAmount: integer("provider_payout_amount"), // Amount paid to provider (in paise)
  providerPayoutStatus: varchar("provider_payout_status", { length: 20 }), // "pending", "paid", "failed"
  providerPayoutId: varchar("provider_payout_id", { length: 100 }), // Razorpay payout ID
  providerPayoutAt: timestamp("provider_payout_at"), // When payout was processed
  // Cancellation tracking
  cancelledAt: timestamp("cancelled_at"), // When booking was cancelled
  cancellationReason: varchar("cancellation_reason", { length: 500 }), // Reason for cancellation
  cancelledBy: varchar("cancelled_by", { length: 20 }), // "customer", "provider", or "system"
  // Reminder tracking
  reminderSent: boolean("reminder_sent").default(false).notNull(), // Accept/Reject reminder sent
  upcomingReminderSent: boolean("upcoming_reminder_sent").default(false).notNull(), // Upcoming service reminder sent
  // Completion verification (OTP-based)
  completionOtp: varchar("completion_otp", { length: 10 }), // OTP for service completion verification
  completionOtpExpiry: timestamp("completion_otp_expiry"), // OTP expiry time (15 minutes)
  completionOtpVerifiedAt: timestamp("completion_otp_verified_at"), // When OTP was verified
  beforePhotoUrl: varchar("before_photo_url", { length: 500 }), // Before service photo URL (optional)
  afterPhotoUrl: varchar("after_photo_url", { length: 500 }), // After service photo URL (optional)
  completionNotes: varchar("completion_notes", { length: 1000 }), // Provider notes about completion
  actualCompletionTime: timestamp("actual_completion_time"), // Actual time service was completed
});

const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Razorpay Details
  razorpayOrderId: varchar("razorpay_order_id", { length: 100 }),
  razorpayPaymentId: varchar("razorpay_payment_id", { length: 100 }).unique(),
  razorpaySignature: varchar("razorpay_signature", { length: 255 }),
  // Payment Details
  amount: integer("amount").notNull(), // Amount in paise (₹500 = 50000 paise)
  currency: varchar("currency", { length: 10 }).default("INR").notNull(),
  status: paymentStatusEnum("status").default("pending").notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }), // razorpay, upi, card, etc.
  // Split Payment Tracking
  platformFee: integer("platform_fee").default(0), // Platform commission in paise
  providerShare: integer("provider_share").default(0), // Provider amount in paise
  paymentSplitType: varchar("payment_split_type", { length: 20 }), // 'split', 'manual'
  splitStatus: varchar("split_status", { length: 20 }), // 'pending', 'completed', 'failed'
  // Provider Payout Tracking
  providerPayoutStatus: varchar("provider_payout_status", { length: 20 }), // "pending", "paid", "failed"
  providerPayoutId: varchar("provider_payout_id", { length: 100 }), // Razorpay payout ID
  providerPayoutAt: timestamp("provider_payout_at"), // When payout was processed
  // Reschedule Fee Payout Tracking (when customer cancels reschedule, provider keeps 50%)
  rescheduleFeePayoutStatus: varchar("reschedule_fee_payout_status", { length: 20 }), // "pending", "paid"
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  failedAt: timestamp("failed_at"),
  refundedAt: timestamp("refunded_at"),
  // Failure/Refund Details
  failureReason: varchar("failure_reason", { length: 500 }),
  refundId: varchar("refund_id", { length: 100 }),
  refundAmount: integer("refund_amount"),
  refundReason: varchar("refund_reason", { length: 500 }),
});

// Payment Intents - Temporarily locks slots during payment flow
const paymentIntents = pgTable("payment_intents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  serviceId: integer("service_id").notNull(),
  slotId: integer("slot_id").notNull(),
  addressId: integer("address_id").notNull(),
  bookingDate: timestamp("booking_date").notNull(),
  amount: integer("amount").notNull(), // Amount in paise
  razorpayOrderId: varchar("razorpay_order_id", { length: 100 }),
  status: paymentIntentStatusEnum("status").default("pending").notNull(),
  expiresAt: timestamp("expires_at").notNull(), // Lock expires after 1 minute
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  failureReason: varchar("failure_reason", { length: 500 }),
  // Reschedule fields
  isReschedule: boolean("is_reschedule").default(false),
  rescheduleBookingId: integer("reschedule_booking_id"), // References bookings.id for reschedule
}, (table) => ({
  // Partial unique index: Only one pending intent per slot per date per service
  // This allows different services to be booked simultaneously at the same time slot
  slotDateServicePendingUnique: uniqueIndex("payment_intents_slot_date_service_pending_unique")
    .on(table.slotId, table.bookingDate, table.serviceId)
    .where(sql`${table.status} = 'pending'`),
}));
// Payment Details - Stores UPI/Bank details for admin and providers
const paymentDetails = pgTable("payment_details", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  paymentType: varchar("payment_type", { length: 10 }).notNull(), // 'upi' or 'bank'
  upiId: varchar("upi_id", { length: 100 }), // For UPI payments
  bankAccount: varchar("bank_account", { length: 30 }), // For bank payments (masked)
  ifscCode: varchar("ifsc_code", { length: 15 }), // For bank payments
  accountHolderName: varchar("account_holder_name", { length: 255 }), // For bank payments
  razorpayContactId: varchar("razorpay_contact_id", { length: 100 }), // Razorpay contact ID
  razorpayFundAccountId: varchar("razorpay_fund_account_id", { length: 100 }), // Razorpay fund account ID
  isActive: boolean("is_active").default(true).notNull(), // Can have multiple, one active
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Admin Settings - Platform configuration
const adminSettings = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 50 }).notNull().unique(),
  value: text("value").notNull(),
  description: varchar("description", { length: 255 }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id")
    .references(() => bookings.id, { onDelete: "cascade" })
    .notNull(),
  serviceId: integer("service_id")
    .references(() => services.id, { onDelete: "cascade" })
    .notNull(),
  customerId: integer("customer_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  rating: decimal("rating", { precision: 2, scale: 1 }).notNull(),
  comments: varchar("comments", { length: 2000 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Visibility control - provider can hide reviews from customers
  isVisible: boolean("is_visible").default(true).notNull(),
  // Provider reply to review
  providerReply: varchar("provider_reply", { length: 1000 }),
  repliedAt: timestamp("replied_at"),
  // Track who hid the review (provider who hid it)
  hiddenBy: integer("hidden_by").references(() => users.id, { onDelete: "set null" }),
  hiddenAt: timestamp("hidden_at"),
});

// Notifications - Store user notifications for in-app display and push
const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull(), // 'booking_created', 'booking_confirmed', 'booking_cancelled', etc.
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  data: text("data"), // JSON string for additional data: { bookingId, actionUrl, etc. }
  isRead: boolean("is_read").default(false).notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Device Tokens - Store FCM tokens for push notifications
const deviceTokens = pgTable("device_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 500 }).notNull().unique(),
  deviceInfo: text("device_info"), // JSON string: { userAgent, platform, model }
  isActive: boolean("is_active").default(true).notNull(),
  lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
module.exports = {
  Roles,
  Address,
  Category,
  users,
  businessProfiles,
  services,
  slots,
  bookings,
  payments,
  paymentIntents,
  feedback,
  paymentDetails,
  adminSettings,
  notifications,
  deviceTokens,
  roleEnum,
  bookingStatusEnum,
  paymentStatusEnum,
  paymentIntentStatusEnum,
  addressEnum,
};
