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
  index,
  text,
  date,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");

// Define all enums first
const roleEnum = pgEnum("role_type", ["customer", "provider", "admin", "staff"]);

const bookingStatusEnum = pgEnum("booking_status", [
  "confirmed",
  "completed",
  "cancelled",
  "missed", // Booking time passed but not completed
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

const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "trial",
  "trial_ended",
  "cancelled",
  "expired",
  "completed",
  "pending_payment",
]);

const billingCycleEnum = pgEnum("billing_cycle", ["monthly", "yearly"]);

// Staff/Worker Management Enums
const staffStatusEnum = pgEnum("staff_status", [
  "active",
  "inactive",
  "on_leave",
  "terminated",
]);

const salaryTypeEnum = pgEnum("salary_type", [
  "commission",
  "hourly",
  "fixed",
]);

const leaveTypeEnum = pgEnum("leave_type", [
  "full_day",
  "half_day",
  "hours",
]);

const leaveStatusEnum = pgEnum("leave_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

const payoutStatusEnum = pgEnum("payout_status", [
  "pending",
  "processing",
  "paid",
  "failed",
]);

// Cron Job Management Enums
const cronJobStatusEnum = pgEnum("cron_job_status", [
  "running",
  "success",
  "failed",
  "partial_success",
]);

const cronJobCategoryEnum = pgEnum("cron_job_category", [
  "booking",
  "subscription",
  "staff",
  "payment",
  "maintenance",
]);

const cronJobTriggeredByEnum = pgEnum("cron_job_triggered_by", [
  "schedule",
  "manual",
  "webhook",
]);

const cronJobSyncStatusEnum = pgEnum("cron_job_sync_status", [
  "not_synced",
  "synced",
  "sync_failed",
  "sync_pending",
]);

const calculationTypeEnum = pgEnum("calculation_type", [
  "commission",
  "hourly",
  "fixed",
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
  //razorpayCustomerId: varchar("razorpay_customer_id", { length: 100 }), // Razorpay Customer ID for tracking
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

const businessProfiles = pgTable(
  "business_profiles",
  {
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
  },
  (table) => ({
    providerIdIdx: index("business_profiles_provider_id_idx").on(
      table.providerId,
    ),
    isVerifiedIdx: index("business_profiles_is_verified_idx").on(
      table.isVerified,
    ),
    cityIdx: index("business_profiles_city_idx").on(table.city),
  }),
);

const services = pgTable(
  "services",
  {
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
    maxAllowBooking: integer("max_allow_booking").default(1).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    businessProfileIdIdx: index("services_business_profile_id_idx").on(
      table.businessProfileId,
    ),
    isActiveIdx: index("services_is_active_idx").on(table.isActive),
  }),
);

const slots = pgTable("slots", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  startTime: time("start_time").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

const bookings = pgTable(
  "bookings",
  {
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
    status: bookingStatusEnum("status").default("confirmed").notNull(),
    totalPrice: integer("total_price").notNull(),
    // Provider earning tracking
    providerEarning: integer("provider_earning"), // Amount provider earns after platform fee (in paise)
    platformFee: integer("platform_fee"), // Platform commission amount (in paise)
    paymentStatus: paymentStatusEnum("payment_status")
      .default("pending")
      .notNull(),
    // Reschedule tracking fields
    rescheduleCount: integer("reschedule_count").default(0).notNull(), // Number of times rescheduled
    lastRescheduleFee: integer("last_reschedule_fee"), // Last reschedule fee charged (in paise)
    rescheduleOutcome: varchar("reschedule_outcome", { length: 20 }), // "pending", "accepted", "rejected", "cancelled"
    rescheduleFeeProviderPayout: integer("reschedule_fee_provider_payout"), // Reschedule fee amount going to provider (in paise)
    rescheduleFeePayoutStatus: varchar("reschedule_fee_payout_status", {
      length: 20,
    }), // "pending", "paid"
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
    upcomingReminderSent: boolean("upcoming_reminder_sent")
      .default(false)
      .notNull(), // Upcoming service reminder sent
    dayOfReminderSent: boolean("day_of_reminder_sent").default(false).notNull(), // Day-of service reminder sent
    // Completion verification (OTP-based)
    completionOtp: varchar("completion_otp", { length: 10 }), // OTP for service completion verification
    completionOtpExpiry: timestamp("completion_otp_expiry"), // OTP expiry time (15 minutes)
    completionOtpVerifiedAt: timestamp("completion_otp_verified_at"), // When OTP was verified
    beforePhotoUrl: varchar("before_photo_url", { length: 500 }), // Before service photo URL (optional)
    afterPhotoUrl: varchar("after_photo_url", { length: 500 }), // After service photo URL (optional)
    completionNotes: varchar("completion_notes", { length: 1000 }), // Provider notes about completion
    actualCompletionTime: timestamp("actual_completion_time"), // Actual time service was completed
    // Staff assignment fields
    assignedStaffId: integer("assigned_staff_id").references(() => staff.id, {
      onDelete: "set null",
    }),
    staffAssignedAt: timestamp("staff_assigned_at"), // When staff was assigned
    staffCompletedAt: timestamp("staff_completed_at"), // When staff completed the booking
    staffEarning: integer("staff_earning"), // Amount paid to staff for this booking (paise)
    // Per-booking staff earning configuration
    staffEarningType: varchar("staff_earning_type", { length: 20 }), // 'commission' or 'fixed' - NULL if no staff assigned
    staffCommissionPercent: integer("staff_commission_percent"), // Commission % if earningType is 'commission'
    staffFixedAmount: integer("staff_fixed_amount"), // Fixed amount in paise if earningType is 'fixed'
    lastPendingReminderAt: timestamp("last_pending_reminder_at"), // Used for repeated 'take action' reminders
    missedAt: timestamp("missed_at"), // When booking was marked as missed (time passed without completion)
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    customerIdIdx: index("bookings_customer_id_idx").on(table.customerId),
    businessProfileIdIdx: index("bookings_business_profile_id_idx").on(
      table.businessProfileId,
    ),
    serviceIdIdx: index("bookings_service_id_idx").on(table.serviceId),
    statusIdx: index("bookings_status_idx").on(table.status),
    bookingDateIdx: index("bookings_booking_date_idx").on(table.bookingDate),
    // Composite index for provider bookings query (businessProfileId + bookingDate)
    businessProfileIdDateIdx: index("bookings_business_profile_id_date_idx").on(
      table.businessProfileId,
      table.bookingDate,
    ),
  }),
);

const bookingHistory = pgTable("booking_history", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 100 }).notNull(),
  message: varchar("message", { length: 1000 }).notNull(),
  actor: varchar("actor", { length: 50 }), // 'customer', 'provider', 'system'
  actorId: integer("actor_id").references(() => users.id, {
    onDelete: "set null",
  }),
  historyData: text("history_data"), // JSON string for extra info
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  rescheduleFeePayoutStatus: varchar("reschedule_fee_payout_status", {
    length: 20,
  }), // "pending", "paid"
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
});
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

