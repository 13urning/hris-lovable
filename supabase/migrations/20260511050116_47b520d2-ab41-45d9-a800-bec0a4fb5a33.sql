
-- =========================================================================
-- ENUMS
-- =========================================================================
CREATE TYPE public.app_role AS ENUM ('employee', 'hr', 'admin');
CREATE TYPE public.cutoff_status AS ENUM ('open', 'closed', 'paid');
CREATE TYPE public.dtr_approval_status AS ENUM (
  'draft', 'submitted', 'pending_approval', 'approved', 'rejected', 'needs_correction'
);
CREATE TYPE public.approval_action AS ENUM (
  'submitted', 'approved', 'rejected', 'needs_correction', 'unlocked', 'resubmitted'
);

-- =========================================================================
-- PROFILES
-- =========================================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  employee_code TEXT,
  department TEXT NOT NULL DEFAULT 'General',
  position TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================================
-- USER ROLES
-- =========================================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_hr_or_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('hr','admin')
  );
$$;

-- =========================================================================
-- PAYROLL CUTOFFS
-- =========================================================================
CREATE TABLE public.payroll_cutoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cutoff_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  payout_date DATE,
  status public.cutoff_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (start_date, end_date)
);
CREATE INDEX idx_cutoffs_dates ON public.payroll_cutoffs(start_date, end_date);

-- =========================================================================
-- DAILY TIME REPORTS
-- =========================================================================
CREATE TABLE public.daily_time_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  time_in TIME,
  time_out TIME,
  hours_worked NUMERIC(5,2) NOT NULL DEFAULT 0,
  late_minutes INT NOT NULL DEFAULT 0,
  is_absent BOOLEAN NOT NULL DEFAULT FALSE,
  is_leave BOOLEAN NOT NULL DEFAULT FALSE,
  leave_type TEXT,
  overtime_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  notes TEXT,
  cutoff_id UUID REFERENCES public.payroll_cutoffs(id),
  approval_status public.dtr_approval_status NOT NULL DEFAULT 'draft',
  locked_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  correction_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);
CREATE INDEX idx_dtr_employee_date ON public.daily_time_reports(employee_id, work_date);
CREATE INDEX idx_dtr_cutoff ON public.daily_time_reports(cutoff_id);

-- =========================================================================
-- DTR CUTOFF SUBMISSIONS
-- =========================================================================
CREATE TABLE public.dtr_cutoff_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cutoff_id UUID NOT NULL REFERENCES public.payroll_cutoffs(id) ON DELETE CASCADE,
  approval_status public.dtr_approval_status NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMPTZ,
  total_days_submitted INT NOT NULL DEFAULT 0,
  total_hours NUMERIC(7,2) NOT NULL DEFAULT 0,
  missing_dtr_count INT NOT NULL DEFAULT 0,
  late_count INT NOT NULL DEFAULT 0,
  absent_count INT NOT NULL DEFAULT 0,
  overtime_hours NUMERIC(7,2) NOT NULL DEFAULT 0,
  leave_days INT NOT NULL DEFAULT 0,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  correction_notes TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, cutoff_id)
);
CREATE INDEX idx_subs_employee ON public.dtr_cutoff_submissions(employee_id);
CREATE INDEX idx_subs_cutoff ON public.dtr_cutoff_submissions(cutoff_id);
CREATE INDEX idx_subs_status ON public.dtr_cutoff_submissions(approval_status);

-- =========================================================================
-- DTR APPROVAL LOGS
-- =========================================================================
CREATE TABLE public.dtr_approval_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dtr_cutoff_submission_id UUID NOT NULL REFERENCES public.dtr_cutoff_submissions(id) ON DELETE CASCADE,
  action public.approval_action NOT NULL,
  action_by UUID NOT NULL REFERENCES auth.users(id),
  action_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);
CREATE INDEX idx_logs_submission ON public.dtr_approval_logs(dtr_cutoff_submission_id);

-- =========================================================================
-- TRIGGER: handle_new_user → profile + employee role
-- =========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    NEW.email
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- TRIGGER: updated_at touch
-- =========================================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_dtr_touch BEFORE UPDATE ON public.daily_time_reports
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_subs_touch BEFORE UPDATE ON public.dtr_cutoff_submissions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================================
-- Cutoff resolver — find cutoff covering a given date
-- =========================================================================
CREATE OR REPLACE FUNCTION public.find_cutoff_for_date(_d DATE)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.payroll_cutoffs
  WHERE _d BETWEEN start_date AND end_date
  ORDER BY start_date DESC LIMIT 1;
$$;

