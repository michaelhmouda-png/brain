-- Reservation OS: validate reservation instants in the selected active location timezone.
BEGIN;

CREATE OR REPLACE FUNCTION private.validate_reservation_context()
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
    SELECT l.timezone
    INTO v_timezone
    FROM public.locations l
    WHERE l.id = NEW.location_id
      AND l.company_id = NEW.company_id
      AND l.status = 'active';
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

COMMIT;
