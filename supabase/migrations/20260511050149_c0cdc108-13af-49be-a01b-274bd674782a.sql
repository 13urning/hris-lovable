
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_hr_or_admin(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.find_cutoff_for_date(DATE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalc_cutoff_submission(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dtr_before_write() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dtr_after_write() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.subs_after_status_change() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.subs_after_update_lock_dtrs() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_hr_or_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_cutoff_for_date(DATE) TO authenticated;

ALTER FUNCTION public.touch_updated_at() SET search_path = public;
