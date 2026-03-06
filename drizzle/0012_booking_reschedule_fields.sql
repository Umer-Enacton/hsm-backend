-- Add new booking statuses
ALTER TYPE "booking_status" ADD VALUE 'reschedule_pending';
ALTER TYPE "booking_status" ADD VALUE 'rejected';

-- Add reschedule tracking fields to bookings table
ALTER TABLE "bookings" ADD COLUMN "previous_slot_id" integer;
ALTER TABLE "bookings" ADD COLUMN "previous_booking_date" timestamp;
ALTER TABLE "bookings" ADD COLUMN "reschedule_reason" varchar(500);
ALTER TABLE "bookings" ADD COLUMN "rescheduled_by" varchar(20);
ALTER TABLE "bookings" ADD COLUMN "rescheduled_at" timestamp;
