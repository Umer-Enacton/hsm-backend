-- Create payment_status enum type
CREATE TYPE payment_status AS ENUM ('pending', 'initiated', 'paid', 'failed', 'refunded');

-- Alter booking_status enum to add new values
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'payment_pending', 'confirmed', 'completed', 'cancelled', 'refunded'));

-- Add payment_status column to bookings table
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status payment_status DEFAULT 'pending' NOT NULL;

-- Create payments table
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  razorpay_order_id VARCHAR(100),
  razorpay_payment_id VARCHAR(100) UNIQUE,
  razorpay_signature VARCHAR(255),
  amount INTEGER NOT NULL,
  currency VARCHAR(10) DEFAULT 'INR' NOT NULL,
  status payment_status DEFAULT 'pending' NOT NULL,
  payment_method VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMP,
  failed_at TIMESTAMP,
  refunded_at TIMESTAMP,
  failure_reason VARCHAR(500),
  refund_id VARCHAR(100),
  refund_amount INTEGER,
  refund_reason VARCHAR(500)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_payment_id ON payments(razorpay_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
