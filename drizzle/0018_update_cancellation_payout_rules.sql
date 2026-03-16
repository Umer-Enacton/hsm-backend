-- Add platform fee tracking to bookings table
-- Add reschedule fee payout tracking fields
-- Add reschedule fee payout status to payments table

-- Add platformFeeAmount column to bookings table
ALTER TABLE "bookings" ADD COLUMN "platform_fee_amount" integer;

-- Add reschedule fee provider payout tracking to bookings table
ALTER TABLE "bookings" ADD COLUMN "reschedule_fee_provider_payout" integer;
ALTER TABLE "bookings" ADD COLUMN "reschedule_fee_payout_status" varchar(20);

-- Add reschedule fee payout status to payments table
ALTER TABLE "payments" ADD COLUMN "reschedule_fee_payout_status" varchar(20);
