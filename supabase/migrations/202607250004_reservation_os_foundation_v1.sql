-- Reservation OS Foundation v1: manual reservations, factual history, calendar, and telephony preparation.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.locations') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('private.can_view_camera_manager(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RESERVATION_OS_FOUNDATION_REQUIRED';
  END IF;
  IF to_regclass('public.reservation_guests') IS NOT NULL
     OR to_regclass('public.reservations') IS NOT NULL
     OR to_regclass('public.reservation_waitlist_entries') IS NOT NULL
     OR to_regclass('public.reservation_status_history') IS NOT NULL THEN
    RAISE EXCEPTION 'RESERVATION_OS_ALREADY_EXISTS';
  END IF;
END
$preflight$;

CREATE TABLE public.reservation_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  first_name text NOT NULL,
  last_name text NOT NULL,
  country_calling_code text NOT NULL,
  national_phone_number text NOT NULL,
  phone_e164 text NOT NULL,
  preferred_language text,
  notes text,
  marketing_consent boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT reservation_guests_first_name_check CHECK (first_name = btrim(first_name) AND char_length(first_name) BETWEEN 1 AND 80),
  CONSTRAINT reservation_guests_last_name_check CHECK (last_name = btrim(last_name) AND char_length(last_name) BETWEEN 1 AND 80),
  CONSTRAINT reservation_guests_calling_code_check CHECK (country_calling_code ~ '^\+[1-9][0-9]{0,3}$'),
  CONSTRAINT reservation_guests_national_phone_check CHECK (national_phone_number ~ '^[1-9][0-9]{3,13}$'),
  CONSTRAINT reservation_guests_e164_check CHECK (
    phone_e164 = country_calling_code || national_phone_number
    AND phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CONSTRAINT reservation_guests_language_check CHECK (preferred_language IS NULL OR preferred_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT reservation_guests_notes_check CHECK (notes IS NULL OR char_length(notes) <= 2000)
);
CREATE UNIQUE INDEX reservation_guests_company_phone_uidx ON public.reservation_guests(company_id, phone_e164);
CREATE INDEX reservation_guests_company_name_idx ON public.reservation_guests(company_id, lower(last_name), lower(first_name));

CREATE TABLE public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  guest_id uuid NOT NULL REFERENCES public.reservation_guests(id) ON DELETE RESTRICT,
  reservation_date date NOT NULL,
  reservation_time time NOT NULL,
  starts_at timestamptz NOT NULL,
  expected_end_at timestamptz,
  guest_count integer NOT NULL,
  purpose text NOT NULL,
  purpose_details text,
  notes text,
  seating_preference text NOT NULL DEFAULT 'no_preference',
  assigned_table_id uuid,
  status text NOT NULL,
  source text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  seated_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT reservations_guest_count_check CHECK (guest_count BETWEEN 1 AND 100),
  CONSTRAINT reservations_end_check CHECK (expected_end_at IS NULL OR expected_end_at > starts_at),
  CONSTRAINT reservations_purpose_check CHECK (purpose IN ('regular','birthday','anniversary','business','engagement','bachelor','bachelorette','family','event','other')),
  CONSTRAINT reservations_purpose_details_check CHECK (purpose_details IS NULL OR char_length(purpose_details) <= 500),
  CONSTRAINT reservations_notes_check CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT reservations_seating_check CHECK (seating_preference IN ('no_preference','indoor','outdoor','bar','vip')),
  CONSTRAINT reservations_status_check CHECK (status IN ('pending','confirmed','waitlisted','seated','completed','cancelled','no_show')),
  CONSTRAINT reservations_source_check CHECK (source IN ('manual','phone','whatsapp','instagram','website','google','walk_in','ai_concierge','other')),
  CONSTRAINT reservations_cancellation_reason_check CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) <= 500),
  CONSTRAINT reservations_terminal_timestamp_check CHECK (
    (status = 'confirmed') = (confirmed_at IS NOT NULL AND seated_at IS NULL AND completed_at IS NULL AND cancelled_at IS NULL)
    OR status = 'seated' AND confirmed_at IS NOT NULL AND seated_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL
    OR status = 'completed' AND confirmed_at IS NOT NULL AND seated_at IS NOT NULL AND completed_at IS NOT NULL AND cancelled_at IS NULL
    OR status = 'cancelled' AND cancelled_at IS NOT NULL AND seated_at IS NULL AND completed_at IS NULL
    OR status IN ('pending','waitlisted','no_show') AND seated_at IS NULL AND completed_at IS NULL AND cancelled_at IS NULL
  )
);
CREATE INDEX reservations_company_date_idx ON public.reservations(company_id, reservation_date, reservation_time, id);
CREATE INDEX reservations_location_starts_idx ON public.reservations(company_id, location_id, starts_at, id);
CREATE INDEX reservations_guest_history_idx ON public.reservations(company_id, guest_id, starts_at DESC, id DESC);
CREATE INDEX reservations_status_starts_idx ON public.reservations(company_id, status, starts_at);
CREATE INDEX reservations_source_date_idx ON public.reservations(company_id, source, reservation_date);

