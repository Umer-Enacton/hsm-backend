-- Notifications table - stores all user notifications
CREATE TABLE IF NOT EXISTS "notifications" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  data JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast unread notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON "notifications"(user_id, is_read) WHERE is_read = FALSE;
-- Index for user notification queries ordered by date
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON "notifications"(user_id, created_at DESC);

-- Device tokens table - stores FCM tokens for push notifications
CREATE TABLE IF NOT EXISTS "device_tokens" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
  token VARCHAR(500) NOT NULL UNIQUE,
  device_info JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for token lookup
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON "device_tokens"(user_id, is_active);

-- Add reminder flags to bookings table
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "reminder_sent" BOOLEAN DEFAULT FALSE;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "upcoming_reminder_sent" BOOLEAN DEFAULT FALSE;
