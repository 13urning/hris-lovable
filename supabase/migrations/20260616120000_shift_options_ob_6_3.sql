-- Add two shift options: an early "6-3" (6:00 AM – 3:00 PM) schedule and "OB"
-- (Official Business Trip, for off-site work). Widens the shift_label CHECK that
-- previously only allowed 7-4 / 8-5 / 9-6.

ALTER TABLE public.daily_time_reports
  DROP CONSTRAINT IF EXISTS daily_time_reports_shift_label_check;

ALTER TABLE public.daily_time_reports
  ADD CONSTRAINT daily_time_reports_shift_label_check
  CHECK (shift_label IN ('6-3', '7-4', '8-5', '9-6', 'OB'));
