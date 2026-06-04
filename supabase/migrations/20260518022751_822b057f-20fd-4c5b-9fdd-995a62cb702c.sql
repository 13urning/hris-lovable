
-- DTR triggers
DROP TRIGGER IF EXISTS dtr_before_write_trg ON public.daily_time_reports;
CREATE TRIGGER dtr_before_write_trg
  BEFORE INSERT OR UPDATE ON public.daily_time_reports
  FOR EACH ROW EXECUTE FUNCTION public.dtr_before_write();

DROP TRIGGER IF EXISTS dtr_after_write_trg ON public.daily_time_reports;
CREATE TRIGGER dtr_after_write_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.daily_time_reports
  FOR EACH ROW EXECUTE FUNCTION public.dtr_after_write();

DROP TRIGGER IF EXISTS dtr_touch_updated_at ON public.daily_time_reports;
CREATE TRIGGER dtr_touch_updated_at
  BEFORE UPDATE ON public.daily_time_reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Cutoff submissions triggers
DROP TRIGGER IF EXISTS subs_status_change_trg ON public.dtr_cutoff_submissions;
CREATE TRIGGER subs_status_change_trg
  BEFORE UPDATE ON public.dtr_cutoff_submissions
  FOR EACH ROW EXECUTE FUNCTION public.subs_after_status_change();

DROP TRIGGER IF EXISTS subs_lock_dtrs_trg ON public.dtr_cutoff_submissions;
CREATE TRIGGER subs_lock_dtrs_trg
  AFTER UPDATE ON public.dtr_cutoff_submissions
  FOR EACH ROW EXECUTE FUNCTION public.subs_after_update_lock_dtrs();

DROP TRIGGER IF EXISTS subs_touch_updated_at ON public.dtr_cutoff_submissions;
CREATE TRIGGER subs_touch_updated_at
  BEFORE UPDATE ON public.dtr_cutoff_submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Profiles + leaves timestamps
DROP TRIGGER IF EXISTS profiles_touch_updated_at ON public.profiles;
CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS leaves_touch_updated_at ON public.leave_requests;
CREATE TRIGGER leaves_touch_updated_at
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
