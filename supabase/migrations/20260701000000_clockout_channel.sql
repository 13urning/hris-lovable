-- Adds clockout_channel: the source channel of a DEVICE-initiated clock-OUT
-- (e.g. nfc, face, biometric). NULL means a web/self clock-out or not yet
-- clocked out. This is a DETECTIVE marker for the device-trust early-clock-out
-- review (security-gate finding C7): it lets HR distinguish a short day an
-- employee ended themselves from one a device ended for them.
--
-- Additive, nullable, no default, no backfill -> metadata-only change, no row
-- rewrite. It is never read by the payroll cutoff / approval / lock triggers.
ALTER TABLE public.daily_time_reports
  ADD COLUMN IF NOT EXISTS clockout_channel TEXT;

COMMENT ON COLUMN public.daily_time_reports.clockout_channel IS
  'Source channel of a DEVICE-initiated clock-OUT (e.g. nfc, face, biometric). '
  'NULL = web/self clock-out or not yet clocked out. Detective marker for the '
  'C7 review; never read by triggers or the approval/cutoff flow.';
