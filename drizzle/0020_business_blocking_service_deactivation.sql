-- Add blocking fields to business_profiles
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS blocked_by INTEGER REFERENCES users(id);

-- Add deactivation reason to services
ALTER TABLE services
ADD COLUMN IF NOT EXISTS deactivation_reason TEXT,
ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS deactivated_by INTEGER REFERENCES users(id);

-- Create index for blocked businesses
CREATE INDEX IF NOT EXISTS idx_business_profiles_blocked ON business_profiles(is_blocked);
