ALTER TABLE "bookings" DROP CONSTRAINT "bookings_business_profile_id_business_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_service_id_services_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_slot_id_slots_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_address_id_address_id_fk";
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "image" varchar(500);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar" varchar(500);--> statement-breakpoint
ALTER TABLE "business_profiles" ADD COLUMN "logo" varchar(500);--> statement-breakpoint
ALTER TABLE "business_profiles" ADD COLUMN "cover_image" varchar(500);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "image" varchar(500);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_profile_id_business_profiles_id_fk" FOREIGN KEY ("business_profile_id") REFERENCES "public"."business_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_address_id_address_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."address"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "address" DROP COLUMN "is_default";