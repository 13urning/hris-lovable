-- =============================================================================
-- Wave HRIS — Cloud SQL Compatible Schema
-- =============================================================================
-- Derived from supabase/migrations/ with all Supabase-specific items removed:
--   • auth.users replaced by public.users (firebase_uid column added for Phase 5)
--   • All REFERENCES auth.users(id) → REFERENCES public.users(id)
--   • All RLS policies removed — authorization handled at application layer
--   • auth.uid() removed from trigger functions
--   • on_auth_user_created trigger removed — replaced by Cloud Function in Phase 5
--
-- ⚠️  Performance tables (evaluation_periods, kpi_templates, performance_evaluations,
--     evaluation_kpi_scores, evaluation_behavioral_scores, behavioral_competencies)
--     are NOT in local migrations. Dump them separately from Supabase and run after
--     this script.
--
-- Run order: apply this entire file first, then import data.
-- =============================================================================


-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE public.app_role AS ENUM ('employee', 'hr', 'admin');

CREATE TYPE public.cutoff_status AS ENUM ('open', 'closed', 'paid');

CREATE TYPE public.dtr_approval_status AS ENUM (
  'draft', 'submitted', 'pending_approval', 'approved', 'rejected', 'needs_correction'
);

CREATE TYPE public.approval_action AS ENUM (
  'submitted', 'approved', 'rejected', 'needs_correction', 'unlocked', 'resubmitted'
);

CREATE TYPE public.leave_request_status AS ENUM (
  'pending', 'approved', 'rejected', 'cancelled'
);


-- =============================================================================
-- USERS  (replaces auth.users — Firebase UID stored in firebase_uid)
-- =============================================================================
-- In Phase 5 (Firebase Auth), every authenticated user will have a firebase_uid.
-- The id column stays UUID so all existing foreign keys remain compatible.
-- Application middleware resolves firebase_uid → id on each request.

CREATE TABLE public.users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT UNIQUE,
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =============================================================================
-- PROFILES
-- =============================================================================

CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL DEFAULT '',
  email         TEXT,
  employee_code TEXT,
  department    TEXT NOT NULL DEFAULT 'General',
  position      TEXT,
  vl_credits    INTEGER NOT NULL DEFAULT 10,
  sl_credits    INTEGER NOT NULL DEFAULT 10,
  company               TEXT,
  vl_remaining          INTEGER,
  sl_remaining          INTEGER,
  must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =============================================================================
-- USER ROLES
-- =============================================================================

CREATE TABLE public.user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role       public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);


-- =============================================================================
-- PAYROLL CUTOFFS
-- =============================================================================

CREATE TABLE public.payroll_cutoffs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cutoff_name  TEXT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  payout_date  DATE,
  status       public.cutoff_status NOT NULL DEFAULT 'open',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (start_date, end_date)
);

CREATE INDEX idx_cutoffs_dates ON public.payroll_cutoffs(start_date, end_date);


-- =============================================================================
-- DAILY TIME REPORTS
-- =============================================================================

CREATE TABLE public.daily_time_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date         DATE NOT NULL,
  time_in           TIME,
  time_out          TIME,
  hours_worked      NUMERIC(5,2) NOT NULL DEFAULT 0,
  late_minutes      INT NOT NULL DEFAULT 0,
  is_absent         BOOLEAN NOT NULL DEFAULT FALSE,
  is_leave          BOOLEAN NOT NULL DEFAULT FALSE,
  leave_type        TEXT,
  overtime_hours    NUMERIC(5,2) NOT NULL DEFAULT 0,
  notes             TEXT,
  cutoff_id         UUID REFERENCES public.payroll_cutoffs(id),
  approval_status   public.dtr_approval_status NOT NULL DEFAULT 'draft',
  locked_at         TIMESTAMPTZ,
  approved_by       UUID REFERENCES public.users(id),
  approved_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  correction_notes  TEXT,
  ot_status         TEXT NOT NULL DEFAULT 'none'
                      CHECK (ot_status IN ('none', 'pending', 'approved', 'rejected')),
  ot_approved_hours NUMERIC(4,2),
  ot_approved_by    UUID REFERENCES public.users(id),
  ot_approved_at    TIMESTAMPTZ,
  ot_review_notes   TEXT,
  shift_label       TEXT CHECK (shift_label IN ('7-4', '8-5', '9-6')),
  is_undertime      BOOLEAN NOT NULL DEFAULT FALSE,
  undertime_minutes INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

CREATE INDEX idx_dtr_employee_date ON public.daily_time_reports(employee_id, work_date);
CREATE INDEX idx_dtr_cutoff        ON public.daily_time_reports(cutoff_id);


-- =============================================================================
-- DTR CUTOFF SUBMISSIONS
-- =============================================================================