const feedback = pgTable(
  "feedback",
  {
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
    hiddenBy: integer("hidden_by").references(() => users.id, {
      onDelete: "set null",
    }),
    hiddenAt: timestamp("hidden_at"),
  },
  (table) => ({
    bookingIdIdx: index("feedback_booking_id_idx").on(table.bookingId),
    serviceIdIdx: index("feedback_service_id_idx").on(table.serviceId),
    isVisibleIdx: index("feedback_is_visible_idx").on(table.isVisible),
  }),
);

// Notifications - Store user notifications for in-app display and push
const notifications = pgTable(
  "notifications",
  {
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
  },
  (table) => ({
    userIdIdx: index("notifications_user_id_idx").on(table.userId),
    isReadIdx: index("notifications_is_read_idx").on(table.isRead),
    createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
    // Composite index for user's unread notifications
    userIdIsReadIdx: index("notifications_user_id_is_read_idx").on(
      table.userId,
      table.isRead,
    ),
  }),
);

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

// Subscription Plans - Plan configurations for providers
const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull().unique(),
    description: text("description"),
    monthlyPrice: integer("monthly_price").default(0).notNull(), // Price in paise (₹500 = 50000)
    yearlyPrice: integer("yearly_price").default(0).notNull(), // Price in paise
    trialDays: integer("trial_days").default(0).notNull(), // Trial period (0 for Free, 7 for paid)
    platformFeePercentage: integer("platform_fee_percentage")
      .default(5)
      .notNull(), // Admin's commission %
    maxServices: integer("max_services").default(4).notNull(), // Max services provider can list (-1 for unlimited)
    maxBookingsPerMonth: integer("max_bookings_per_month"), // Max bookings per month (null = unlimited)
    maxImagesPerService: integer("max_images_per_service").default(5).notNull(), // Images per service
    prioritySupport: boolean("priority_support").default(false).notNull(), // Priority customer support
    analyticsAccess: boolean("analytics_access").default(true).notNull(), // Analytics dashboard access
    // Razorpay Integration
    razorpayMonthlyPlanId: varchar("razorpay_monthly_plan_id", { length: 100 }), // Razorpay plan ID for monthly billing
    razorpayYearlyPlanId: varchar("razorpay_yearly_plan_id", { length: 100 }), // Razorpay plan ID for yearly billing
    // Access Control (features JSONB stores: { allowedRoutes: [...], allowedGraphs: [...] })
    benefits: text("benefits").array(), // Displayed benefits ["Priority Support", "Basic Analytics"]
    features: text("features"), // JSON string for access control
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    isActiveIdx: index("subscription_plans_is_active_idx").on(table.isActive),
  }),
);

