-- Add per-employee leave credit entitlements to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS vl_credits integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS sl_credits integer NOT NULL DEFAULT 10;
