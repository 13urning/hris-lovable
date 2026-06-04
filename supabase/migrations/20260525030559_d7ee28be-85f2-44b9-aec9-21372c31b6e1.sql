
CREATE OR REPLACE FUNCTION public.sync_leave_to_dtr()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d DATE;
BEGIN
  -- Remove previously-synced leave DTR rows if status changed away from approved or row deleted
  IF (TG_OP = 'DELETE') OR (TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status <> 'approved') THEN
    DELETE FROM public.daily_time_reports
    WHERE employee_id = OLD.employee_id
      AND work_date BETWEEN OLD.start_date AND OLD.end_date
      AND is_leave = TRUE
      AND locked_at IS NULL;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  END IF;

  -- On approval (insert-approved or update-to-approved), upsert DTR rows for each date
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    d := NEW.start_date;
    WHILE d <= NEW.end_date LOOP
      INSERT INTO public.daily_time_reports
        (employee_id, work_date, time_in, time_out, hours_worked, late_minutes,
         overtime_hours, is_absent, is_leave, leave_type, notes)
      VALUES
        (NEW.employee_id, d, NULL, NULL, 0, 0, 0, FALSE, TRUE,
         COALESCE(NEW.leave_type, 'VL'),
         'Auto-added from approved leave request')
      ON CONFLICT (employee_id, work_date) DO UPDATE
      SET is_leave = TRUE,
          is_absent = FALSE,
          leave_type = COALESCE(NEW.leave_type, 'VL'),
          time_in = NULL,
          time_out = NULL,
          hours_worked = 0,
          late_minutes = 0,
          overtime_hours = 0,
          ot_approved_hours = 0,
          ot_status = 'pending',
          notes = COALESCE(public.daily_time_reports.notes, 'Auto-added from approved leave request')
      WHERE public.daily_time_reports.locked_at IS NULL;
      d := d + INTERVAL '1 day';
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leave_request_sync_dtr ON public.leave_requests;
CREATE TRIGGER leave_request_sync_dtr
AFTER INSERT OR UPDATE OR DELETE ON public.leave_requests
FOR EACH ROW EXECUTE FUNCTION public.sync_leave_to_dtr();

-- Backfill: sync any already-approved leave requests
DO $$
DECLARE r RECORD; d DATE;
BEGIN
  FOR r IN SELECT * FROM public.leave_requests WHERE status = 'approved' LOOP
    d := r.start_date;
    WHILE d <= r.end_date LOOP
      INSERT INTO public.daily_time_reports
        (employee_id, work_date, time_in, time_out, hours_worked, late_minutes,
         overtime_hours, is_absent, is_leave, leave_type, notes)
      VALUES
        (r.employee_id, d, NULL, NULL, 0, 0, 0, FALSE, TRUE,
         COALESCE(r.leave_type, 'VL'),
         'Auto-added from approved leave request')
      ON CONFLICT (employee_id, work_date) DO UPDATE
      SET is_leave = TRUE,
          is_absent = FALSE,
          leave_type = COALESCE(r.leave_type, 'VL'),
          time_in = NULL,
          time_out = NULL,
          hours_worked = 0,
          late_minutes = 0,
          overtime_hours = 0
      WHERE public.daily_time_reports.locked_at IS NULL;
      d := d + INTERVAL '1 day';
    END LOOP;
  END LOOP;
END $$;