// Provider Subscriptions - Active subscriptions for providers
const providerSubscriptions = pgTable(
  "provider_subscriptions",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: integer("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: "restrict" }),
    razorpaySubscriptionId: varchar("razorpay_subscription_id", {
      length: 100,
    }), // Razorpay sub ID
    razorpayPlanId: varchar("razorpay_plan_id", { length: 100 }), // Razorpay plan ID used
    razorpayCustomerId: varchar("razorpay_customer_id", { length: 100 }), // Razorpay customer ID (linked after payment)
    status: subscriptionStatusEnum("status").default("active").notNull(),
    startDate: timestamp("start_date").defaultNow().notNull(),
    endDate: timestamp("end_date"), // When subscription expires
    trialEndDate: timestamp("trial_end_date"), // When trial period ends
    billingCycle: billingCycleEnum("billing_cycle")
      .default("monthly")
      .notNull(),
    autoRenew: boolean("auto_renew").default(false).notNull(), // Provider's choice
    amountPaid: integer("amount_paid"), // Total amount paid (paise)
    platformFeeAtPurchase: integer("platform_fee_at_purchase"), // Fee % when purchased (for history)
    originalAmount: integer("original_amount"), // Yearly amount for proration calculation
    cancelledAt: timestamp("cancelled_at"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(), // Will cancel at period end
    isTrial: boolean("is_trial").default(false).notNull(), // Track if this was a trial subscription
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    providerIdIdx: index("provider_subscriptions_provider_id_idx").on(
      table.providerId,
    ),
    planIdIdx: index("provider_subscriptions_plan_id_idx").on(table.planId),
    statusIdx: index("provider_subscriptions_status_idx").on(table.status),
    trialEndDateIdx: index("provider_subscriptions_trial_end_date_idx").on(
      table.trialEndDate,
    ),
  }),
);

// Subscription Payments - Payment history for subscriptions
const subscriptionPayments = pgTable(
  "subscription_payments",
  {
    id: serial("id").primaryKey(),
    providerSubscriptionId: integer("provider_subscription_id")
      .notNull()
      .references(() => providerSubscriptions.id, { onDelete: "cascade" }),
    razorpayPaymentId: varchar("razorpay_payment_id", { length: 100 }),
    amount: integer("amount").notNull(), // Amount paid (paise)
    currency: varchar("currency", { length: 10 }).default("INR").notNull(),
    status: varchar("status", { length: 20 }).default("captured").notNull(), // captured, failed, refunded
    paymentDate: timestamp("payment_date").defaultNow().notNull(),
    invoiceUrl: varchar("invoice_url", { length: 500 }), // Razorpay invoice URL
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    providerSubscriptionIdIdx: index(
      "subscription_payments_provider_subscription_id_idx",
    ).on(table.providerSubscriptionId),
    statusIdx: index("subscription_payments_status_idx").on(table.status),
  }),
);

// Staff/Worker Management Tables

