ALTER TABLE "services" DROP CONSTRAINT "services_provider_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "services" DROP CONSTRAINT "services_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "business_profile_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_business_profile_id_business_profiles_id_fk" FOREIGN KEY ("business_profile_id") REFERENCES "public"."business_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" DROP COLUMN "provider_id";--> statement-breakpoint
ALTER TABLE "services" DROP COLUMN "category_id";