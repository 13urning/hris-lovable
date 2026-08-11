-- Self-reported clock-out for a day the employee forgot to close.
--
-- Until now the only way to fix a missing punch was an attendance dispute, which
-- costs a full approver cycle for what is usually just a forgotten tap. The app
-- can now surface the open day the next working day and let the employee enter
-- the time themselves, WITHOUT approval -- capped at their shift end so a
-- self-report can never claim a longer day than they were rostered for.
--
-- Because that path skips review, every row it writes is tagged here so HR can
-- see -- and report on -- which hours were self-declared rather than punched.

ALTER TABLE public.daily_time_reports
  ADD COLUMN IF NOT EXISTS time_out_self_reported BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS time_out_reported_at   TIMESTAMPTZ;

COMMENT ON COLUMN public.daily_time_reports.time_out_self_reported IS
  'TRUE when time_out was entered by the employee after the fact for a day they '
  'forgot to clock out. Bypasses the dispute approver chain, so it is capped at '
  'the shift end and flagged here for audit. FALSE = a real punch (web or device).';

COMMENT ON COLUMN public.daily_time_reports.time_out_reported_at IS
  'When the self-report was submitted. Distinct from time_out, which is the '
  'working time being claimed, and from updated_at, which any write moves.';

-- Partial index: HR reporting only ever asks for the tagged minority, and the
-- banner's own lookup is by (employee_id, work_date), already unique.
CREATE INDEX IF NOT EXISTS idx_dtr_self_reported_clockout
  ON public.daily_time_reports (work_date DESC)
  WHERE time_out_self_reported;