// Staff - Employees working for providers
const staff = pgTable(
  "staff",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    businessProfileId: integer("business_profile_id")
      .notNull()
      .references(() => businessProfiles.id, { onDelete: "cascade" }),
    employeeId: varchar("employee_id", { length: 20 }), // EMP001, EMP002, etc.
    status: staffStatusEnum("status").default("active").notNull(),
    joinDate: date("join_date").defaultNow(),
    documents: text("documents"), // JSON: { aadhar: "", pan: "", etc }
    isVerified: boolean("is_verified").default(false).notNull(),
    verifiedBy: integer("verified_by").references(() => users.id),
    bankAccount: text("bank_account"), // JSON: { accountNo, ifsc, bankName }
    upiId: varchar("upi_id", { length: 100 }),
    // Earnings tracking
    totalEarnings: integer("total_earnings").default(0).notNull(),
    pendingPayout: integer("pending_payout").default(0).notNull(),
    totalPaid: integer("total_paid").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("staff_user_id_idx").on(table.userId),
    businessProfileIdIdx: index("staff_business_profile_id_idx").on(
      table.businessProfileId,
    ),
    statusIdx: index("staff_status_idx").on(table.status),
    employeeIdIdx: index("staff_employee_id_idx").on(table.employeeId),
  }),
);

// Staff Leave - Leave requests from staff
const staffLeave = pgTable(
  "staff_leave",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    businessProfileId: integer("business_profile_id")
      .notNull()
      .references(() => businessProfiles.id, { onDelete: "cascade" }),
    leaveType: leaveTypeEnum("leave_type").default("full_day").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    startTime: time("start_time"), // For hourly leave
    endTime: time("end_time"),
    reason: text("reason"),
    status: leaveStatusEnum("status").default("pending").notNull(),
    approvedBy: integer("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    staffIdIdx: index("staff_leave_staff_id_idx").on(table.staffId),
    businessProfileIdIdx: index("staff_leave_business_profile_id_idx").on(
      table.businessProfileId,
    ),
    statusIdx: index("staff_leave_status_idx").on(table.status),
    startDateIdx: index("staff_leave_start_date_idx").on(table.startDate),
  }),
);

// Staff Assignment Tracking - Round-robin tracking for auto-assign
const staffAssignmentTracking = pgTable("staff_assignment_tracking", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  lastAssignedStaffId: integer("last_assigned_staff_id").references(() => staff.id, {
    onDelete: "set null",
  }),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
});

// Staff Payouts - Earnings and payouts for staff
const staffPayouts = pgTable(
  "staff_payouts",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    businessProfileId: integer("business_profile_id")
      .notNull()
      .references(() => businessProfiles.id, { onDelete: "cascade" }),
    bookingId: integer("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    amount: integer("amount").notNull(), // Amount earned for this booking (paise)
    commissionPercentage: integer("commission_percentage"),
    payoutStatus: payoutStatusEnum("payout_status").default("pending").notNull(),
    payoutId: varchar("payout_id", { length: 100 }), // Razorpay payout ID
    payoutDate: timestamp("payout_date"),
    calculationType: calculationTypeEnum("calculation_type")
      .default("commission")
      .notNull(),
    hoursWorked: decimal("hours_worked", { precision: 5, scale: 2 }), // For hourly rate
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    staffIdIdx: index("staff_payouts_staff_id_idx").on(table.staffId),
    businessProfileIdIdx: index("staff_payouts_business_profile_id_idx").on(
      table.businessProfileId,
    ),
    bookingIdIdx: index("staff_payouts_booking_id_idx").on(table.bookingId),
    payoutStatusIdx: index("staff_payouts_payout_status_idx").on(
      table.payoutStatus,
    ),
  }),
);

// Cron Job Management Tables

