
-- OT approval enum
DO $$ BEGIN
  CREATE TYPE public.ot_approval_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-DTR OT approval fields
ALTER TABLE public.daily_time_reports
  ADD COLUMN IF NOT EXISTS ot_status public.ot_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ot_approved_hours numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ot_approved_by uuid,
  ADD COLUMN IF NOT EXISTS ot_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS ot_review_notes text;

-- Recalc cut-off totals using APPROVED OT only
CREATE OR REPLACE FUNCTION public.recalc_cutoff_submission(_employee uuid, _cutoff uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start DATE; v_end DATE;
  v_days INT; v_hours NUMERIC; v_late INT; v_absent INT; v_ot NUMERIC; v_leave INT;
  v_workdays INT; v_submitted INT; v_missing INT;
BEGIN
  IF _cutoff IS NULL THEN RETURN; END IF;
  SELECT start_date, end_date INTO v_start, v_end FROM public.payroll_cutoffs WHERE id = _cutoff;
  IF v_start IS NULL THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_workdays
  FROM generate_series(v_start, v_end, INTERVAL '1 day') AS d
  WHERE EXTRACT(ISODOW FROM d) < 6;

  SELECT
    COUNT(*) FILTER (WHERE NOT is_absent AND NOT is_leave),
    COALESCE(SUM(hours_worked),0),
    COUNT(*) FILTER (WHERE late_minutes > 0),
    COUNT(*) FILTER (WHERE is_absent),
    COALESCE(SUM(ot_approved_hours),0),
    COUNT(*) FILTER (WHERE is_leave),
    COUNT(*)
  INTO v_days, v_hours, v_late, v_absent, v_ot, v_leave, v_submitted
  FROM public.daily_time_reports
  WHERE employee_id = _employee AND cutoff_id = _cutoff;

  v_missing := GREATEST(v_workdays - v_submitted, 0);

  INSERT INTO public.dtr_cutoff_submissions
    (employee_id, cutoff_id, total_days_submitted, total_hours, late_count,
     absent_count, overtime_hours, leave_days, missing_dtr_count)
  VALUES
    (_employee, _cutoff, v_days, v_hours, v_late, v_absent, v_ot, v_leave, v_missing)
  ON CONFLICT (employee_id, cutoff_id) DO UPDATE
  SET total_days_submitted = EXCLUDED.total_days_submitted,
      total_hours = EXCLUDED.total_hours,
      late_count = EXCLUDED.late_count,
      absent_count = EXCLUDED.absent_count,
      overtime_hours = EXCLUDED.overtime_hours,
      leave_days = EXCLUDED.leave_days,
      missing_dtr_count = EXCLUDED.missing_dtr_count,
      updated_at = now();
END;
$function$;
