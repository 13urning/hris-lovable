-- OT approval redesign: pre-approved budgets + actual filings

-- Make dtr_id nullable (pre-approved requests are not tied to a specific DTR entry)
ALTER TABLE ot_approval_requests ALTER COLUMN dtr_id DROP NOT NULL;

-- Add columns to distinguish request type and link actual filings to their budget
ALTER TABLE ot_approval_requests
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'pre_approved'
    CHECK (request_type IN ('pre_approved', 'actual')),
  ADD COLUMN IF NOT EXISTS pre_approved_id uuid
    REFERENCES ot_approval_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_month date;
-- target_month: for pre_approved type, stores the month (YYYY-MM-01) the budget is for
