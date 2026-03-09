-- Add OAuth support columns to users table
-- Run this in Supabase SQL Editor

-- Add google_id column (nullable, unique)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;

-- Add avatar column for profile pictures (nullable)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS avatar VARCHAR(500);

-- Make phone and password nullable (they might already be, but ensuring)
ALTER TABLE users
ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE users
ALTER COLUMN password DROP NOT NULL;

-- Verify changes
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;
