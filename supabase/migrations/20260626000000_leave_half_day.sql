-- Migration: half-day leave support
--
-- Lets an employee file a half-day leave. A half-day leave always applies to a
-- single date (start_date = end_date) and counts as 0.5 business days against
-- the employee's balance. half_day_period records which half of the day is
-- being taken off ('AM' or 'PM'). The single-day / non-null-period invariants
-- are enforced in the application layer (server functions), consistent with the
-- rest of the schema on Cloud SQL.

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS half_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS half_day_period text
    CHECK (half_day_period IS NULL OR half_day_period IN ('AM', 'PM'));
