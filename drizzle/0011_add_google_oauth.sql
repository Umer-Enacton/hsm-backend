-- Add Google OAuth support to users table
-- Migration: 0011_add_google_oauth

-- Add googleId column (optional, unique)
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Make phone and password nullable for OAuth users
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
