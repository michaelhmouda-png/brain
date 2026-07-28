-- Reservation Rebook v1: immutable source linkage and atomic, idempotent replacement creation.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.reservations') IS NULL
     OR to_regclass('public.reservation_status_history') IS NULL
     OR to_regprocedure('private.validate_reservation_context()') IS NULL THEN
    RAISE EXCEPTION 'RESERVATION_OS_FOUNDATION_REQUIRED';
  END IF;
  IF to_regprocedure(
    'public.rebook_reservation(uuid,uuid,uuid,uuid,uuid,integer,date,time without time zone,timestamp with time zone,timestamp with time zone,text,text,text,text,text,uuid)'
  ) IS NOT NULL
     OR to_regclass('public.reservation_rebook_audit') IS NOT NULL THEN
    RAISE EXCEPTION 'RESERVATION_REBOOK_ALREADY_EXISTS';
  END IF;
END
$preflight$;

ALTER TABLE public.reservations
  ADD COLUMN rebooked_from_reservation_id uuid,
  ADD COLUMN rebook_idempotency_key uuid,
  ADD CONSTRAINT reservations_rebook_source_fkey
    FOREIGN KEY (rebooked_from_reservation_id)
    REFERENCES public.reservations(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT reservations_rebook_pair_check CHECK (
    (rebooked_from_reservation_id IS NULL) = (rebook_idempotency_key IS NULL)
  ),
  ADD CONSTRAINT reservations_rebook_not_self_check CHECK (
    rebooked_from_reservation_id IS NULL OR rebooked_from_reservation_id <> id
  );

CREATE UNIQUE INDEX reservations_rebook_source_uidx
  ON public.reservations(rebooked_from_reservation_id)
  WHERE rebooked_from_reservation_id IS NOT NULL;

CREATE UNIQUE INDEX reservations_rebook_idempotency_uidx
  ON public.reservations(company_id, rebook_idempotency_key)
  WHERE rebook_idempotency_key IS NOT NULL;

CREATE INDEX reservations_rebook_trace_idx
  ON public.reservations(company_id, rebooked_from_reservation_id, id)
  WHERE rebooked_from_reservation_id IS NOT NULL;

CREATE TABLE public.reservation_rebook_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  original_reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  replacement_reservation_id uuid REFERENCES public.reservations(id) ON DELETE RESTRICT,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  event_type text NOT NULL,
  outcome_code text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT reservation_rebook_audit_event_check CHECK (
    event_type IN ('rebook.started','rebook.completed','rebook.replayed','rebook.failed')
  ),
  CONSTRAINT reservation_rebook_audit_outcome_check CHECK (
    outcome_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  CONSTRAINT reservation_rebook_audit_replacement_check CHECK (
    (event_type IN ('rebook.completed','rebook.replayed') AND replacement_reservation_id IS NOT NULL)
    OR (event_type IN ('rebook.started','rebook.failed') AND replacement_reservation_id IS NULL)
  )
);

ALTER TABLE public.reservation_rebook_audit OWNER TO postgres;

CREATE UNIQUE INDEX reservation_rebook_audit_once_uidx
  ON public.reservation_rebook_audit(company_id, idempotency_key, event_type);

CREATE INDEX reservation_rebook_audit_original_idx
  ON public.reservation_rebook_audit(company_id, original_reservation_id, created_at, id);

CREATE FUNCTION private.validate_reservation_rebook_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_original public.reservations%ROWTYPE;
  v_replacement public.reservations%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'reservations' THEN
    IF TG_OP = 'UPDATE'
       AND (
         NEW.rebooked_from_reservation_id IS DISTINCT FROM OLD.rebooked_from_reservation_id
         OR NEW.rebook_idempotency_key IS DISTINCT FROM OLD.rebook_idempotency_key
       ) THEN
      RAISE EXCEPTION 'RESERVATION_REBOOK_LINK_IMMUTABLE';
    END IF;
    IF NEW.rebooked_from_reservation_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT *
    INTO v_original
    FROM public.reservations r
    WHERE r.id = NEW.rebooked_from_reservation_id;
    IF NOT FOUND
       OR v_original.company_id IS DISTINCT FROM NEW.company_id
       OR v_original.status NOT IN ('cancelled','no_show') THEN
      RAISE EXCEPTION 'RESERVATION_REBOOK_SOURCE_INVALID';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME <> 'reservation_rebook_audit' THEN
    RAISE EXCEPTION 'RESERVATION_REBOOK_TRIGGER_TABLE_INVALID';
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'RESERVATION_REBOOK_AUDIT_APPEND_ONLY';
  END IF;
  SELECT *
  INTO v_original
  FROM public.reservations r
  WHERE r.id = NEW.original_reservation_id;
  IF NOT FOUND OR v_original.company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'RESERVATION_REBOOK_AUDIT_CONTEXT_INVALID';
  END IF;
  IF NEW.replacement_reservation_id IS NOT NULL THEN
    SELECT *
    INTO v_replacement
    FROM public.reservations r
    WHERE r.id = NEW.replacement_reservation_id;
    IF NOT FOUND
       OR v_replacement.company_id IS DISTINCT FROM NEW.company_id
       OR v_replacement.rebooked_from_reservation_id IS DISTINCT FROM NEW.original_reservation_id
       OR v_replacement.rebook_idempotency_key IS DISTINCT FROM NEW.idempotency_key THEN
      RAISE EXCEPTION 'RESERVATION_REBOOK_AUDIT_CONTEXT_INVALID';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = NEW.actor_profile_id
      AND p.company_id = NEW.company_id
      AND p.status = 'active'
      AND p.role IN ('manager','owner','super_admin')
  ) THEN
    RAISE EXCEPTION 'RESERVATION_REBOOK_AUDIT_ACTOR_INVALID';
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION private.validate_reservation_rebook_context() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.validate_reservation_rebook_context()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER reservations_rebook_validate
  BEFORE INSERT OR UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION private.validate_reservation_rebook_context();

