-- Add reschedule fields to payment_intents table
ALTER TABLE "payment_intents" ADD COLUMN "is_reschedule" boolean DEFAULT false NOT NULL;
ALTER TABLE "payment_intents" ADD COLUMN "reschedule_booking_id" integer;
