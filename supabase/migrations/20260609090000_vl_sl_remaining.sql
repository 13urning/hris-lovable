-- Store VL and SL remaining balance independently from the total entitlement.
-- Total (vl_credits / sl_credits) = annual entitlement set by admin.
-- Remaining (vl_remaining / sl_remaining) = current available balance, also set by admin.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS vl_remaining integer,
  ADD COLUMN IF NOT EXISTS sl_remaining integer;

-- Initialise remaining to match current entitlement for all existing employees.
UPDATE profiles
SET
  vl_remaining = COALESCE(vl_remaining, vl_credits),
  sl_remaining = COALESCE(sl_remaining, sl_credits);
