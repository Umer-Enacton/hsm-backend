ALTER TABLE "slots" DROP CONSTRAINT "slots_service_id_services_id_fk";
--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN "business_profile_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_business_profile_id_business_profiles_id_fk" FOREIGN KEY ("business_profile_id") REFERENCES "public"."business_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" DROP COLUMN "service_id";--> statement-breakpoint
ALTER TABLE "slots" DROP COLUMN "slot_date";