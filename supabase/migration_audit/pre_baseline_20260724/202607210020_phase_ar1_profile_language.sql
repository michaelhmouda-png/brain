-- Phase AR1: server-authoritative per-profile language preference.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN preferred_language text NOT NULL DEFAULT 'en';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_language_check
  CHECK (preferred_language IN ('en', 'ar'));

DO $khaled$
DECLARE
  v_profile_id uuid;
  v_matches integer;
BEGIN
  SELECT count(*), (array_agg(p.id))[1]
  INTO v_matches, v_profile_id
  FROM public.profiles AS p
  JOIN public.employees AS e
    ON e.id = p.employee_id
   AND e.company_id = p.company_id
  WHERE lower(btrim(e.first_name)) = 'khaled'
    AND lower(btrim(e.last_name)) = 'ismaeil'
    AND p.status = 'active';

  IF v_matches <> 1 OR v_profile_id IS NULL THEN
    RAISE EXCEPTION 'AR1_KHALED_PROFILE_LINK_NOT_UNIQUE: expected 1 active same-tenant linked profile, found %', v_matches;
  END IF;

  UPDATE public.profiles AS p
  SET preferred_language = 'ar', updated_at = clock_timestamp()
  WHERE p.id = v_profile_id;
END
$khaled$;

CREATE OR REPLACE FUNCTION public.update_my_preferred_language(p_language text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_language text := lower(btrim(p_language));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF v_language NOT IN ('en', 'ar') THEN
    RAISE EXCEPTION 'INVALID_LANGUAGE' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles AS p
  SET preferred_language = v_language, updated_at = clock_timestamp()
  WHERE p.id = auth.uid() AND p.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_PROVISIONED' USING ERRCODE = '42501';
  END IF;
  RETURN v_language;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_preferred_language(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_preferred_language(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_my_assigned_task(p_task_id uuid)
RETURNS TABLE(task_id uuid, task_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile FROM public.profiles AS p
  WHERE p.id=auth.uid() AND p.status='active' FOR UPDATE;
  IF NOT FOUND OR v_profile.role<>'employee' OR v_profile.employee_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_ACCESS_REQUIRED' USING ERRCODE='42501';
  END IF;
  UPDATE public.tasks AS t SET status='completed',updated_at=clock_timestamp()
  WHERE t.id=p_task_id AND t.company_id=v_profile.company_id
    AND t.assigned_employee_id=v_profile.employee_id
    AND t.status IN ('pending','in_progress');
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_COMPLETABLE' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p_task_id,'completed'::text;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_my_assigned_task(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_my_assigned_task(uuid) TO authenticated;

COMMENT ON COLUMN public.profiles.preferred_language IS
  'Server-authoritative per-user UI/Brain language. Supported values: en, ar.';
COMMENT ON FUNCTION public.update_my_preferred_language(text) IS
  'Updates only auth.uid() active profile language after canonical validation.';
COMMENT ON FUNCTION public.complete_my_assigned_task(uuid) IS
  'Allows an active canonical employee to complete only a task assigned to their linked same-tenant employee UUID.';

COMMIT;
