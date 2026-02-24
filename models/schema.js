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
} = require("drizzle-orm/pg-core");

// Define all enums first
const roleEnum = pgEnum("role_type", ["customer", "provider", "admin"]);

const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "completed",
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
  phone: varchar("phone", { length: 20 }).notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  avatar: varchar("avatar", { length: 500 }), // Cloudinary URL for profile picture
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
  rating: decimal("rating", { precision: 3, scale: 2 }),
  isVerified: boolean("is_verified").default(false).notNull(),
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
  isActive: boolean("is_active").default(true).notNull(),
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
});
const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id")
    .references(() => bookings.id, { onDelete: "cascade" })
    .notNull(),
  rating: decimal("rating", { precision: 2, scale: 1 }).notNull(),
  comments: varchar("comments", { length: 2000 }),
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
  feedback,
  roleEnum,
  bookingStatusEnum,
  addressEnum,
};
