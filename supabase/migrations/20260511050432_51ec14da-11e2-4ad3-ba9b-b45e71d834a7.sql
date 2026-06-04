
ALTER TABLE public.daily_time_reports
  ADD CONSTRAINT dtr_employee_profile_fk
  FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.dtr_cutoff_submissions
  ADD CONSTRAINT subs_employee_profile_fk
  FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
