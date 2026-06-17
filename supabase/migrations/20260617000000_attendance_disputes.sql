-- Migration: attendance disputes
--
-- Lets an employee dispute a day's recorded attendance (clock-in / clock-out /
-- shift). The request is routed up the org chart for approval using the same
-- multi-step approver-chain mechanism as leave_requests. On final approval the
-- corrected times are written back to daily_time_reports (a row is created if
-- the disputed day had no record, e.g. an absence being corrected).

CREATE TABLE IF NOT EXISTS attendance_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- The disputed DTR row, when one exists. NULL means the day had no record
  -- (e.g. the employee was flagged absent and is adding attendance).
  dtr_id uuid REFERENCES daily_time_reports(id) ON DELETE SET NULL,
  work_date date NOT NULL,

  -- Snapshot of the values at filing time, for audit / comparison.
  original_time_in text,
  original_time_out text,
  original_shift_label text,

  -- Corrected values the employee is requesting.
  requested_time_in text,
  requested_time_out text,
  requested_shift_label text,

  reason text,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),

  -- Ordered list of approver employee_ids (immediate supervisor first), mirrored
  -- from leave_requests. current_approver_index points at the next approver.
  approver_chain uuid[] NOT NULL DEFAULT '{}',
  current_approver_index integer NOT NULL DEFAULT 0,

  reviewed_by uuid REFERENCES profiles(id),
  reviewed_at timestamptz,
  review_notes text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for the two hot lookups: an employee's own disputes, and the
-- approver-queue scan by status. Access is enforced at the application layer
-- (auth middleware + server functions), consistent with the rest of the schema
-- on Cloud SQL — no RLS / auth.uid() here.
CREATE INDEX IF NOT EXISTS attendance_disputes_employee_idx
  ON attendance_disputes (employee_id);
CREATE INDEX IF NOT EXISTS attendance_disputes_status_idx
  ON attendance_disputes (status);
