CREATE POLICY "profiles_team_read" ON public.profiles
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "profiles_self_read" ON public.profiles;