CREATE TABLE public.reservation_waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  guest_id uuid NOT NULL REFERENCES public.reservation_guests(id) ON DELETE RESTRICT,
  requested_date date NOT NULL,
  preferred_time time NOT NULL,
  earliest_time time,
  latest_time time,
  guest_count integer NOT NULL,
  purpose text NOT NULL,
  seating_preference text NOT NULL DEFAULT 'no_preference',
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  notes text,
  expires_at timestamptz,
  converted_reservation_id uuid REFERENCES public.reservations(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT reservation_waitlist_guest_count_check CHECK (guest_count BETWEEN 1 AND 100),
  CONSTRAINT reservation_waitlist_purpose_check CHECK (purpose IN ('regular','birthday','anniversary','business','engagement','bachelor','bachelorette','family','event','other')),
  CONSTRAINT reservation_waitlist_seating_check CHECK (seating_preference IN ('no_preference','indoor','outdoor','bar','vip')),
  CONSTRAINT reservation_waitlist_status_check CHECK (status IN ('waiting','contacted','offered','converted','expired','cancelled')),
  CONSTRAINT reservation_waitlist_priority_check CHECK (priority BETWEEN -100 AND 100),
  CONSTRAINT reservation_waitlist_window_check CHECK (
    (earliest_time IS NULL OR latest_time IS NULL OR earliest_time <= latest_time)
    AND (earliest_time IS NULL OR earliest_time <= preferred_time)
    AND (latest_time IS NULL OR preferred_time <= latest_time)
  ),
  CONSTRAINT reservation_waitlist_notes_check CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT reservation_waitlist_conversion_check CHECK (
    (status = 'converted') = (converted_reservation_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX reservation_waitlist_active_dedup_uidx
  ON public.reservation_waitlist_entries(company_id, location_id, guest_id, requested_date, preferred_time, seating_preference)
  WHERE status IN ('waiting','contacted','offered');
CREATE INDEX reservation_waitlist_location_date_idx ON public.reservation_waitlist_entries(company_id, location_id, requested_date, status, priority DESC);

CREATE TABLE public.reservation_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  previous_status text,
  new_status text NOT NULL,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text,
  correlation_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT reservation_history_previous_check CHECK (previous_status IS NULL OR previous_status IN ('pending','confirmed','waitlisted','seated','completed','cancelled','no_show')),
  CONSTRAINT reservation_history_new_check CHECK (new_status IN ('pending','confirmed','waitlisted','seated','completed','cancelled','no_show')),
  CONSTRAINT reservation_history_change_check CHECK (previous_status IS DISTINCT FROM new_status),
  CONSTRAINT reservation_history_reason_check CHECK (reason IS NULL OR char_length(reason) <= 500)
);
CREATE UNIQUE INDEX reservation_history_transition_uidx ON public.reservation_status_history(reservation_id, correlation_id, new_status);
CREATE INDEX reservation_history_company_changed_idx ON public.reservation_status_history(company_id, changed_at DESC, id DESC);

CREATE TABLE public.reservation_telephony_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  destination_phone_e164 text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT reservation_telephony_provider_check CHECK (provider ~ '^[a-z][a-z0-9_]{0,39}$'),
  CONSTRAINT reservation_telephony_phone_check CHECK (destination_phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
CREATE UNIQUE INDEX reservation_telephony_destination_uidx ON public.reservation_telephony_destinations(provider, destination_phone_e164) WHERE active;

CREATE TABLE public.reservation_incoming_call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_call_id text NOT NULL,
  caller_phone_e164 text NOT NULL,
  destination_phone_e164 text NOT NULL,
  guest_id uuid REFERENCES public.reservation_guests(id) ON DELETE SET NULL,
  assigned_operator_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ringing',
  started_at timestamptz NOT NULL,
  answered_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT reservation_calls_provider_check CHECK (provider ~ '^[a-z][a-z0-9_]{0,39}$'),
  CONSTRAINT reservation_calls_id_check CHECK (char_length(provider_call_id) BETWEEN 1 AND 160),
  CONSTRAINT reservation_calls_caller_check CHECK (caller_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT reservation_calls_destination_check CHECK (destination_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT reservation_calls_status_check CHECK (status IN ('ringing','answered','ended','dismissed')),
  CONSTRAINT reservation_calls_expiry_check CHECK (expires_at > started_at AND expires_at <= started_at + interval '15 minutes')
);
CREATE UNIQUE INDEX reservation_calls_provider_id_uidx ON public.reservation_incoming_call_sessions(provider, provider_call_id);
CREATE INDEX reservation_calls_active_idx ON public.reservation_incoming_call_sessions(company_id, location_id, expires_at) WHERE status IN ('ringing','answered');

ALTER TABLE public.reservation_guests OWNER TO postgres;
ALTER TABLE public.reservations OWNER TO postgres;
ALTER TABLE public.reservation_waitlist_entries OWNER TO postgres;
ALTER TABLE public.reservation_status_history OWNER TO postgres;
ALTER TABLE public.reservation_telephony_destinations OWNER TO postgres;
ALTER TABLE public.reservation_incoming_call_sessions OWNER TO postgres;

CREATE FUNCTION private.validate_reservation_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_timezone text;
  v_reservation public.reservations%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'reservation_status_history' AND TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'RESERVATION_HISTORY_APPEND_ONLY';
  END IF;
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME IN ('reservations','reservation_waitlist_entries','reservation_guests') THEN
    RAISE EXCEPTION 'RESERVATION_HISTORY_RETAINED';
  END IF;
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'reservation_telephony_destinations' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.locations l WHERE l.id = OLD.location_id AND l.company_id = OLD.company_id AND l.status = 'active'
    ) THEN RAISE EXCEPTION 'RESERVATION_LOCATION_INVALID'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'reservation_incoming_call_sessions' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.locations l WHERE l.id = OLD.location_id AND l.company_id = OLD.company_id AND l.status = 'active'
    ) THEN RAISE EXCEPTION 'RESERVATION_LOCATION_INVALID'; END IF;
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'reservation_guests' THEN
    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = NEW.created_by AND p.company_id = NEW.company_id AND p.status = 'active'
    ) THEN RAISE EXCEPTION 'RESERVATION_ACTOR_INVALID'; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME NOT IN (
    'reservations',
    'reservation_waitlist_entries',
    'reservation_status_history',
    'reservation_telephony_destinations',
    'reservation_incoming_call_sessions'
  ) THEN
    RAISE EXCEPTION 'RESERVATION_TRIGGER_TABLE_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.locations l WHERE l.id = NEW.location_id AND l.company_id = NEW.company_id AND l.status = 'active'
  ) THEN RAISE EXCEPTION 'RESERVATION_LOCATION_INVALID'; END IF;
  IF TG_TABLE_NAME = 'reservations' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.reservation_guests g WHERE g.id = NEW.guest_id AND g.company_id = NEW.company_id
    ) THEN RAISE EXCEPTION 'RESERVATION_GUEST_INVALID'; END IF;
    SELECT c.timezone INTO v_timezone FROM public.companies c WHERE c.id = NEW.company_id;
    IF v_timezone IS NULL
       OR (NEW.starts_at AT TIME ZONE v_timezone)::date IS DISTINCT FROM NEW.reservation_date
       OR date_trunc('minute', NEW.starts_at AT TIME ZONE v_timezone)::time IS DISTINCT FROM NEW.reservation_time THEN
      RAISE EXCEPTION 'RESERVATION_LOCAL_TIME_INVALID';
    END IF;
  ELSIF TG_TABLE_NAME = 'reservation_waitlist_entries' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.reservation_guests g WHERE g.id = NEW.guest_id AND g.company_id = NEW.company_id
    ) THEN RAISE EXCEPTION 'RESERVATION_GUEST_INVALID'; END IF;
    IF NEW.converted_reservation_id IS NOT NULL THEN
      SELECT * INTO v_reservation FROM public.reservations r WHERE r.id = NEW.converted_reservation_id;
      IF NOT FOUND OR v_reservation.company_id <> NEW.company_id OR v_reservation.location_id <> NEW.location_id
         OR v_reservation.guest_id <> NEW.guest_id THEN RAISE EXCEPTION 'RESERVATION_WAITLIST_CONVERSION_INVALID'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'reservation_status_history' THEN
    SELECT * INTO v_reservation FROM public.reservations r WHERE r.id = NEW.reservation_id;
    IF NOT FOUND OR v_reservation.company_id <> NEW.company_id OR v_reservation.location_id <> NEW.location_id
       OR v_reservation.status <> NEW.new_status THEN RAISE EXCEPTION 'RESERVATION_HISTORY_CONTEXT_INVALID'; END IF;
  ELSIF TG_TABLE_NAME = 'reservation_incoming_call_sessions' THEN
    IF NEW.guest_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.reservation_guests g WHERE g.id = NEW.guest_id AND g.company_id = NEW.company_id
    ) THEN RAISE EXCEPTION 'RESERVATION_GUEST_INVALID'; END IF;
    IF NEW.assigned_operator_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.assigned_operator_id AND p.company_id = NEW.company_id AND p.status = 'active'
    ) THEN RAISE EXCEPTION 'RESERVATION_ACTOR_INVALID'; END IF;
  ELSIF TG_TABLE_NAME = 'reservation_telephony_destinations' THEN
    NULL;
  END IF;
  RETURN NEW;
