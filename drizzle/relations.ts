import { relations } from "drizzle-orm/relations";
import { roles, users, address, businessProfiles, categories, bookings, payments, services, slots, feedback, paymentIntents } from "./schema";

export const usersRelations = relations(users, ({one, many}) => ({
	role: one(roles, {
		fields: [users.roleId],
		references: [roles.id]
	}),
	addresses: many(address),
	businessProfiles: many(businessProfiles),
	payments: many(payments),
	feedbacks: many(feedback),
	bookings: many(bookings),
	paymentIntents: many(paymentIntents),
}));

export const rolesRelations = relations(roles, ({many}) => ({
	users: many(users),
}));

export const addressRelations = relations(address, ({one, many}) => ({
	user: one(users, {
		fields: [address.userId],
		references: [users.id]
	}),
	bookings: many(bookings),
}));

export const businessProfilesRelations = relations(businessProfiles, ({one, many}) => ({
	user: one(users, {
		fields: [businessProfiles.providerId],
		references: [users.id]
	}),
	category: one(categories, {
		fields: [businessProfiles.categoryId],
		references: [categories.id]
	}),
	services: many(services),
	slots: many(slots),
	bookings: many(bookings),
}));

export const categoriesRelations = relations(categories, ({many}) => ({
	businessProfiles: many(businessProfiles),
}));

export const paymentsRelations = relations(payments, ({one}) => ({
	booking: one(bookings, {
		fields: [payments.bookingId],
		references: [bookings.id]
	}),
	user: one(users, {
		fields: [payments.userId],
		references: [users.id]
	}),
}));

export const bookingsRelations = relations(bookings, ({one, many}) => ({
	payments: many(payments),
	feedbacks: many(feedback),
	user: one(users, {
		fields: [bookings.customerId],
		references: [users.id]
	}),
	businessProfile: one(businessProfiles, {
		fields: [bookings.businessProfileId],
		references: [businessProfiles.id]
	}),
	service: one(services, {
		fields: [bookings.serviceId],
		references: [services.id]
	}),
	slot: one(slots, {
		fields: [bookings.slotId],
		references: [slots.id]
	}),
	address: one(address, {
		fields: [bookings.addressId],
		references: [address.id]
	}),
}));

export const servicesRelations = relations(services, ({one, many}) => ({
	businessProfile: one(businessProfiles, {
		fields: [services.businessProfileId],
		references: [businessProfiles.id]
	}),
	feedbacks: many(feedback),
	bookings: many(bookings),
}));

export const slotsRelations = relations(slots, ({one, many}) => ({
	businessProfile: one(businessProfiles, {
		fields: [slots.businessProfileId],
		references: [businessProfiles.id]
	}),
	bookings: many(bookings),
}));

export const feedbackRelations = relations(feedback, ({one}) => ({
	booking: one(bookings, {
		fields: [feedback.bookingId],
		references: [bookings.id]
	}),
	service: one(services, {
		fields: [feedback.serviceId],
		references: [services.id]
	}),
	user: one(users, {
		fields: [feedback.customerId],
		references: [users.id]
	}),
}));

export const paymentIntentsRelations = relations(paymentIntents, ({one}) => ({
	user: one(users, {
		fields: [paymentIntents.userId],
		references: [users.id]
	}),
}));