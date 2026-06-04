DROP POLICY IF EXISTS subs_self_update ON public.dtr_cutoff_submissions;

CREATE POLICY subs_self_update ON public.dtr_cutoff_submissions
FOR UPDATE
TO authenticated
USING (
  ((employee_id = auth.uid()) AND (approval_status = ANY (ARRAY['draft'::dtr_approval_status, 'rejected'::dtr_approval_status, 'needs_correction'::dtr_approval_status])))
  OR is_hr_or_admin(auth.uid())
)
WITH CHECK (
  ((employee_id = auth.uid()) AND (approval_status = ANY (ARRAY['draft'::dtr_approval_status, 'rejected'::dtr_approval_status, 'needs_correction'::dtr_approval_status, 'pending_approval'::dtr_approval_status])))
  OR is_hr_or_admin(auth.uid())
);