END
$function$;
ALTER FUNCTION private.validate_reservation_context() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.validate_reservation_context() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER reservation_guests_validate BEFORE INSERT OR UPDATE OR DELETE ON public.reservation_guests FOR EACH ROW EXECUTE FUNCTION private.validate_reservation_context();
CREATE TRIGGER reservations_validate BEFORE INSERT OR UPDATE OR DELETE ON public.reservations FOR EACH ROW EXECUTE FUNCTION private.validate_reservation_context();
CREATE TRIGGER reservation_waitlist_validate BEFORE INSERT OR UPDATE OR DELETE ON public.reservation_waitlist_entries FOR EACH ROW EXECUTE FUNCTION private.validate_reservation_context();
CREATE TRIGGER reservation_history_validate BEFORE INSERT OR UPDATE OR DELETE ON public.reservation_status_history FOR EACH ROW EXECUTE FUNCTION private.validate_reservation_context();
CREATE TRIGGER reservation_telephony_destinations_validate BEFORE INSERT OR UPDATE OR DELETE ON public.reservation_telephony_destinations FOR EACH ROW EXECUTE FUNCTION private.validate_reservation_context();
CREATE TRIGGER reservation_calls_validate BEFORE INSERT OR UPDATE OR DELETE ON public.reservation_incoming_call_sessions FOR EACH ROW EXECUTE FUNCTION private.validate_reservation_context();

