-- Add provider payout tracking columns to bookings table
-- This supports the 85% refund / 15% provider payout feature

-- Add refund amount tracking
ALTER TABLE "bookings" ADD COLUMN "refund_amount" integer;

-- Add provider payout columns
ALTER TABLE "bookings" ADD COLUMN "provider_payout_amount" integer;
ALTER TABLE "bookings" ADD COLUMN "provider_payout_status" varchar(20);
ALTER TABLE "bookings" ADD COLUMN "provider_payout_id" varchar(100);
ALTER TABLE "bookings" ADD COLUMN "provider_payout_at" timestamp;

-- Add comments for documentation
COMMENT ON COLUMN "bookings"."refund_amount" IS 'Amount refunded to customer in paise';
COMMENT ON COLUMN "bookings"."provider_payout_amount" IS 'Amount paid to provider in paise (15% when customer cancels confirmed booking)';
COMMENT ON COLUMN "bookings"."provider_payout_status" IS 'Status of provider payout: pending, paid, or failed';
COMMENT ON COLUMN "bookings"."provider_payout_id" IS 'Razorpay payout ID for tracking';
COMMENT ON COLUMN "bookings"."provider_payout_at" IS 'Timestamp when payout was processed';
