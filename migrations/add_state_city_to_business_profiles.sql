-- Migration: Add state and city columns to business_profiles table
-- Date: 2025-02-24

-- Add state column
ALTER TABLE business_profiles
ADD COLUMN state VARCHAR(100) NOT NULL DEFAULT 'Punjab';

-- Add city column
ALTER TABLE business_profiles
ADD COLUMN city VARCHAR(100) NOT NULL DEFAULT 'Lahore';

-- Add comment for documentation
COMMENT ON COLUMN business_profiles.state IS 'State/Province where the business is located';
COMMENT ON COLUMN business_profiles.city IS 'City where the business is located';