CREATE FUNCTION public.create_manual_reservation(
  p_actor_profile_id uuid, p_company_id uuid, p_location_id uuid,
  p_first_name text, p_last_name text, p_country_calling_code text,
  p_national_phone_number text, p_phone_e164 text, p_guest_count integer,
  p_purpose text, p_purpose_details text, p_reservation_date date,
  p_reservation_time time, p_starts_at timestamptz, p_expected_end_at timestamptz,
  p_notes text, p_seating_preference text, p_source text, p_waitlist boolean,
  p_earliest_time time, p_latest_time time, p_correlation_id uuid
) RETURNS TABLE(entity_id uuid, guest_id uuid, entity_type text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_guest public.reservation_guests%ROWTYPE;v_reservation public.reservations%ROWTYPE;v_waitlist public.reservation_waitlist_entries%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_actor_profile_id AND p.company_id=p_company_id AND p.status='active' AND p.role IN ('manager','owner','super_admin'))
  THEN RAISE EXCEPTION 'RESERVATION_FORBIDDEN'; END IF;
  IF p_correlation_id IS NULL THEN RAISE EXCEPTION 'RESERVATION_CORRELATION_REQUIRED'; END IF;
  INSERT INTO public.reservation_guests(company_id,first_name,last_name,country_calling_code,national_phone_number,phone_e164,created_by)
  VALUES(p_company_id,btrim(p_first_name),btrim(p_last_name),p_country_calling_code,p_national_phone_number,p_phone_e164,p_actor_profile_id)
  ON CONFLICT(company_id,phone_e164) DO UPDATE SET first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,updated_at=clock_timestamp()
  RETURNING * INTO v_guest;
  IF p_waitlist THEN
    INSERT INTO public.reservation_waitlist_entries(company_id,location_id,guest_id,requested_date,preferred_time,earliest_time,latest_time,guest_count,purpose,seating_preference,status,notes,created_by)
    VALUES(p_company_id,p_location_id,v_guest.id,p_reservation_date,p_reservation_time,p_earliest_time,p_latest_time,p_guest_count,p_purpose,p_seating_preference,'waiting',p_notes,p_actor_profile_id)
    RETURNING * INTO v_waitlist;
    RETURN QUERY SELECT v_waitlist.id,v_guest.id,'waitlist'::text,v_waitlist.status;
  ELSE
    INSERT INTO public.reservations(company_id,location_id,guest_id,reservation_date,reservation_time,starts_at,expected_end_at,guest_count,purpose,purpose_details,notes,seating_preference,status,source,created_by)
    VALUES(p_company_id,p_location_id,v_guest.id,p_reservation_date,p_reservation_time,p_starts_at,p_expected_end_at,p_guest_count,p_purpose,p_purpose_details,p_notes,p_seating_preference,'pending',p_source,p_actor_profile_id)
    RETURNING * INTO v_reservation;
    INSERT INTO public.reservation_status_history(company_id,location_id,reservation_id,previous_status,new_status,changed_by,correlation_id)
    VALUES(p_company_id,p_location_id,v_reservation.id,NULL,'pending',p_actor_profile_id,p_correlation_id);
    RETURN QUERY SELECT v_reservation.id,v_guest.id,'reservation'::text,v_reservation.status;
  END IF;
