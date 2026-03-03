import { pgTable, foreignKey, unique, serial, varchar, integer, timestamp, boolean, numeric, time, uniqueIndex, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const addressType = pgEnum("address_type", ['home', 'work', 'billing', 'shipping', 'other'])
export const bookingStatus = pgEnum("booking_status", ['pending', 'payment_pending', 'confirmed', 'completed', 'cancelled', 'refunded'])
export const paymentIntentStatus = pgEnum("payment_intent_status", ['pending', 'completed', 'failed', 'expired'])
export const paymentStatus = pgEnum("payment_status", ['pending', 'initiated', 'paid', 'failed', 'refunded'])
export const roleType = pgEnum("role_type", ['customer', 'provider', 'admin'])


export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	roleId: integer("role_id").default(1).notNull(),
	email: varchar({ length: 255 }).notNull(),
	phone: varchar({ length: 20 }).notNull(),
	password: varchar({ length: 255 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	avatar: varchar({ length: 500 }),
}, (table) => [
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "users_role_id_roles_id_fk"
		}).onDelete("cascade"),
	unique("users_email_unique").on(table.email),
]);

export const roles = pgTable("roles", {
	id: serial().primaryKey().notNull(),
	name: roleType().notNull(),
	description: varchar({ length: 255 }),
}, (table) => [
	unique("roles_name_unique").on(table.name),
]);

export const address = pgTable("address", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	addressType: addressType("address_type").default('home'),
	street: varchar({ length: 255 }).notNull(),
	city: varchar({ length: 100 }).notNull(),
	state: varchar({ length: 100 }).notNull(),
	zipCode: varchar("zip_code", { length: 20 }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "address_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const categories = pgTable("categories", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: varchar({ length: 1000 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	image: varchar({ length: 500 }),
}, (table) => [
	unique("categories_name_unique").on(table.name),
]);

export const businessProfiles = pgTable("business_profiles", {
	id: serial().primaryKey().notNull(),
	providerId: integer("provider_id").notNull(),
	categoryId: integer("category_id"),
	businessName: varchar("business_name", { length: 255 }).notNull(),
	description: varchar({ length: 1000 }),
	phone: varchar({ length: 20 }).notNull(),
	website: varchar({ length: 255 }),
	isVerified: boolean("is_verified").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	logo: varchar({ length: 500 }),
	coverImage: varchar("cover_image", { length: 500 }),
	state: varchar({ length: 100 }).notNull(),
	city: varchar({ length: 100 }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.providerId],
			foreignColumns: [users.id],
			name: "business_profiles_provider_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.id],
			name: "business_profiles_category_id_categories_id_fk"
		}).onDelete("set null"),
]);

export const payments = pgTable("payments", {
	id: serial().primaryKey().notNull(),
	bookingId: integer("booking_id").notNull(),
	userId: integer("user_id").notNull(),
	razorpayOrderId: varchar("razorpay_order_id", { length: 100 }),
	razorpayPaymentId: varchar("razorpay_payment_id", { length: 100 }),
	razorpaySignature: varchar("razorpay_signature", { length: 255 }),
	amount: integer().notNull(),
	currency: varchar({ length: 10 }).default('INR').notNull(),
	status: paymentStatus().default('pending').notNull(),
	paymentMethod: varchar("payment_method", { length: 50 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	failedAt: timestamp("failed_at", { mode: 'string' }),
	refundedAt: timestamp("refunded_at", { mode: 'string' }),
	failureReason: varchar("failure_reason", { length: 500 }),
	refundId: varchar("refund_id", { length: 100 }),
	refundAmount: integer("refund_amount"),
	refundReason: varchar("refund_reason", { length: 500 }),
}, (table) => [
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [bookings.id],
			name: "payments_booking_id_bookings_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "payments_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("payments_razorpay_payment_id_unique").on(table.razorpayPaymentId),
]);

export const services = pgTable("services", {
	id: serial().primaryKey().notNull(),
	businessProfileId: integer("business_profile_id").notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: varchar({ length: 1000 }),
	price: integer().notNull(),
	estimateDuration: integer("EstimateDuration").notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	image: varchar({ length: 500 }),
	rating: numeric({ precision: 3, scale:  2 }).default('0'),
	totalReviews: integer("total_reviews").default(0),
}, (table) => [
	foreignKey({
			columns: [table.businessProfileId],
			foreignColumns: [businessProfiles.id],
			name: "services_business_profile_id_business_profiles_id_fk"
		}).onDelete("cascade"),
]);

export const slots = pgTable("slots", {
	id: serial().primaryKey().notNull(),
	businessProfileId: integer("business_profile_id").notNull(),
	startTime: time("start_time").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.businessProfileId],
			foreignColumns: [businessProfiles.id],
			name: "slots_business_profile_id_business_profiles_id_fk"
		}).onDelete("cascade"),
]);

export const feedback = pgTable("feedback", {
	id: serial().primaryKey().notNull(),
	bookingId: integer("booking_id").notNull(),
	rating: numeric({ precision: 2, scale:  1 }).notNull(),
	comments: varchar({ length: 2000 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	serviceId: integer("service_id").notNull(),
	customerId: integer("customer_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [bookings.id],
			name: "feedback_booking_id_bookings_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.serviceId],
			foreignColumns: [services.id],
			name: "feedback_service_id_services_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [users.id],
			name: "feedback_customer_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const bookings = pgTable("bookings", {
	id: serial().primaryKey().notNull(),
	customerId: integer("customer_id").notNull(),
	businessProfileId: integer("business_profile_id").notNull(),
	serviceId: integer("service_id").notNull(),
	slotId: integer("slot_id").notNull(),
	addressId: integer("address_id").notNull(),
	bookingDate: timestamp("booking_date", { mode: 'string' }).defaultNow().notNull(),
	status: bookingStatus().default('pending').notNull(),
	totalPrice: integer("total_price").notNull(),
	paymentStatus: paymentStatus("payment_status").default('pending').notNull(),
}, (table) => [
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [users.id],
			name: "bookings_customer_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.businessProfileId],
			foreignColumns: [businessProfiles.id],
			name: "bookings_business_profile_id_business_profiles_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.serviceId],
			foreignColumns: [services.id],
			name: "bookings_service_id_services_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.slotId],
			foreignColumns: [slots.id],
			name: "bookings_slot_id_slots_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.addressId],
			foreignColumns: [address.id],
			name: "bookings_address_id_address_id_fk"
		}).onDelete("cascade"),
]);

export const paymentIntents = pgTable("payment_intents", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	serviceId: integer("service_id").notNull(),
	slotId: integer("slot_id").notNull(),
	addressId: integer("address_id").notNull(),
	bookingDate: timestamp("booking_date", { mode: 'string' }).notNull(),
	amount: integer().notNull(),
	razorpayOrderId: varchar("razorpay_order_id", { length: 100 }),
	status: paymentIntentStatus().default('pending').notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	failureReason: varchar("failure_reason", { length: 500 }),
}, (table) => [
	uniqueIndex("payment_intents_slot_date_pending_unique").using("btree", table.slotId.asc().nullsLast().op("int4_ops"), table.bookingDate.asc().nullsLast().op("int4_ops")).where(sql`(status = 'pending'::payment_intent_status)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "payment_intents_user_id_users_id_fk"
		}).onDelete("cascade"),
]);
