BEGIN;

ALTER TABLE public.shifts
  ADD COLUMN location_id uuid,
  ADD COLUMN starts_at timestamptz,
  ADD COLUMN ends_at timestamptz;

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT shifts_canonical_interval_check CHECK (
    (location_id IS NULL AND starts_at IS NULL AND ends_at IS NULL)
    OR (
      location_id IS NOT NULL
      AND starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND ends_at > starts_at
      AND ends_at <= starts_at + interval '24 hours'
    )
  );

CREATE INDEX shifts_company_location_date_idx
  ON public.shifts(company_id, location_id, shift_date, employee_id);

CREATE INDEX shifts_employee_interval_idx
  ON public.shifts(company_id, employee_id, starts_at, ends_at)
  WHERE status = 'scheduled' AND starts_at IS NOT NULL AND ends_at IS NOT NULL;

CREATE UNIQUE INDEX shifts_exact_scheduled_interval_uidx
  ON public.shifts(company_id, employee_id, starts_at, ends_at)
  WHERE status = 'scheduled' AND starts_at IS NOT NULL AND ends_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_concrete_shift(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_employee_id uuid,
  p_location_id uuid,
  p_shift_date date,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_correlation_id uuid
)
RETURNS TABLE(
  id uuid,
  employee_id uuid,
  location_id uuid,
  shift_date date,
  start_time time without time zone,
  end_time time without time zone,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_timezone text;
  v_expected_end_date date;
BEGIN
  IF p_actor_profile_id IS NULL OR p_company_id IS NULL OR p_employee_id IS NULL
     OR p_location_id IS NULL OR p_shift_date IS NULL OR p_start_time IS NULL
     OR p_end_time IS NULL OR p_starts_at IS NULL OR p_ends_at IS NULL
     OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'SHIFT_INPUT_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_profile_id
      AND profile.company_id = p_company_id
      AND profile.status = 'active'
      AND lower(profile.role) IN ('manager', 'owner', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees AS employee
    WHERE employee.id = p_employee_id
      AND employee.company_id = p_company_id
      AND employee.status = 'active'
  ) THEN
    RAISE EXCEPTION 'SHIFT_EMPLOYEE_INVALID';
  END IF;

  SELECT location.timezone
  INTO v_timezone
  FROM public.locations AS location
  WHERE location.id = p_location_id
    AND location.company_id = p_company_id
    AND location.status = 'active';

  IF v_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names AS zone WHERE zone.name = v_timezone
  ) THEN
    RAISE EXCEPTION 'SHIFT_LOCATION_INVALID';
  END IF;

  v_expected_end_date := p_shift_date
    + CASE WHEN p_end_time <= p_start_time THEN 1 ELSE 0 END;

  IF (p_starts_at AT TIME ZONE v_timezone)::date IS DISTINCT FROM p_shift_date
     OR date_trunc('minute', p_starts_at AT TIME ZONE v_timezone)::time IS DISTINCT FROM p_start_time
     OR (p_ends_at AT TIME ZONE v_timezone)::date IS DISTINCT FROM v_expected_end_date
     OR date_trunc('minute', p_ends_at AT TIME ZONE v_timezone)::time IS DISTINCT FROM p_end_time
     OR p_ends_at <= p_starts_at
     OR p_ends_at > p_starts_at + interval '24 hours' THEN
    RAISE EXCEPTION 'SHIFT_LOCAL_TIME_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_company_id::text || ':' || p_employee_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.shifts AS existing
    WHERE existing.company_id = p_company_id
      AND existing.employee_id = p_employee_id
      AND existing.status = 'scheduled'
      AND (
        (
          existing.starts_at = p_starts_at
          AND existing.ends_at = p_ends_at
        )
        OR (
          existing.location_id = p_location_id
          AND existing.shift_date = p_shift_date
          AND existing.start_time = p_start_time
          AND existing.end_time = p_end_time
        )
      )
  ) THEN
    RAISE EXCEPTION 'SHIFT_DUPLICATE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.shifts AS existing
    WHERE existing.company_id = p_company_id
      AND existing.employee_id = p_employee_id
      AND existing.status = 'scheduled'
      AND (
        (
          existing.starts_at IS NOT NULL
          AND existing.ends_at IS NOT NULL
          AND existing.starts_at < p_ends_at
          AND existing.ends_at > p_starts_at
        )
        OR (
          existing.starts_at IS NULL
          AND existing.ends_at IS NULL
          AND existing.shift_date::timestamp + existing.start_time
              < v_expected_end_date::timestamp + p_end_time
          AND existing.shift_date::timestamp + existing.end_time
                + CASE WHEN existing.end_time <= existing.start_time THEN interval '1 day' ELSE interval '0' END
              > p_shift_date::timestamp + p_start_time
        )
      )
  ) THEN
    RAISE EXCEPTION 'SHIFT_CONFLICT';
  END IF;

  RETURN QUERY
  INSERT INTO public.shifts AS created(
    company_id,
    employee_id,
    location_id,
    shift_date,
    start_time,
    end_time,
    starts_at,
    ends_at,
    shift_type,
    status,
    created_by_id
  )
  VALUES(
    p_company_id,
    p_employee_id,
    p_location_id,
    p_shift_date,
    p_start_time,
    p_end_time,
    p_starts_at,
    p_ends_at,
    'custom',
    'scheduled',
    p_actor_profile_id
  )
  RETURNING
    created.id,
    created.employee_id,
    created.location_id,
    created.shift_date,
    created.start_time,
    created.end_time,
    created.starts_at,
    created.ends_at,
    created.status;
END;
$$;

ALTER FUNCTION public.create_concrete_shift(
  uuid, uuid, uuid, uuid, date, time without time zone, time without time zone,
  timestamptz, timestamptz, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_concrete_shift(
  uuid, uuid, uuid, uuid, date, time without time zone, time without time zone,
  timestamptz, timestamptz, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_concrete_shift(
  uuid, uuid, uuid, uuid, date, time without time zone, time without time zone,
  timestamptz, timestamptz, uuid
) TO service_role;

COMMIT;