END
$function$;

CREATE FUNCTION public.transition_reservation_status(
  p_actor_profile_id uuid,p_company_id uuid,p_reservation_id uuid,p_new_status text,p_reason text,p_correlation_id uuid
) RETURNS TABLE(reservation_id uuid,status text,changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_reservation public.reservations%ROWTYPE;v_previous text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_actor_profile_id AND p.company_id=p_company_id AND p.status='active' AND p.role IN ('manager','owner','super_admin'))
  THEN RAISE EXCEPTION 'RESERVATION_FORBIDDEN'; END IF;
  SELECT * INTO v_reservation FROM public.reservations r WHERE r.id=p_reservation_id AND r.company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF v_reservation.status=p_new_status THEN RETURN QUERY SELECT v_reservation.id,v_reservation.status,false;RETURN; END IF;
  IF NOT (
    (v_reservation.status='pending' AND p_new_status IN ('confirmed','waitlisted','cancelled'))
    OR (v_reservation.status='confirmed' AND p_new_status IN ('seated','cancelled','no_show'))
    OR (v_reservation.status='waitlisted' AND p_new_status IN ('confirmed','cancelled'))
    OR (v_reservation.status='seated' AND p_new_status='completed')
  ) THEN RAISE EXCEPTION 'RESERVATION_STATUS_TRANSITION_INVALID'; END IF;
  v_previous:=v_reservation.status;
  UPDATE public.reservations SET status=p_new_status,
    confirmed_at=CASE WHEN p_new_status='confirmed' THEN clock_timestamp() ELSE confirmed_at END,
    seated_at=CASE WHEN p_new_status='seated' THEN clock_timestamp() ELSE seated_at END,
    completed_at=CASE WHEN p_new_status='completed' THEN clock_timestamp() ELSE completed_at END,
    cancelled_at=CASE WHEN p_new_status='cancelled' THEN clock_timestamp() ELSE cancelled_at END,
    cancellation_reason=CASE WHEN p_new_status='cancelled' THEN p_reason ELSE cancellation_reason END,
    updated_at=clock_timestamp()
  WHERE id=v_reservation.id RETURNING * INTO v_reservation;
  INSERT INTO public.reservation_status_history(company_id,location_id,reservation_id,previous_status,new_status,changed_by,reason,correlation_id)
  VALUES(v_reservation.company_id,v_reservation.location_id,v_reservation.id,v_previous,p_new_status,p_actor_profile_id,p_reason,p_correlation_id);
  RETURN QUERY SELECT v_reservation.id,v_reservation.status,true;