-- =========================================================================
-- Recalc cutoff submission totals
-- =========================================================================
CREATE OR REPLACE FUNCTION public.recalc_cutoff_submission(_employee UUID, _cutoff UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start DATE; v_end DATE;
  v_days INT; v_hours NUMERIC; v_late INT; v_absent INT; v_ot NUMERIC; v_leave INT;
  v_workdays INT; v_submitted INT; v_missing INT;
BEGIN
  IF _cutoff IS NULL THEN RETURN; END IF;
  SELECT start_date, end_date INTO v_start, v_end FROM public.payroll_cutoffs WHERE id = _cutoff;
  IF v_start IS NULL THEN RETURN; END IF;

  -- Count weekdays (Mon-Fri) in cutoff as expected working days
  SELECT COUNT(*) INTO v_workdays
  FROM generate_series(v_start, v_end, INTERVAL '1 day') AS d
  WHERE EXTRACT(ISODOW FROM d) < 6;

  SELECT
    COUNT(*) FILTER (WHERE NOT is_absent AND NOT is_leave),
    COALESCE(SUM(hours_worked),0),
    COUNT(*) FILTER (WHERE late_minutes > 0),
    COUNT(*) FILTER (WHERE is_absent),
    COALESCE(SUM(overtime_hours),0),
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
$$;

-- =========================================================================
-- TRIGGER: assign cutoff_id + lock guard + recalc
-- =========================================================================
CREATE OR REPLACE FUNCTION public.dtr_before_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status public.dtr_approval_status;
BEGIN
  -- Auto-assign cutoff from work_date
  IF NEW.cutoff_id IS NULL THEN
    NEW.cutoff_id := public.find_cutoff_for_date(NEW.work_date);
  END IF;

  -- Block edits if parent submission is approved & locked (unless HR/admin)
  IF TG_OP = 'UPDATE' AND OLD.locked_at IS NOT NULL
     AND NOT public.is_hr_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'This DTR is locked because the cutoff has been approved';
  END IF;

  -- Mirror parent submission status onto DTR row
  IF NEW.cutoff_id IS NOT NULL THEN
    SELECT approval_status INTO v_status
    FROM public.dtr_cutoff_submissions
    WHERE employee_id = NEW.employee_id AND cutoff_id = NEW.cutoff_id;
    IF v_status IS NOT NULL THEN NEW.approval_status := v_status; END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dtr_before_write
BEFORE INSERT OR UPDATE ON public.daily_time_reports
FOR EACH ROW EXECUTE FUNCTION public.dtr_before_write();

CREATE OR REPLACE FUNCTION public.dtr_after_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_cutoff_submission(OLD.employee_id, OLD.cutoff_id);
    RETURN OLD;
  END IF;
  PERFORM public.recalc_cutoff_submission(NEW.employee_id, NEW.cutoff_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dtr_after_write
AFTER INSERT OR UPDATE OR DELETE ON public.daily_time_reports
FOR EACH ROW EXECUTE FUNCTION public.dtr_after_write();

-- =========================================================================
-- TRIGGER: when submission approved/rejected/needs_correction → cascade lock
-- =========================================================================
CREATE OR REPLACE FUNCTION public.subs_after_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.approval_status = 'approved' AND OLD.approval_status <> 'approved' THEN
    NEW.locked_at := now();
  END IF;
  IF OLD.approval_status = 'approved' AND NEW.approval_status <> 'approved' THEN
    NEW.locked_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_subs_status BEFORE UPDATE ON public.dtr_cutoff_submissions
FOR EACH ROW EXECUTE FUNCTION public.subs_after_status_change();

CREATE OR REPLACE FUNCTION public.subs_after_update_lock_dtrs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.locked_at IS NOT NULL AND (OLD.locked_at IS NULL OR OLD.locked_at <> NEW.locked_at) THEN
    UPDATE public.daily_time_reports
    SET locked_at = NEW.locked_at,
        approval_status = NEW.approval_status,
        approved_by = NEW.approved_by,
        approved_at = NEW.approved_at
    WHERE employee_id = NEW.employee_id AND cutoff_id = NEW.cutoff_id;
  ELSIF NEW.locked_at IS NULL AND OLD.locked_at IS NOT NULL THEN
    UPDATE public.daily_time_reports
    SET locked_at = NULL,
        approval_status = NEW.approval_status
    WHERE employee_id = NEW.employee_id AND cutoff_id = NEW.cutoff_id;
  ELSIF NEW.approval_status <> OLD.approval_status THEN
    UPDATE public.daily_time_reports
    SET approval_status = NEW.approval_status
    WHERE employee_id = NEW.employee_id AND cutoff_id = NEW.cutoff_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_subs_after_update AFTER UPDATE ON public.dtr_cutoff_submissions
FOR EACH ROW EXECUTE FUNCTION public.subs_after_update_lock_dtrs();

-- =========================================================================
-- SEED CUTOFFS (10th and 25th cycle) — prev, current, next 2
-- =========================================================================
DO $$
DECLARE
  base DATE := date_trunc('month', CURRENT_DATE)::DATE;
  m DATE;
  s DATE; e DATE; p DATE; nm TEXT;
BEGIN
  FOR i IN -1..2 LOOP
    m := (base + (i || ' months')::INTERVAL)::DATE;
    -- First cutoff: 26th of previous month → 10th of m
    s := (m - INTERVAL '1 month' + INTERVAL '25 days')::DATE;
    e := (m + INTERVAL '9 days')::DATE;
    p := (m + INTERVAL '14 days')::DATE;
    nm := to_char(m, 'Mon YYYY') || ' — 1st Cut Off';
    INSERT INTO public.payroll_cutoffs (cutoff_name, start_date, end_date, payout_date)
    VALUES (nm, s, e, p) ON CONFLICT (start_date, end_date) DO NOTHING;
    -- Second cutoff: 11th → 25th of m
    s := (m + INTERVAL '10 days')::DATE;
    e := (m + INTERVAL '24 days')::DATE;
    p := (m + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    nm := to_char(m, 'Mon YYYY') || ' — 2nd Cut Off';
    INSERT INTO public.payroll_cutoffs (cutoff_name, start_date, end_date, payout_date)
    VALUES (nm, s, e, p) ON CONFLICT (start_date, end_date) DO NOTHING;
  END LOOP;
END $$;

-- =========================================================================
-- RLS
-- =========================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_cutoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_time_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dtr_cutoff_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dtr_approval_logs ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles_self_read" ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.is_hr_or_admin(auth.uid()));
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid() OR public.is_hr_or_admin(auth.uid()));
CREATE POLICY "profiles_admin_insert" ON public.profiles FOR INSERT TO authenticated
WITH CHECK (public.is_hr_or_admin(auth.uid()));

-- user_roles
CREATE POLICY "roles_self_read" ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_hr_or_admin(auth.uid()));
CREATE POLICY "roles_admin_manage" ON public.user_roles FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'admin'));

