
-- Leave requests visible to all employees
CREATE TYPE public.leave_request_status AS ENUM ('pending','approved','rejected','cancelled');

CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  leave_type text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  status public.leave_request_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX leave_requests_dates_idx ON public.leave_requests (start_date, end_date);
CREATE INDEX leave_requests_employee_idx ON public.leave_requests (employee_id);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- All authenticated users can see every leave request (team visibility)
CREATE POLICY leaves_read_all ON public.leave_requests
  FOR SELECT TO authenticated USING (true);

-- Employees can file their own leaves
CREATE POLICY leaves_self_insert ON public.leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid() OR public.is_hr_or_admin(auth.uid()));

-- Employees can update their own while pending; HR/admin can update any
CREATE POLICY leaves_update ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (
    (employee_id = auth.uid() AND status = 'pending')
    OR public.is_hr_or_admin(auth.uid())
  );

-- Employees can cancel/delete their own pending requests; HR/admin can delete any
CREATE POLICY leaves_delete ON public.leave_requests
  FOR DELETE TO authenticated
  USING (
    (employee_id = auth.uid() AND status = 'pending')
    OR public.is_hr_or_admin(auth.uid())
  );

CREATE TRIGGER leave_requests_touch
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