END
$function$;

CREATE FUNCTION public.convert_reservation_waitlist(
  p_actor_profile_id uuid,p_company_id uuid,p_waitlist_id uuid,p_starts_at timestamptz,
  p_expected_end_at timestamptz,p_source text,p_correlation_id uuid
) RETURNS TABLE(reservation_id uuid,waitlist_id uuid,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_waitlist public.reservation_waitlist_entries%ROWTYPE;v_reservation public.reservations%ROWTYPE;v_timezone text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_actor_profile_id AND p.company_id=p_company_id AND p.status='active' AND p.role IN ('manager','owner','super_admin'))
  THEN RAISE EXCEPTION 'RESERVATION_FORBIDDEN'; END IF;
  SELECT * INTO v_waitlist FROM public.reservation_waitlist_entries w WHERE w.id=p_waitlist_id AND w.company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_WAITLIST_NOT_FOUND'; END IF;
  IF v_waitlist.status='converted' THEN
    RETURN QUERY SELECT v_waitlist.converted_reservation_id,v_waitlist.id,'confirmed'::text;RETURN;
  END IF;
  IF v_waitlist.status NOT IN ('waiting','contacted','offered') THEN RAISE EXCEPTION 'RESERVATION_WAITLIST_NOT_CONVERTIBLE'; END IF;
  SELECT c.timezone INTO v_timezone FROM public.companies c WHERE c.id=p_company_id;
  INSERT INTO public.reservations(company_id,location_id,guest_id,reservation_date,reservation_time,starts_at,expected_end_at,guest_count,purpose,notes,seating_preference,status,source,created_by,confirmed_at)
  VALUES(p_company_id,v_waitlist.location_id,v_waitlist.guest_id,(p_starts_at AT TIME ZONE v_timezone)::date,date_trunc('minute',p_starts_at AT TIME ZONE v_timezone)::time,p_starts_at,p_expected_end_at,v_waitlist.guest_count,v_waitlist.purpose,v_waitlist.notes,v_waitlist.seating_preference,'confirmed',p_source,p_actor_profile_id,clock_timestamp())
  RETURNING * INTO v_reservation;
  UPDATE public.reservation_waitlist_entries SET status='converted',converted_reservation_id=v_reservation.id,updated_at=clock_timestamp() WHERE id=v_waitlist.id;
  INSERT INTO public.reservation_status_history(company_id,location_id,reservation_id,previous_status,new_status,changed_by,reason,correlation_id)
  VALUES(p_company_id,v_reservation.location_id,v_reservation.id,NULL,'confirmed',p_actor_profile_id,'waitlist_conversion',p_correlation_id);
  RETURN QUERY SELECT v_reservation.id,v_waitlist.id,v_reservation.status;