// Cron Jobs - Scheduled job definitions
const cronJobs = pgTable(
  "cron_jobs",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull().unique(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    description: text("description"),
    endpoint: varchar("endpoint", { length: 255 }).notNull(),
    method: varchar("method", { length: 10 }).default("POST").notNull(),
    cronExpression: varchar("cron_expression", { length: 100 }), // e.g., "*/30 * * * *"
    intervalMinutes: integer("interval_minutes"), // Alternative: 30, 60, 1440 (daily)
    isEnabled: boolean("is_enabled").default(true).notNull(),
    maxRetries: integer("max_retries").default(3).notNull(),
    retryIntervalSeconds: integer("retry_interval_seconds").default(60).notNull(),
    category: cronJobCategoryEnum("category").notNull(),
    lastRunAt: timestamp("last_run_at"),
    lastRunStatus: cronJobStatusEnum("last_run_status"),
    nextRunAt: timestamp("next_run_at"),
    // pg_cron sync tracking
    syncStatus: cronJobSyncStatusEnum("sync_status").default("not_synced").notNull(),
    syncError: text("sync_error"),
    lastSyncedAt: timestamp("last_synced_at"),
    pgCronJobname: varchar("pg_cron_jobname", { length: 100 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    nameIdx: index("cron_jobs_name_idx").on(table.name),
    isEnabledIdx: index("cron_jobs_is_enabled_idx").on(table.isEnabled),
    categoryIdx: index("cron_jobs_category_idx").on(table.category),
    syncStatusIdx: index("cron_jobs_sync_status_idx").on(table.syncStatus),
  }),
);

// Cron Job Logs - Execution history for cron jobs
const cronJobLogs = pgTable(
  "cron_job_logs",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => cronJobs.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    status: cronJobStatusEnum("status").notNull(),
    result: text("result"), // JSON string: { processed: 10, succeeded: 10, failed: 0, notificationsSent: 5 }
    errorMessage: text("error_message"),
    errorDetails: text("error_details"), // JSON string for detailed error info
    triggeredBy: cronJobTriggeredByEnum("triggered_by").default("schedule").notNull(),
    triggeredByUserId: integer("triggered_by_user_id").references(() => users.id),
    durationMs: integer("duration_ms"), // Execution duration in milliseconds
    retryCount: integer("retry_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    jobIdIdx: index("cron_job_logs_job_id_idx").on(table.jobId),
    startedAtIdx: index("cron_job_logs_started_at_idx").on(table.startedAt),
    statusIdx: index("cron_job_logs_status_idx").on(table.status),
    triggeredByIdx: index("cron_job_logs_triggered_by_idx").on(table.triggeredBy),
  }),
);

// Privacy Policy Management
const privacyPolicies = pgTable("privacy_policies", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 20 }).notNull(), // e.g., "1.0", "1.1"
  content: text("content").notNull(), // HTML content from rich text editor
  effectiveDate: timestamp("effective_date").defaultNow().notNull(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  isActive: boolean("is_active").default(true).notNull(), // Only one version active at a time
});

const privacyPolicyNotifications = pgTable("privacy_policy_notifications", {
  id: serial("id").primaryKey(),
  policyId: integer("policy_id")
    .notNull()
    .references(() => privacyPolicies.id, { onDelete: "cascade" }),
  version: varchar("version", { length: 20 }).notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  recipientCount: integer("recipient_count").notNull(), // Count of users notified
});

// Terms & Conditions Management
const termsConditions = pgTable("terms_conditions", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 20 }).notNull(), // e.g., "1.0", "1.1"
  content: text("content").notNull(), // HTML content from rich text editor
  effectiveDate: timestamp("effective_date").defaultNow().notNull(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  isActive: boolean("is_active").default(true).notNull(), // Only one version active at a time
});

const termsConditionNotifications = pgTable("terms_condition_notifications", {
  id: serial("id").primaryKey(),
  termsId: integer("terms_id")
    .notNull()
    .references(() => termsConditions.id, { onDelete: "cascade" }),
  version: varchar("version", { length: 20 }).notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  recipientCount: integer("recipient_count").notNull(), // Count of users notified
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
  bookingHistory,
  payments,
  paymentIntents,
  feedback,
  paymentDetails,
  adminSettings,
  notifications,
  deviceTokens,
  subscriptionPlans,
  providerSubscriptions,
  subscriptionPayments,
  // Staff/Worker Management
  staff,
  staffLeave,
  staffAssignmentTracking,
  staffPayouts,
  // Cron Job Management
  cronJobs,
  cronJobLogs,
  // Privacy Policy Management
  privacyPolicies,
  privacyPolicyNotifications,
  // Terms & Conditions Management
  termsConditions,
  termsConditionNotifications,
  // Enums
  roleEnum,
  bookingStatusEnum,
  paymentStatusEnum,
  paymentIntentStatusEnum,
  addressEnum,
  subscriptionStatusEnum,
  billingCycleEnum,
  staffStatusEnum,
  salaryTypeEnum,
  leaveTypeEnum,
  leaveStatusEnum,
  payoutStatusEnum,
  calculationTypeEnum,
  // Cron Job Enums
  cronJobStatusEnum,
  cronJobCategoryEnum,
  cronJobTriggeredByEnum,
  cronJobSyncStatusEnum,
};
