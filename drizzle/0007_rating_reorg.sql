-- Remove rating from business_profiles, add to services
-- Update feedback table with serviceId and customerId

-- Step 1: Add rating and totalReviews to services
ALTER TABLE "services" ADD COLUMN "rating" decimal(3,2) DEFAULT 0;
ALTER TABLE "services" ADD COLUMN "total_reviews" integer DEFAULT 0;

-- Step 2: Calculate average rating from feedback and update services
UPDATE "services" AS s
SET
  rating = COALESCE(
    (SELECT ROUND(AVG(f.rating)::numeric, 2) FROM feedback f WHERE f.service_id = s.id),
    0
  ),
  total_reviews = COALESCE(
    (SELECT COUNT(*)::integer FROM feedback f WHERE f.service_id = s.id),
    0
  );

-- Step 3: Remove rating from business_profiles (this will be done in another migration if needed)
-- ALTER TABLE "business_profiles" DROP COLUMN IF EXISTS "rating";

-- Step 4: Add serviceId and customerId to feedback
ALTER TABLE "feedback" ADD COLUMN "service_id" integer;
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"(id) ON DELETE CASCADE;

ALTER TABLE "feedback" ADD COLUMN "customer_id" integer;
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"(id) ON DELETE CASCADE;

-- Update existing feedback records with serviceId and customerId from booking
UPDATE "feedback" f
SET
  "service_id" = b.service_id,
  "customer_id" = b.customer_id
FROM bookings b
WHERE f.booking_id = b.id;