CREATE TRIGGER reservation_rebook_audit_validate
  BEFORE INSERT OR UPDATE OR DELETE ON public.reservation_rebook_audit
  FOR EACH ROW EXECUTE FUNCTION private.validate_reservation_rebook_context();

ALTER TABLE public.reservation_rebook_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_rebook_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_rebook_audit
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.rebook_reservation(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_original_reservation_id uuid,
  p_idempotency_key uuid,
  p_location_id uuid,
  p_guest_count integer,
  p_reservation_date date,
  p_reservation_time time,
  p_starts_at timestamptz,
  p_expected_end_at timestamptz,
  p_purpose text,
  p_purpose_details text,
  p_notes text,
  p_seating_preference text,
  p_booking_source text,
  p_correlation_id uuid
) RETURNS TABLE(
  reservation_id uuid,
  guest_id uuid,
  status text,
  replayed boolean,
  outcome_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_original public.reservations%ROWTYPE;
  v_existing public.reservations%ROWTYPE;
  v_replacement public.reservations%ROWTYPE;
  v_timezone text;
  v_purpose_details text := NULLIF(btrim(p_purpose_details), '');
  v_notes text := NULLIF(btrim(p_notes), '');
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_actor_profile_id
      AND p.company_id = p_company_id
      AND p.status = 'active'
      AND p.role IN ('manager','owner','super_admin')
  ) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::text, false, 'RESERVATION_FORBIDDEN'::text;
    RETURN;
  END IF;
  IF p_correlation_id IS NULL OR p_idempotency_key IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::text, false, 'RESERVATION_REBOOK_IDEMPOTENCY_REQUIRED'::text;
    RETURN;
  END IF;

  SELECT *
  INTO v_original
  FROM public.reservations r
  WHERE r.id = p_original_reservation_id
    AND r.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::text, false, 'RESERVATION_NOT_FOUND'::text;
    RETURN;
  END IF;

  IF v_original.status NOT IN ('cancelled','no_show') THEN
    INSERT INTO public.reservation_rebook_audit(
      company_id, original_reservation_id, actor_profile_id, idempotency_key,
      event_type, outcome_code, correlation_id
    ) VALUES (
      p_company_id, v_original.id, p_actor_profile_id, p_idempotency_key,
      'rebook.failed', 'RESERVATION_REBOOK_SOURCE_INVALID', p_correlation_id
    ) ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT NULL::uuid, v_original.guest_id, NULL::text, false, 'RESERVATION_REBOOK_SOURCE_INVALID'::text;
    RETURN;
  END IF;

  SELECT *
  INTO v_existing
  FROM public.reservations r
  WHERE r.company_id = p_company_id
    AND r.rebook_idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.rebooked_from_reservation_id IS DISTINCT FROM v_original.id
       OR v_existing.location_id IS DISTINCT FROM p_location_id
       OR v_existing.guest_id IS DISTINCT FROM v_original.guest_id
       OR v_existing.guest_count IS DISTINCT FROM p_guest_count
       OR v_existing.reservation_date IS DISTINCT FROM p_reservation_date
       OR v_existing.reservation_time IS DISTINCT FROM p_reservation_time
       OR v_existing.starts_at IS DISTINCT FROM p_starts_at
       OR v_existing.expected_end_at IS DISTINCT FROM p_expected_end_at
       OR v_existing.purpose IS DISTINCT FROM p_purpose
       OR v_existing.purpose_details IS DISTINCT FROM v_purpose_details
       OR v_existing.notes IS DISTINCT FROM v_notes
       OR v_existing.seating_preference IS DISTINCT FROM p_seating_preference
       OR v_existing.source IS DISTINCT FROM p_booking_source THEN
      INSERT INTO public.reservation_rebook_audit(
        company_id, original_reservation_id, actor_profile_id, idempotency_key,
        event_type, outcome_code, correlation_id
      ) VALUES (
        p_company_id, v_original.id, p_actor_profile_id, p_idempotency_key,
        'rebook.failed', 'RESERVATION_REBOOK_IDEMPOTENCY_CONFLICT', p_correlation_id
      ) ON CONFLICT DO NOTHING;
      RETURN QUERY SELECT NULL::uuid, v_original.guest_id, NULL::text, false, 'RESERVATION_REBOOK_IDEMPOTENCY_CONFLICT'::text;
      RETURN;
    END IF;
    INSERT INTO public.reservation_rebook_audit(
      company_id, original_reservation_id, replacement_reservation_id, actor_profile_id,
      idempotency_key, event_type, outcome_code, correlation_id
    ) VALUES (
      p_company_id, v_original.id, v_existing.id, p_actor_profile_id,
      p_idempotency_key, 'rebook.replayed', 'RESERVATION_REBOOK_REPLAYED', p_correlation_id
    ) ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT v_existing.id, v_existing.guest_id, v_existing.status, true, 'RESERVATION_REBOOK_REPLAYED'::text;
    RETURN;
  END IF;

  SELECT *
  INTO v_existing
  FROM public.reservations r
  WHERE r.rebooked_from_reservation_id = v_original.id;
  IF FOUND THEN
    INSERT INTO public.reservation_rebook_audit(
      company_id, original_reservation_id, actor_profile_id, idempotency_key,
      event_type, outcome_code, correlation_id
    ) VALUES (
      p_company_id, v_original.id, p_actor_profile_id, p_idempotency_key,
      'rebook.failed', 'RESERVATION_ALREADY_REBOOKED', p_correlation_id
    ) ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT NULL::uuid, v_original.guest_id, NULL::text, false, 'RESERVATION_ALREADY_REBOOKED'::text;
    RETURN;
  END IF;

  SELECT l.timezone
  INTO v_timezone
    FROM public.locations l
    WHERE l.id = p_location_id
      AND l.company_id = p_company_id
      AND l.status = 'active'
  ;
  IF NOT FOUND OR v_timezone IS NULL THEN
    INSERT INTO public.reservation_rebook_audit(
      company_id, original_reservation_id, actor_profile_id, idempotency_key,
      event_type, outcome_code, correlation_id
    ) VALUES (
      p_company_id, v_original.id, p_actor_profile_id, p_idempotency_key,
      'rebook.failed', 'RESERVATION_LOCATION_INVALID', p_correlation_id
    ) ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT NULL::uuid, v_original.guest_id, NULL::text, false, 'RESERVATION_LOCATION_INVALID'::text;
    RETURN;
  END IF;

  IF p_guest_count IS NULL
     OR p_reservation_date IS NULL
     OR p_reservation_time IS NULL
     OR p_starts_at IS NULL
     OR p_purpose IS NULL
     OR p_seating_preference IS NULL
     OR p_booking_source IS NULL
     OR p_guest_count NOT BETWEEN 1 AND 100
     OR p_expected_end_at IS NULL
     OR p_expected_end_at <= p_starts_at
     OR p_starts_at <= clock_timestamp()
     OR (p_starts_at AT TIME ZONE v_timezone)::date IS DISTINCT FROM p_reservation_date
     OR date_trunc('minute', p_starts_at AT TIME ZONE v_timezone)::time IS DISTINCT FROM p_reservation_time
     OR p_purpose NOT IN ('regular','birthday','anniversary','business','engagement','bachelor','bachelorette','family','event','other')
     OR v_purpose_details IS NOT NULL AND char_length(v_purpose_details) > 500
     OR v_notes IS NOT NULL AND char_length(v_notes) > 2000
     OR p_seating_preference NOT IN ('no_preference','indoor','outdoor','bar','vip')
     OR p_booking_source NOT IN ('manual','phone','whatsapp','instagram','website','google','walk_in','ai_concierge','other') THEN
    INSERT INTO public.reservation_rebook_audit(
      company_id, original_reservation_id, actor_profile_id, idempotency_key,
      event_type, outcome_code, correlation_id
    ) VALUES (
      p_company_id, v_original.id, p_actor_profile_id, p_idempotency_key,
      'rebook.failed', 'RESERVATION_REBOOK_INPUT_INVALID', p_correlation_id
    ) ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT NULL::uuid, v_original.guest_id, NULL::text, false, 'RESERVATION_REBOOK_INPUT_INVALID'::text;
    RETURN;
  END IF;

  INSERT INTO public.reservation_rebook_audit(
    company_id, original_reservation_id, actor_profile_id, idempotency_key,
    event_type, outcome_code, correlation_id
  ) VALUES (
    p_company_id, v_original.id, p_actor_profile_id, p_idempotency_key,
    'rebook.started', 'RESERVATION_REBOOK_STARTED', p_correlation_id
  ) ON CONFLICT DO NOTHING;

  INSERT INTO public.reservations(
    company_id, location_id, guest_id, reservation_date, reservation_time,
    starts_at, expected_end_at, guest_count, purpose, purpose_details, notes,
    seating_preference, status, source, created_by,
    rebooked_from_reservation_id, rebook_idempotency_key
  ) VALUES (
    p_company_id, p_location_id, v_original.guest_id, p_reservation_date, p_reservation_time,
    p_starts_at, p_expected_end_at, p_guest_count, p_purpose, v_purpose_details, v_notes,
    p_seating_preference, 'pending', p_booking_source, p_actor_profile_id,
    v_original.id, p_idempotency_key
  )
  RETURNING * INTO v_replacement;

  INSERT INTO public.reservation_status_history(
    company_id, location_id, reservation_id, previous_status, new_status,
    changed_by, reason, correlation_id
  ) VALUES (
    p_company_id, p_location_id, v_replacement.id, NULL, 'pending',
    p_actor_profile_id, 'rebook', p_correlation_id
  );

  INSERT INTO public.reservation_rebook_audit(
    company_id, original_reservation_id, replacement_reservation_id, actor_profile_id,
    idempotency_key, event_type, outcome_code, correlation_id
  ) VALUES (
    p_company_id, v_original.id, v_replacement.id, p_actor_profile_id,
    p_idempotency_key, 'rebook.completed', 'RESERVATION_REBOOK_COMPLETED', p_correlation_id
  );

  RETURN QUERY SELECT v_replacement.id, v_replacement.guest_id, v_replacement.status, false, 'RESERVATION_REBOOK_COMPLETED'::text;
END
$function$;

ALTER FUNCTION public.rebook_reservation(
  uuid,uuid,uuid,uuid,uuid,integer,date,time,timestamptz,timestamptz,
  text,text,text,text,text,uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.rebook_reservation(
  uuid,uuid,uuid,uuid,uuid,integer,date,time,timestamptz,timestamptz,
  text,text,text,text,text,uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rebook_reservation(
  uuid,uuid,uuid,uuid,uuid,integer,date,time,timestamptz,timestamptz,
  text,text,text,text,text,uuid
) TO service_role;

COMMIT;
