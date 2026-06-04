
-- Auto-compute overtime_hours: weekend = all hours, weekday = hours - 9
CREATE OR REPLACE FUNCTION public.dtr_auto_overtime()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dow INT;
  v_auto NUMERIC;
BEGIN
  IF NEW.is_absent OR NEW.is_leave THEN
    RETURN NEW;
  END IF;
  v_dow := EXTRACT(ISODOW FROM NEW.work_date);
  IF v_dow >= 6 THEN
    v_auto := COALESCE(NEW.hours_worked, 0);
  ELSE
    v_auto := GREATEST(COALESCE(NEW.hours_worked, 0) - 9, 0);
  END IF;
  IF v_auto > COALESCE(NEW.overtime_hours, 0) THEN
    NEW.overtime_hours := v_auto;
    IF NEW.ot_status IS NULL OR NEW.ot_status = 'pending' THEN
      NEW.ot_status := 'pending';
      NEW.ot_approved_hours := 0;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dtr_auto_overtime_trg ON public.daily_time_reports;
CREATE TRIGGER dtr_auto_overtime_trg
BEFORE INSERT OR UPDATE ON public.daily_time_reports
FOR EACH ROW EXECUTE FUNCTION public.dtr_auto_overtime();

-- Backfill existing rows
UPDATE public.daily_time_reports
SET overtime_hours = CASE
  WHEN is_absent OR is_leave THEN overtime_hours
  WHEN EXTRACT(ISODOW FROM work_date) >= 6 THEN GREATEST(hours_worked, overtime_hours)
  ELSE GREATEST(hours_worked - 9, overtime_hours, 0)
END
WHERE locked_at IS NULL;

-- Recompute submission totals
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT employee_id, cutoff_id FROM public.daily_time_reports WHERE cutoff_id IS NOT NULL LOOP
    PERFORM public.recalc_cutoff_submission(r.employee_id, r.cutoff_id);
  END LOOP;
END $$;
