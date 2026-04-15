-- Add version column to terms_condition_notifications
ALTER TABLE terms_condition_notifications ADD COLUMN version VARCHAR(20) NOT NULL;

-- Add version column to privacy_policy_notifications
ALTER TABLE privacy_policy_notifications ADD COLUMN version VARCHAR(20) NOT NULL;