CREATE TABLE public.dtr_cutoff_submissions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  cutoff_id            UUID NOT NULL REFERENCES public.payroll_cutoffs(id) ON DELETE CASCADE,
  approval_status      public.dtr_approval_status NOT NULL DEFAULT 'draft',
  submitted_at         TIMESTAMPTZ,
  total_days_submitted INT NOT NULL DEFAULT 0,
  total_hours          NUMERIC(7,2) NOT NULL DEFAULT 0,
  missing_dtr_count    INT NOT NULL DEFAULT 0,
  late_count           INT NOT NULL DEFAULT 0,
  absent_count         INT NOT NULL DEFAULT 0,
  overtime_hours       NUMERIC(7,2) NOT NULL DEFAULT 0,
  leave_days           INT NOT NULL DEFAULT 0,
  approved_by          UUID REFERENCES public.users(id),
  approved_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  correction_notes     TEXT,
  locked_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, cutoff_id)
);

CREATE INDEX idx_subs_employee ON public.dtr_cutoff_submissions(employee_id);
CREATE INDEX idx_subs_cutoff   ON public.dtr_cutoff_submissions(cutoff_id);
CREATE INDEX idx_subs_status   ON public.dtr_cutoff_submissions(approval_status);


-- =============================================================================
-- DTR APPROVAL LOGS
-- =============================================================================

CREATE TABLE public.dtr_approval_logs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dtr_cutoff_submission_id UUID NOT NULL REFERENCES public.dtr_cutoff_submissions(id) ON DELETE CASCADE,
  action                   public.approval_action NOT NULL,
  action_by                UUID NOT NULL REFERENCES public.users(id),
  action_date              TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes                    TEXT
);

CREATE INDEX idx_logs_submission ON public.dtr_approval_logs(dtr_cutoff_submission_id);


-- =============================================================================
-- LEAVE REQUESTS
-- =============================================================================

CREATE TABLE public.leave_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  leave_type   TEXT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  reason       TEXT,
  status       public.leave_request_status NOT NULL DEFAULT 'pending',
  reviewed_by  UUID REFERENCES public.users(id),
  reviewed_at  TIMESTAMPTZ,
  review_notes TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX leave_requests_dates_idx    ON public.leave_requests(start_date, end_date);
CREATE INDEX leave_requests_employee_idx ON public.leave_requests(employee_id);


-- =============================================================================
-- ORG NODES
-- =============================================================================

CREATE TABLE public.org_nodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES public.org_nodes(id) ON DELETE SET NULL,
  team_label  TEXT,
  is_dept_head BOOLEAN NOT NULL DEFAULT FALSE,
  position_x  FLOAT NOT NULL DEFAULT 0,
  position_y  FLOAT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id)
);


-- =============================================================================
-- OT APPROVAL REQUESTS
-- =============================================================================

