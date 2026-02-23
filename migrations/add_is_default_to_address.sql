-- Migration: Add isDefault column to address table
-- Date: 2026-02-18
-- Description: Adds a boolean column to track the default address for each user

-- Add isDefault column to address table
ALTER TABLE address
ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false NOT NULL;

-- Set first address as default for users who have addresses
-- This ensures existing users have a default address
DO $$
DECLARE
    user_record RECORD;
    first_address_id INTEGER;
BEGIN
    FOR user_record IN
        SELECT DISTINCT user_id FROM address
    LOOP
        -- Get the first address for this user
        SELECT id INTO first_address_id
        FROM address
        WHERE user_id = user_record.user_id
        ORDER BY id
        LIMIT 1;

        -- Update it to be the default
        IF first_address_id IS NOT NULL THEN
            UPDATE address
            SET is_default = true
            WHERE id = first_address_id;
        END IF;
    END LOOP;
END $$;

-- Create index on is_default for faster queries
CREATE INDEX IF NOT EXISTS idx_address_is_default ON address(is_default);

COMMENT ON COLUMN address.is_default IS 'Flag to indicate if this is the user''s default address';
