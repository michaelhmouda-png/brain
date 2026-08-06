-- First-customer provisioning and privacy-safe operational readiness telemetry.
-- Forward-only. Existing tenant and business records are never rewritten.
BEGIN;

CREATE TABLE public.first_customer_onboarding_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  canonical_payload jsonb NOT NULL,
  invited_users jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(invited_users)='array'),
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','completed')),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (requested_by_profile_id, idempotency_key)
);
ALTER TABLE public.first_customer_onboarding_requests OWNER TO postgres;
ALTER TABLE public.first_customer_onboarding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.first_customer_onboarding_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.first_customer_onboarding_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_first_customer_onboarding_v1(
  p_actor_profile_id uuid,
  p_idempotency_key uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_request public.first_customer_onboarding_requests%ROWTYPE;
  v_hash text;
  v_user jsonb;
  v_email text;
  v_emails text[] := ARRAY[]::text[];
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'ONBOARDING_SERVICE_ROLE_REQUIRED'; END IF;
  IF p_actor_profile_id IS NULL OR p_idempotency_key IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'ONBOARDING_INPUT_INVALID';
  END IF;
  SELECT * INTO v_actor FROM public.profiles
  WHERE id=p_actor_profile_id AND status='active' AND role='super_admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'ONBOARDING_FORBIDDEN'; END IF;

  IF char_length(btrim(COALESCE(p_payload->>'companyName',''))) NOT BETWEEN 2 AND 120
    OR char_length(btrim(COALESCE(p_payload->>'country',''))) NOT BETWEEN 2 AND 80
    OR COALESCE(p_payload->>'currency','') !~ '^[A-Z]{3}$'
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_payload->>'timezone')
    OR jsonb_typeof(p_payload->'location') <> 'object'
    OR char_length(btrim(COALESCE(p_payload#>>'{location,name}',''))) NOT BETWEEN 2 AND 120
    OR char_length(btrim(COALESCE(p_payload#>>'{location,type}',''))) NOT BETWEEN 2 AND 80
    OR char_length(btrim(COALESCE(p_payload#>>'{location,city}',''))) NOT BETWEEN 1 AND 120
    OR jsonb_typeof(p_payload->'users') <> 'array'
    OR jsonb_array_length(p_payload->'users') NOT BETWEEN 1 AND 25
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'users') u WHERE u->>'role'='owner') THEN
    RAISE EXCEPTION 'ONBOARDING_INPUT_INVALID';
  END IF;

  FOR v_user IN SELECT value FROM jsonb_array_elements(p_payload->'users') LOOP
    v_email := lower(btrim(COALESCE(v_user->>'email','')));
    IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR char_length(v_email) > 254
      OR char_length(btrim(COALESCE(v_user->>'firstName',''))) NOT BETWEEN 1 AND 80
      OR char_length(btrim(COALESCE(v_user->>'lastName',''))) NOT BETWEEN 1 AND 80
      OR char_length(btrim(COALESCE(v_user->>'jobTitle',''))) NOT BETWEEN 1 AND 120
      OR char_length(btrim(COALESCE(v_user->>'department',''))) NOT BETWEEN 1 AND 120
      OR COALESCE(v_user->>'role','') NOT IN ('owner','manager','employee')
      OR COALESCE(v_user->>'language','') NOT IN ('en','ar')
      OR v_email = ANY(v_emails) THEN
      RAISE EXCEPTION 'ONBOARDING_USER_INVALID';
    END IF;
    v_emails := array_append(v_emails,v_email);
  END LOOP;

  v_hash := encode(extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.first_customer_onboarding_requests(
    requested_by_profile_id,idempotency_key,payload_hash,canonical_payload
  ) VALUES (p_actor_profile_id,p_idempotency_key,v_hash,p_payload)
  ON CONFLICT (requested_by_profile_id,idempotency_key) DO NOTHING;

  SELECT * INTO v_request FROM public.first_customer_onboarding_requests
  WHERE requested_by_profile_id=p_actor_profile_id AND idempotency_key=p_idempotency_key;
  IF v_request.payload_hash <> v_hash THEN RAISE EXCEPTION 'ONBOARDING_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN jsonb_build_object('requestId',v_request.id,'status',v_request.status,'invitedUsers',v_request.invited_users);
END $$;
ALTER FUNCTION public.prepare_first_customer_onboarding_v1(uuid,uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prepare_first_customer_onboarding_v1(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_first_customer_onboarding_v1(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.record_first_customer_invitation_v1(
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_email text,
  p_auth_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_request public.first_customer_onboarding_requests%ROWTYPE;
  v_email text := lower(btrim(COALESCE(p_email,'')));
  v_existing jsonb;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'ONBOARDING_SERVICE_ROLE_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_actor_profile_id AND status='active' AND role='super_admin') THEN
    RAISE EXCEPTION 'ONBOARDING_FORBIDDEN';
  END IF;
  SELECT * INTO v_request FROM public.first_customer_onboarding_requests
  WHERE id=p_request_id AND requested_by_profile_id=p_actor_profile_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'prepared' THEN RAISE EXCEPTION 'ONBOARDING_REQUEST_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_request.canonical_payload->'users') u WHERE lower(btrim(u->>'email'))=v_email)
    OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p_auth_user_id AND lower(u.email)=v_email) THEN
    RAISE EXCEPTION 'ONBOARDING_AUTH_USER_INVALID';
  END IF;
  SELECT value INTO v_existing FROM jsonb_array_elements(v_request.invited_users)
  WHERE lower(btrim(value->>'email'))=v_email;
  IF v_existing IS NOT NULL AND v_existing->>'userId' <> p_auth_user_id::text THEN
    RAISE EXCEPTION 'ONBOARDING_INVITATION_CONFLICT';
  END IF;
  IF v_existing IS NULL THEN
    UPDATE public.first_customer_onboarding_requests
    SET invited_users=invited_users||jsonb_build_array(jsonb_build_object('email',v_email,'userId',p_auth_user_id)),
      updated_at=clock_timestamp()
    WHERE id=v_request.id
    RETURNING * INTO v_request;
  END IF;
  RETURN jsonb_build_object('requestId',v_request.id,'status',v_request.status,'invitedUsers',v_request.invited_users);
END $$;
ALTER FUNCTION public.record_first_customer_invitation_v1(uuid,uuid,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_first_customer_invitation_v1(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_first_customer_invitation_v1(uuid,uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_first_customer_onboarding_v1(
  p_actor_profile_id uuid,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_request public.first_customer_onboarding_requests%ROWTYPE;
  v_company_id uuid;
  v_location_id uuid;
  v_department_id uuid;
  v_employee_id uuid;
  v_user jsonb;
  v_binding jsonb;
  v_auth_user_id uuid;
  v_email text;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'ONBOARDING_SERVICE_ROLE_REQUIRED'; END IF;
  SELECT * INTO v_actor FROM public.profiles
  WHERE id=p_actor_profile_id AND status='active' AND role='super_admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'ONBOARDING_FORBIDDEN'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'ONBOARDING_INPUT_INVALID'; END IF;

  SELECT * INTO v_request FROM public.first_customer_onboarding_requests
  WHERE id=p_request_id AND requested_by_profile_id=p_actor_profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ONBOARDING_REQUEST_NOT_FOUND'; END IF;
  IF v_request.status='completed' THEN
    RETURN jsonb_build_object('requestId',v_request.id,'status','completed');
  END IF;
  IF jsonb_array_length(v_request.invited_users) <> jsonb_array_length(v_request.canonical_payload->'users') THEN
    RAISE EXCEPTION 'ONBOARDING_BINDINGS_INVALID';
  END IF;

  FOR v_user IN SELECT value FROM jsonb_array_elements(v_request.canonical_payload->'users') LOOP
    v_email := lower(btrim(v_user->>'email'));
    SELECT value INTO v_binding FROM jsonb_array_elements(v_request.invited_users)
    WHERE lower(btrim(value->>'email'))=v_email;
    IF v_binding IS NULL OR COALESCE(v_binding->>'userId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'ONBOARDING_BINDINGS_INVALID';
    END IF;
    v_auth_user_id := (v_binding->>'userId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=v_auth_user_id AND lower(u.email)=v_email)
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_auth_user_id) THEN
      RAISE EXCEPTION 'ONBOARDING_AUTH_USER_INVALID';
    END IF;
  END LOOP;

  INSERT INTO public.companies(name,industry,country,currency,timezone,locations)
  VALUES (
    btrim(v_request.canonical_payload->>'companyName'),
    COALESCE(NULLIF(btrim(v_request.canonical_payload->>'industry'),''),'hospitality'),
    btrim(v_request.canonical_payload->>'country'),
    v_request.canonical_payload->>'currency',
    v_request.canonical_payload->>'timezone',1
  ) RETURNING id INTO v_company_id;
  INSERT INTO public.locations(company_id,name,type,country,city,address,timezone,status)
  VALUES (
    v_company_id,btrim(v_request.canonical_payload#>>'{location,name}'),
    btrim(v_request.canonical_payload#>>'{location,type}'),btrim(v_request.canonical_payload->>'country'),
    btrim(v_request.canonical_payload#>>'{location,city}'),NULLIF(btrim(v_request.canonical_payload#>>'{location,address}'),''),
    v_request.canonical_payload->>'timezone','active'
  ) RETURNING id INTO v_location_id;

  FOR v_user IN SELECT value FROM jsonb_array_elements(v_request.canonical_payload->'users') LOOP
    v_email := lower(btrim(v_user->>'email'));
    SELECT value INTO v_binding FROM jsonb_array_elements(v_request.invited_users)
    WHERE lower(btrim(value->>'email'))=v_email;
    v_auth_user_id := (v_binding->>'userId')::uuid;
    SELECT id INTO v_department_id FROM public.departments
    WHERE company_id=v_company_id AND location_id=v_location_id AND lower(name)=lower(btrim(v_user->>'department'))
    ORDER BY created_at LIMIT 1;
    IF v_department_id IS NULL THEN
      INSERT INTO public.departments(company_id,location_id,name,status)
      VALUES (v_company_id,v_location_id,btrim(v_user->>'department'),'active') RETURNING id INTO v_department_id;
    END IF;
    INSERT INTO public.employees(
      company_id,location_id,first_name,last_name,role,department,department_id,email,hire_date,status
    ) VALUES (
      v_company_id,v_location_id,btrim(v_user->>'firstName'),btrim(v_user->>'lastName'),
      btrim(v_user->>'jobTitle'),btrim(v_user->>'department'),v_department_id,v_email,current_date,'active'
    ) RETURNING id INTO v_employee_id;
    INSERT INTO public.profiles(id,company_id,employee_id,full_name,role,status,preferred_language)
    VALUES (
      v_auth_user_id,v_company_id,v_employee_id,
      btrim(v_user->>'firstName')||' '||btrim(v_user->>'lastName'),v_user->>'role','active',v_user->>'language'
    );
  END LOOP;

  UPDATE public.first_customer_onboarding_requests
  SET status='completed',company_id=v_company_id,completed_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=v_request.id;
  RETURN jsonb_build_object('requestId',v_request.id,'status','completed');
END $$;
ALTER FUNCTION public.complete_first_customer_onboarding_v1(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_first_customer_onboarding_v1(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_first_customer_onboarding_v1(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_system_worker_health_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'workers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name', names.worker_name,'lastStartedAt', runs.last_started_at,'lastSucceededAt', runs.last_succeeded_at,
      'lastFailedAt', runs.last_failed_at,'lastFailureCode', runs.last_failure_code,
      'successCount', COALESCE(runs.success_count,0),'failureCount', COALESCE(runs.failure_count,0)
    ) ORDER BY names.worker_name)
    FROM unnest(ARRAY['notifications','recurring_tasks','weekly_shifts','evidence']) names(worker_name)
    LEFT JOIN public.system_worker_runs runs USING(worker_name)), '[]'::jsonb),
    'queues', jsonb_build_object(
      'notifications', jsonb_build_object(
        'pending',(SELECT count(*) FROM public.notification_outbox WHERE status='pending'),
        'retrying',(SELECT count(*) FROM public.notification_outbox WHERE status='pending' AND attempt_count>0),
        'deadLetter',(SELECT count(*) FROM public.notification_outbox WHERE status='failed'),
        'oldestPendingAt',(SELECT min(created_at) FROM public.notification_outbox WHERE status='pending')),
      'deliveries', jsonb_build_object(
        'pending',(SELECT count(*) FROM public.notification_delivery_jobs WHERE status='pending'),
        'retrying',(SELECT count(*) FROM public.notification_delivery_jobs WHERE status='pending' AND attempt_count>0),
        'deadLetter',(SELECT count(*) FROM public.notification_delivery_jobs WHERE status='failed'),
        'oldestPendingAt',(SELECT min(created_at) FROM public.notification_delivery_jobs WHERE status='pending')),
      'evidence', jsonb_build_object(
        'pending',(SELECT count(*) FROM public.task_evidence_verification_jobs WHERE status='queued'),
        'retrying',(SELECT count(*) FROM public.task_evidence_verification_jobs WHERE status='queued' AND attempt_count>0),
        'deadLetter',(SELECT count(*) FROM public.task_evidence_verification_jobs WHERE status='failed'),
        'oldestPendingAt',(SELECT min(created_at) FROM public.task_evidence_verification_jobs WHERE status='queued'))
    ),
    'materialization', jsonb_build_object(
      'recurringTasksLastCompletedAt',(SELECT max(completed_at) FROM public.recurring_task_occurrences WHERE completed_at IS NOT NULL),
      'recurringTasksNextDueAt',(SELECT min(next_occurrence_at) FROM public.recurring_task_rules WHERE status='active'),
      'weeklyShiftsLastGeneratedAt',(SELECT max(created_at) FROM public.weekly_shift_generated_shifts),
      'weeklyShiftsLatestLocalDate',(SELECT max(local_date) FROM public.weekly_shift_generated_shifts),
      'activeRecurringTaskRules',(SELECT count(*) FROM public.recurring_task_rules WHERE status='active'),
      'activeWeeklyShiftSeries',(SELECT count(*) FROM public.weekly_shift_schedule_series WHERE status='active')),
    'agents', jsonb_build_object(
      'configured',(SELECT count(*) FROM public.device_gateways WHERE status <> 'disabled'),
      'online',(SELECT count(*) FROM public.device_gateways WHERE status='online' AND last_seen_at >= clock_timestamp()-interval '10 minutes'),
      'offline',(SELECT count(*) FROM public.device_gateways WHERE status IN ('online','offline','error')
        AND (last_seen_at IS NULL OR last_seen_at < clock_timestamp()-interval '10 minutes'))),
    'recurring', jsonb_build_object(
      'failedLast24Hours',(SELECT count(*) FROM public.recurring_task_occurrences
        WHERE outcome='failed' AND completed_at >= clock_timestamp()-interval '24 hours')),
    'observedAt', clock_timestamp()
  )
$$;
ALTER FUNCTION public.get_system_worker_health_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_system_worker_health_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_worker_health_v1() TO service_role;

COMMIT;