-- payroll_cutoffs
CREATE POLICY "cutoffs_read_all" ON public.payroll_cutoffs FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "cutoffs_hr_manage" ON public.payroll_cutoffs FOR ALL TO authenticated
USING (public.is_hr_or_admin(auth.uid()))
WITH CHECK (public.is_hr_or_admin(auth.uid()));

-- daily_time_reports
CREATE POLICY "dtr_self_read" ON public.daily_time_reports FOR SELECT TO authenticated
USING (employee_id = auth.uid() OR public.is_hr_or_admin(auth.uid()));
CREATE POLICY "dtr_self_insert" ON public.daily_time_reports FOR INSERT TO authenticated
WITH CHECK (employee_id = auth.uid() OR public.is_hr_or_admin(auth.uid()));
CREATE POLICY "dtr_self_update" ON public.daily_time_reports FOR UPDATE TO authenticated
USING (
  (employee_id = auth.uid() AND locked_at IS NULL)
  OR public.is_hr_or_admin(auth.uid())
);
CREATE POLICY "dtr_self_delete" ON public.daily_time_reports FOR DELETE TO authenticated
USING (
  (employee_id = auth.uid() AND locked_at IS NULL)
  OR public.is_hr_or_admin(auth.uid())
);

-- dtr_cutoff_submissions
CREATE POLICY "subs_self_read" ON public.dtr_cutoff_submissions FOR SELECT TO authenticated
USING (employee_id = auth.uid() OR public.is_hr_or_admin(auth.uid()));
CREATE POLICY "subs_self_insert" ON public.dtr_cutoff_submissions FOR INSERT TO authenticated
WITH CHECK (employee_id = auth.uid() OR public.is_hr_or_admin(auth.uid()));
CREATE POLICY "subs_self_update" ON public.dtr_cutoff_submissions FOR UPDATE TO authenticated
USING (
  (employee_id = auth.uid() AND approval_status IN ('draft','rejected','needs_correction'))
  OR public.is_hr_or_admin(auth.uid())
);

-- dtr_approval_logs
CREATE POLICY "logs_read" ON public.dtr_approval_logs FOR SELECT TO authenticated
USING (
  public.is_hr_or_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.dtr_cutoff_submissions s
    WHERE s.id = dtr_cutoff_submission_id AND s.employee_id = auth.uid()
  )
);
CREATE POLICY "logs_insert" ON public.dtr_approval_logs FOR INSERT TO authenticated
WITH CHECK (
  action_by = auth.uid() AND (
    public.is_hr_or_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.dtr_cutoff_submissions s
      WHERE s.id = dtr_cutoff_submission_id AND s.employee_id = auth.uid()
    )
  )
);
