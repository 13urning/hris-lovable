-- Migration: attendance clock-in/out, OT approval flow, org chart, payslip removal

-- 1. Add attendance columns to daily_time_reports
ALTER TABLE daily_time_reports
  ADD COLUMN IF NOT EXISTS shift_label text CHECK (shift_label IN ('7-4', '8-5', '9-6')),
  ADD COLUMN IF NOT EXISTS is_undertime boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS undertime_minutes integer NOT NULL DEFAULT 0;

-- 2. Drop payslip columns from dtr_cutoff_submissions
ALTER TABLE dtr_cutoff_submissions
  DROP COLUMN IF EXISTS payslip_path,
  DROP COLUMN IF EXISTS payslip_uploaded_at,
  DROP COLUMN IF EXISTS payslip_uploaded_by;

-- 3. Create org_nodes table (adjacency list for org chart)
CREATE TABLE IF NOT EXISTS org_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES org_nodes(id) ON DELETE SET NULL,
  team_label text,
  is_dept_head boolean NOT NULL DEFAULT false,
  position_x float NOT NULL DEFAULT 0,
  position_y float NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id)
);

ALTER TABLE org_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_nodes_read_all" ON org_nodes FOR SELECT USING (true);

CREATE POLICY "org_nodes_insert_admin" ON org_nodes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'hr'))
);

CREATE POLICY "org_nodes_update_admin" ON org_nodes FOR UPDATE USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'hr'))
);

CREATE POLICY "org_nodes_delete_admin" ON org_nodes FOR DELETE USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'hr'))
);

-- 4. Create ot_approval_requests table (two-step: IS → DH)
CREATE TABLE IF NOT EXISTS ot_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dtr_id uuid NOT NULL REFERENCES daily_time_reports(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requested_hours numeric(4,2) NOT NULL,
  work_date date NOT NULL,
  step text NOT NULL DEFAULT 'is' CHECK (step IN ('is', 'dh')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_approver_id uuid REFERENCES profiles(id),
  dh_approver_id uuid REFERENCES profiles(id),
  is_decided_at timestamptz,
  dh_decided_at timestamptz,
  is_notes text,
  dh_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ot_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ot_requests_select" ON ot_approval_requests FOR SELECT USING (
  employee_id = auth.uid()
  OR is_approver_id = auth.uid()
  OR dh_approver_id = auth.uid()
  OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'hr'))
);

CREATE POLICY "ot_requests_insert_own" ON ot_approval_requests FOR INSERT WITH CHECK (
  employee_id = auth.uid()
);

CREATE POLICY "ot_requests_update_approver" ON ot_approval_requests FOR UPDATE USING (
  (step = 'is' AND is_approver_id = auth.uid())
  OR (step = 'dh' AND dh_approver_id = auth.uid())
  OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'hr'))
);