END
$function$;

ALTER FUNCTION public.create_manual_reservation(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,date,time,timestamptz,timestamptz,text,text,text,boolean,time,time,uuid) OWNER TO postgres;
ALTER FUNCTION public.transition_reservation_status(uuid,uuid,uuid,text,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.convert_reservation_waitlist(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_manual_reservation(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,date,time,timestamptz,timestamptz,text,text,text,boolean,time,time,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.transition_reservation_status(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.convert_reservation_waitlist(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_reservation(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,date,time,timestamptz,timestamptz,text,text,text,boolean,time,time,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_reservation_status(uuid,uuid,uuid,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.convert_reservation_waitlist(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) TO service_role;

ALTER TABLE public.reservation_guests ENABLE ROW LEVEL SECURITY; ALTER TABLE public.reservation_guests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY; ALTER TABLE public.reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_waitlist_entries ENABLE ROW LEVEL SECURITY; ALTER TABLE public.reservation_waitlist_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_status_history ENABLE ROW LEVEL SECURITY; ALTER TABLE public.reservation_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_telephony_destinations ENABLE ROW LEVEL SECURITY; ALTER TABLE public.reservation_telephony_destinations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_incoming_call_sessions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.reservation_incoming_call_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY reservation_guests_management_select ON public.reservation_guests FOR SELECT TO authenticated USING (private.can_view_camera_manager(company_id));
CREATE POLICY reservations_management_select ON public.reservations FOR SELECT TO authenticated USING (private.can_view_camera_manager(company_id));
CREATE POLICY reservation_waitlist_management_select ON public.reservation_waitlist_entries FOR SELECT TO authenticated USING (private.can_view_camera_manager(company_id));
CREATE POLICY reservation_history_management_select ON public.reservation_status_history FOR SELECT TO authenticated USING (private.can_view_camera_manager(company_id));
CREATE POLICY reservation_telephony_management_select ON public.reservation_telephony_destinations FOR SELECT TO authenticated USING (private.can_view_camera_manager(company_id));
CREATE POLICY reservation_calls_management_select ON public.reservation_incoming_call_sessions FOR SELECT TO authenticated USING (private.can_view_camera_manager(company_id));

REVOKE ALL ON public.reservation_guests,public.reservations,public.reservation_waitlist_entries,public.reservation_status_history,public.reservation_telephony_destinations,public.reservation_incoming_call_sessions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.reservation_guests,public.reservations,public.reservation_waitlist_entries,public.reservation_status_history,public.reservation_telephony_destinations,public.reservation_incoming_call_sessions TO authenticated,service_role;

COMMIT;
