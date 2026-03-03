-- Create payment_intent_status enum type
CREATE TYPE payment_intent_status AS ENUM ('pending', 'completed', 'failed', 'expired');

-- Create payment_intents table for slot locking during payment
CREATE TABLE IF NOT EXISTS payment_intents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL,
  slot_id INTEGER NOT NULL,
  address_id INTEGER NOT NULL,
  booking_date TIMESTAMP NOT NULL,
  amount INTEGER NOT NULL,
  razorpay_order_id VARCHAR(100),
  status payment_intent_status DEFAULT 'pending' NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMP,
  failure_reason VARCHAR(500)
);

-- Create indexes for faster lookups and cleanup
CREATE INDEX IF NOT EXISTS idx_payment_intents_user_id ON payment_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_slot_id ON payment_intents(slot_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status);
CREATE INDEX IF NOT EXISTS idx_payment_intents_expires_at ON payment_intents(expires_at);
CREATE INDEX IF NOT EXISTS idx_payment_intents_razorpay_order_id ON payment_intents(razorpay_order_id);

-- Add unique constraint to prevent double-booking during payment window
-- A slot can only have one pending payment intent at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_intents_pending_slot
  ON payment_intents(slot_id, booking_date)
  WHERE status = 'pending';
