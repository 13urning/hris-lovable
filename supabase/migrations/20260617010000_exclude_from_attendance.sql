-- Migration: per-employee attendance-tracking opt-out
--
-- Generalizes the previously hard-coded localadmin exclusion. When TRUE, the
-- employee is excluded from attendance/absence monitoring: no live "absent" rows
-- are synthesized for them, and they're hidden from the HR activity log and the
-- today roster. Their own clock-ins still record normally.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS exclude_from_attendance boolean NOT NULL DEFAULT false;