CREATE TABLE public.ot_approval_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dtr_id          UUID REFERENCES public.daily_time_reports(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_hours NUMERIC(4,2) NOT NULL,
  work_date       DATE NOT NULL,
  step            TEXT NOT NULL DEFAULT 'is' CHECK (step IN ('is', 'dh')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_approver_id  UUID REFERENCES public.profiles(id),
  dh_approver_id  UUID REFERENCES public.profiles(id),
  is_decided_at   TIMESTAMPTZ,
  dh_decided_at   TIMESTAMPTZ,
  is_notes        TEXT,
  dh_notes        TEXT,
  request_type    TEXT NOT NULL DEFAULT 'pre_approved'
                    CHECK (request_type IN ('pre_approved', 'actual')),
  pre_approved_id UUID REFERENCES public.ot_approval_requests(id) ON DELETE SET NULL,
  target_month    DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =============================================================================
-- FUNCTIONS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_hr_or_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('hr', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.find_cutoff_for_date(_d DATE)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.payroll_cutoffs
  WHERE _d BETWEEN start_date AND end_date
  ORDER BY start_date DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.recalc_cutoff_submission(_employee UUID, _cutoff UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start DATE; v_end DATE;
  v_days INT; v_hours NUMERIC; v_late INT; v_absent INT; v_ot NUMERIC; v_leave INT;
  v_workdays INT; v_submitted INT; v_missing INT;
BEGIN
  IF _cutoff IS NULL THEN RETURN; END IF;
  SELECT start_date, end_date INTO v_start, v_end
  FROM public.payroll_cutoffs WHERE id = _cutoff;
  IF v_start IS NULL THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_workdays
  FROM generate_series(v_start, v_end, INTERVAL '1 day') AS d
  WHERE EXTRACT(ISODOW FROM d) < 6;

  SELECT
    COUNT(*) FILTER (WHERE NOT is_absent AND NOT is_leave),
    COALESCE(SUM(hours_worked), 0),
    COUNT(*) FILTER (WHERE late_minutes > 0),
    COUNT(*) FILTER (WHERE is_absent),
    COALESCE(SUM(overtime_hours), 0),
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
  ON CONFLICT (employee_id, cutoff_id) DO UPDATE SET
    total_days_submitted = EXCLUDED.total_days_submitted,
    total_hours          = EXCLUDED.total_hours,
    late_count           = EXCLUDED.late_count,
    absent_count         = EXCLUDED.absent_count,
    overtime_hours       = EXCLUDED.overtime_hours,
    leave_days           = EXCLUDED.leave_days,
    missing_dtr_count    = EXCLUDED.missing_dtr_count,
    updated_at           = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- DTR before-write: auto-assign cutoff + mirror submission status.
-- Lock guard removed — enforced at application layer instead of auth.uid().
CREATE OR REPLACE FUNCTION public.dtr_before_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status public.dtr_approval_status;
BEGIN
  IF NEW.cutoff_id IS NULL THEN
    NEW.cutoff_id := public.find_cutoff_for_date(NEW.work_date);
  END IF;
  IF NEW.cutoff_id IS NOT NULL THEN
    SELECT approval_status INTO v_status
    FROM public.dtr_cutoff_submissions
    WHERE employee_id = NEW.employee_id AND cutoff_id = NEW.cutoff_id;
    IF v_status IS NOT NULL THEN NEW.approval_status := v_status; END IF;
  END IF;
  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.subs_after_update_lock_dtrs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.locked_at IS NOT NULL AND (OLD.locked_at IS NULL OR OLD.locked_at <> NEW.locked_at) THEN
    UPDATE public.daily_time_reports
    SET locked_at = NEW.locked_at, approval_status = NEW.approval_status,
        approved_by = NEW.approved_by, approved_at = NEW.approved_at
    WHERE employee_id = NEW.employee_id AND cutoff_id = NEW.cutoff_id;
  ELSIF NEW.locked_at IS NULL AND OLD.locked_at IS NOT NULL THEN
    UPDATE public.daily_time_reports
    SET locked_at = NULL, approval_status = NEW.approval_status
    WHERE employee_id = NEW.employee_id AND cutoff_id = NEW.cutoff_id;
  ELSIF NEW.approval_status <> OLD.approval_status THEN
    UPDATE public.daily_time_reports SET approval_status = NEW.approval_status
    WHERE employee_id = NEW.employee_id AND cutoff_id = NEW.cutoff_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_generate_employee_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE next_num INT;
BEGIN
  IF NEW.employee_code IS NULL OR NEW.employee_code = '' THEN
    SELECT COALESCE(
      MAX(CAST(REGEXP_REPLACE(employee_code, '[^0-9]', '', 'g') AS INT)), 0
    ) + 1 INTO next_num
    FROM public.profiles WHERE employee_code ~ '^EMP-[0-9]+$';
    NEW.employee_code := 'EMP-' || LPAD(next_num::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;


-- =============================================================================
-- TRIGGERS
-- =============================================================================

CREATE TRIGGER trg_profiles_touch
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_dtr_touch
  BEFORE UPDATE ON public.daily_time_reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_subs_touch
  BEFORE UPDATE ON public.dtr_cutoff_submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER leave_requests_touch
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_org_nodes_touch
  BEFORE UPDATE ON public.org_nodes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_dtr_before_write
  BEFORE INSERT OR UPDATE ON public.daily_time_reports
  FOR EACH ROW EXECUTE FUNCTION public.dtr_before_write();

CREATE TRIGGER trg_dtr_after_write
  AFTER INSERT OR UPDATE OR DELETE ON public.daily_time_reports
  FOR EACH ROW EXECUTE FUNCTION public.dtr_after_write();

CREATE TRIGGER trg_subs_status
  BEFORE UPDATE ON public.dtr_cutoff_submissions
  FOR EACH ROW EXECUTE FUNCTION public.subs_after_status_change();

CREATE TRIGGER trg_subs_after_update
  AFTER UPDATE ON public.dtr_cutoff_submissions
  FOR EACH ROW EXECUTE FUNCTION public.subs_after_update_lock_dtrs();

DROP TRIGGER IF EXISTS trigger_auto_employee_code ON public.profiles;
CREATE TRIGGER trigger_auto_employee_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_generate_employee_code();


-- =============================================================================
-- SEED PAYROLL CUTOFFS  (10th/25th cycle — previous, current, next 2 months)
-- =============================================================================

DO $$
DECLARE
  base DATE := date_trunc('month', CURRENT_DATE)::DATE;
  m DATE; s DATE; e DATE; p DATE; nm TEXT;
BEGIN
  FOR i IN -1..2 LOOP
    m := (base + (i || ' months')::INTERVAL)::DATE;
    s  := (m - INTERVAL '1 month' + INTERVAL '25 days')::DATE;
    e  := (m + INTERVAL '9 days')::DATE;
    p  := (m + INTERVAL '14 days')::DATE;
    nm := to_char(m, 'Mon YYYY') || ' — 1st Cut Off';
    INSERT INTO public.payroll_cutoffs (cutoff_name, start_date, end_date, payout_date)
    VALUES (nm, s, e, p) ON CONFLICT (start_date, end_date) DO NOTHING;

    s  := (m + INTERVAL '10 days')::DATE;
    e  := (m + INTERVAL '24 days')::DATE;
    p  := (m + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    nm := to_char(m, 'Mon YYYY') || ' — 2nd Cut Off';
    INSERT INTO public.payroll_cutoffs (cutoff_name, start_date, end_date, payout_date)
    VALUES (nm, s, e, p) ON CONFLICT (start_date, end_date) DO NOTHING;
  END LOOP;
END $$;
