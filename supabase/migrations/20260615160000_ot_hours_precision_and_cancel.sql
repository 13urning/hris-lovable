-- OT requests: allow larger hour values and cancellation.

-- requested_hours was NUMERIC(4,2) → max 99.99, so any value >= 100 raised a
-- numeric field overflow. Widen to NUMERIC(6,2) (max 9999.99).
ALTER TABLE ot_approval_requests
  ALTER COLUMN requested_hours TYPE NUMERIC(6,2);

-- Allow employees to cancel their own pending OT requests (soft cancel). The
-- status CHECK previously permitted only pending/approved/rejected.
ALTER TABLE ot_approval_requests
  DROP CONSTRAINT IF EXISTS ot_approval_requests_status_check;
ALTER TABLE ot_approval_requests
  ADD CONSTRAINT ot_approval_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));
