
-- Add payslip path column to submissions
ALTER TABLE public.dtr_cutoff_submissions
  ADD COLUMN IF NOT EXISTS payslip_path text,
  ADD COLUMN IF NOT EXISTS payslip_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS payslip_uploaded_by uuid;

-- Create private payslips bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('payslips', 'payslips', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: HR/admin can do everything in the payslips bucket
CREATE POLICY "payslips_hr_all"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'payslips' AND public.is_hr_or_admin(auth.uid()))
WITH CHECK (bucket_id = 'payslips' AND public.is_hr_or_admin(auth.uid()));

-- RLS: employees can read their own payslips (files stored under {employee_id}/...)
CREATE POLICY "payslips_self_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payslips'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
