-- Reservation Experience v2.1: atomic, tenant-safe reservation and guest detail editing.
BEGIN;

CREATE FUNCTION public.update_manual_reservation(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_reservation_id uuid,
  p_first_name text,
  p_last_name text,
  p_country_calling_code text,
  p_national_phone_number text,
  p_phone_e164 text,
  p_guest_count integer,
  p_reservation_date date,
  p_reservation_time time,
  p_starts_at timestamptz,
  p_expected_end_at timestamptz,
  p_purpose text,
  p_purpose_details text,
  p_notes text,
  p_seating_preference text,
  p_new_status text,
  p_status_reason text,
  p_correlation_id uuid
) RETURNS TABLE(reservation_id uuid, guest_id uuid, status text, status_changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_previous_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_actor_profile_id
      AND p.company_id = p_company_id
      AND p.status = 'active'
      AND p.role IN ('manager','owner','super_admin')
  ) THEN
    RAISE EXCEPTION 'RESERVATION_FORBIDDEN';
  END IF;
  IF p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'RESERVATION_CORRELATION_REQUIRED';
  END IF;

  SELECT *
  INTO v_reservation
  FROM public.reservations r
  WHERE r.id = p_reservation_id
    AND r.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESERVATION_NOT_FOUND';
  END IF;

  PERFORM 1
  FROM public.reservation_guests g
  WHERE g.id = v_reservation.guest_id
    AND g.company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESERVATION_GUEST_INVALID';
  END IF;

  IF p_first_name IS NULL OR char_length(btrim(p_first_name)) NOT BETWEEN 1 AND 80
     OR p_last_name IS NULL OR char_length(btrim(p_last_name)) NOT BETWEEN 1 AND 80
     OR p_country_calling_code !~ '^\+[1-9][0-9]{0,3}$'
     OR p_national_phone_number !~ '^[1-9][0-9]{3,13}$'
     OR p_phone_e164 IS DISTINCT FROM p_country_calling_code || p_national_phone_number
     OR p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     OR p_guest_count NOT BETWEEN 1 AND 100
     OR p_expected_end_at IS NULL OR p_expected_end_at <= p_starts_at
     OR p_purpose NOT IN ('regular','birthday','anniversary','business','engagement','bachelor','bachelorette','family','event','other')
     OR p_purpose_details IS NOT NULL AND char_length(p_purpose_details) > 500
     OR p_notes IS NOT NULL AND char_length(p_notes) > 2000
     OR p_seating_preference NOT IN ('no_preference','indoor','outdoor','bar','vip')
     OR p_new_status NOT IN ('pending','confirmed','waitlisted','seated','completed','cancelled','no_show')
     OR p_status_reason IS NOT NULL AND char_length(p_status_reason) > 500 THEN
    RAISE EXCEPTION 'RESERVATION_INPUT_INVALID';
  END IF;

  IF v_reservation.status IS DISTINCT FROM p_new_status AND NOT (
    (v_reservation.status = 'pending' AND p_new_status IN ('confirmed','waitlisted','cancelled'))
    OR (v_reservation.status = 'confirmed' AND p_new_status IN ('seated','cancelled','no_show'))
    OR (v_reservation.status = 'waitlisted' AND p_new_status IN ('confirmed','cancelled'))
    OR (v_reservation.status = 'seated' AND p_new_status = 'completed')
  ) THEN
    RAISE EXCEPTION 'RESERVATION_STATUS_TRANSITION_INVALID';
  END IF;

  UPDATE public.reservation_guests
  SET first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      country_calling_code = p_country_calling_code,
      national_phone_number = p_national_phone_number,
      phone_e164 = p_phone_e164,
      updated_at = clock_timestamp()
  WHERE id = v_reservation.guest_id
    AND company_id = p_company_id;

  v_previous_status := v_reservation.status;
  UPDATE public.reservations
  SET reservation_date = p_reservation_date,
      reservation_time = p_reservation_time,
      starts_at = p_starts_at,
      expected_end_at = p_expected_end_at,
      guest_count = p_guest_count,
      purpose = p_purpose,
      purpose_details = NULLIF(btrim(p_purpose_details), ''),
      notes = NULLIF(btrim(p_notes), ''),
      seating_preference = p_seating_preference,
      status = p_new_status,
      confirmed_at = CASE
        WHEN v_previous_status IS DISTINCT FROM p_new_status AND p_new_status = 'confirmed' THEN clock_timestamp()
        ELSE confirmed_at
      END,
      seated_at = CASE
        WHEN v_previous_status IS DISTINCT FROM p_new_status AND p_new_status = 'seated' THEN clock_timestamp()
        ELSE seated_at
      END,
      completed_at = CASE
        WHEN v_previous_status IS DISTINCT FROM p_new_status AND p_new_status = 'completed' THEN clock_timestamp()
        ELSE completed_at
      END,
      cancelled_at = CASE
        WHEN v_previous_status IS DISTINCT FROM p_new_status AND p_new_status = 'cancelled' THEN clock_timestamp()
        ELSE cancelled_at
      END,
      cancellation_reason = CASE
        WHEN v_previous_status IS DISTINCT FROM p_new_status AND p_new_status = 'cancelled'
          THEN NULLIF(btrim(p_status_reason), '')
        ELSE cancellation_reason
      END,
      updated_at = clock_timestamp()
  WHERE id = v_reservation.id
  RETURNING * INTO v_reservation;

  IF v_previous_status IS DISTINCT FROM p_new_status THEN
    INSERT INTO public.reservation_status_history(
      company_id,
      location_id,
      reservation_id,
      previous_status,
      new_status,
      changed_by,
      reason,
      correlation_id
    ) VALUES (
      v_reservation.company_id,
      v_reservation.location_id,
      v_reservation.id,
      v_previous_status,
      p_new_status,
      p_actor_profile_id,
      NULLIF(btrim(p_status_reason), ''),
      p_correlation_id
    );
  END IF;

  RETURN QUERY
  SELECT
    v_reservation.id,
    v_reservation.guest_id,
    v_reservation.status,
    v_previous_status IS DISTINCT FROM v_reservation.status;
END
$function$;

ALTER FUNCTION public.update_manual_reservation(
  uuid,uuid,uuid,text,text,text,text,text,integer,date,time,timestamptz,timestamptz,
  text,text,text,text,text,text,uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_manual_reservation(
  uuid,uuid,uuid,text,text,text,text,text,integer,date,time,timestamptz,timestamptz,
  text,text,text,text,text,text,uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_manual_reservation(
  uuid,uuid,uuid,text,text,text,text,text,integer,date,time,timestamptz,timestamptz,
  text,text,text,text,text,text,uuid
) TO service_role;

COMMIT;
