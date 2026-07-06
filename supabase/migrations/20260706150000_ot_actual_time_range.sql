-- File OT Hours: capture the actual work window (time_from/time_to) for 'actual'
-- OT filings. requested_hours stays the server-computed source of truth — every
-- cap SUM, dashboard, approver display, and notification reads it — so these two
-- columns are purely additive. Budgets ('pre_approved') and legacy actual rows
-- keep both NULL.

ALTER TABLE ot_approval_requests
  ADD COLUMN IF NOT EXISTS time_from time,
  ADD COLUMN IF NOT EXISTS time_to   time;

-- Integrity: the pair is all-or-nothing. Prevents a half-populated window that
-- would desync the displayed range from requested_hours. Legacy/budget rows
-- (both NULL) satisfy this.
ALTER TABLE ot_approval_requests
  DROP CONSTRAINT IF EXISTS ot_actual_time_pair_check;
ALTER TABLE ot_approval_requests
  ADD CONSTRAINT ot_actual_time_pair_check
  CHECK ((time_from IS NULL) = (time_to IS NULL));
