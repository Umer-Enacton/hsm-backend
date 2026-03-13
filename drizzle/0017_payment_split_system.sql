-- Migration: Payment Split System
-- This migration adds tables for payment details (UPI/Bank) for admin and providers,
-- admin settings for platform fee configuration, and enhancements to existing tables.

-- ============================================
-- 1. Payment Details Table
-- Stores UPI and Bank account details for admin and providers
-- ============================================
CREATE TABLE IF NOT EXISTS payment_details (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_type VARCHAR(10) NOT NULL, -- 'upi' or 'bank'
  upi_id VARCHAR(100), -- UPI ID (e.g., name@upi)
  bank_account VARCHAR(30), -- Bank account number (will be masked)
  ifsc_code VARCHAR(15), -- IFSC code
  account_holder_name VARCHAR(255), -- Account holder name
  razorpay_contact_id VARCHAR(100), -- Razorpay contact ID for payouts
  razorpay_fund_account_id VARCHAR(100), -- Razorpay fund account ID
  is_active BOOLEAN DEFAULT true NOT NULL, -- Active payment method
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Index for quick lookup of user's payment details
CREATE INDEX idx_payment_details_user_id ON payment_details(user_id);
CREATE INDEX idx_payment_details_is_active ON payment_details(is_active);

-- ============================================
-- 2. Admin Settings Table
-- Stores platform-wide configuration
-- ============================================
CREATE TABLE IF NOT EXISTS admin_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(50) NOT NULL UNIQUE,
  value TEXT NOT NULL,
  description VARCHAR(255),
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Insert default platform fee percentage (5%)
INSERT INTO admin_settings (key, value, description)
VALUES ('platform_fee_percentage', '5', 'Platform commission percentage charged on each booking')
ON CONFLICT (key) DO NOTHING;

-- Insert minimum payout amount (₹1000 = 100000 paise)
INSERT INTO admin_settings (key, value, description)
VALUES ('minimum_payout_amount', '100000', 'Minimum amount required for provider payout in paise')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- 3. Add hasPaymentDetails to business_profiles
-- Tracks whether provider has added payment details
-- ============================================
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS has_payment_details BOOLEAN DEFAULT false NOT NULL;

-- ============================================
-- 4. Add split payment tracking to payments table
-- Tracks platform fee and provider share for each payment
-- ============================================
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS platform_fee INTEGER DEFAULT 0, -- Platform commission in paise
ADD COLUMN IF NOT EXISTS provider_share INTEGER DEFAULT 0, -- Provider amount in paise
ADD COLUMN IF NOT EXISTS payment_split_type VARCHAR(20), -- 'split' or 'manual'
ADD COLUMN IF NOT EXISTS split_status VARCHAR(20); -- 'pending', 'completed', 'failed'

-- ============================================
-- 5. Create indexes for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_business_profiles_has_payment_details
ON business_profiles(has_payment_details);

CREATE INDEX IF NOT EXISTS idx_payments_split_status
ON payments(split_status);
