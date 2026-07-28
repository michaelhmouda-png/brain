-- Atomic, tenant-safe management task editing without bypassing completion workflows.
BEGIN;

CREATE FUNCTION public.update_management_task(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
RETURNS TABLE(task_id uuid, update_outcome text, resulting_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_title text;
  v_description text;
  v_assigned_employee_id uuid;
  v_priority text;
  v_status text;
  v_due_date date;
  v_due_at timestamptz;
  v_location_id uuid;
  v_timezone text;
  v_result_updated_at timestamptz;
BEGIN
  IF p_actor_profile_id IS NULL
     OR p_company_id IS NULL
     OR p_task_id IS NULL
     OR p_expected_updated_at IS NULL
     OR p_patch IS NULL
     OR jsonb_typeof(p_patch) <> 'object'
     OR p_patch = '{}'::jsonb
     OR p_patch - ARRAY[
       'title',
       'description',
       'assigned_employee_id',
       'priority',
       'status',
       'due_date',
       'due_at',
       'location_id'
     ]::text[] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'TASK_EDIT_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_profile_id
      AND profile.company_id = p_company_id
      AND profile.status = 'active'
      AND profile.role IN ('manager', 'owner', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'TASK_EDIT_ACTOR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT company.timezone
  INTO v_timezone
  FROM public.companies AS company
  WHERE company.id = p_company_id;

  IF v_timezone IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names AS timezone
    WHERE timezone.name = v_timezone
  ) THEN
    RAISE EXCEPTION 'TASK_EDIT_TIMEZONE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT task.*
  INTO v_task
  FROM public.tasks AS task
  WHERE task.id = p_task_id
    AND task.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_EDIT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_title := v_task.title;
  v_description := v_task.description;
  v_assigned_employee_id := v_task.assigned_employee_id;
  v_priority := v_task.priority;
  v_status := v_task.status;
  v_due_date := v_task.due_date;
  v_due_at := v_task.due_at;
  v_location_id := v_task.location_id;

  IF p_patch ? 'title' THEN
    IF jsonb_typeof(p_patch -> 'title') <> 'string'
       OR char_length(btrim(p_patch ->> 'title')) NOT BETWEEN 1 AND 300 THEN
      RAISE EXCEPTION 'TASK_EDIT_INPUT_INVALID' USING ERRCODE = '22023';
    END IF;
    v_title := btrim(p_patch ->> 'title');
  END IF;

  IF p_patch ? 'description' THEN
    IF jsonb_typeof(p_patch -> 'description') = 'null' THEN
      v_description := NULL;
    ELSIF jsonb_typeof(p_patch -> 'description') <> 'string'
       OR char_length(btrim(p_patch ->> 'description')) NOT BETWEEN 1 AND 5000 THEN
      RAISE EXCEPTION 'TASK_EDIT_INPUT_INVALID' USING ERRCODE = '22023';
    ELSE
      v_description := btrim(p_patch ->> 'description');
    END IF;
  END IF;

  IF p_patch ? 'assigned_employee_id' THEN
    IF jsonb_typeof(p_patch -> 'assigned_employee_id') = 'null' THEN
      v_assigned_employee_id := NULL;
    ELSIF jsonb_typeof(p_patch -> 'assigned_employee_id') <> 'string'
       OR (p_patch ->> 'assigned_employee_id') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'TASK_EDIT_INPUT_INVALID' USING ERRCODE = '22023';
    ELSE
      v_assigned_employee_id := (p_patch ->> 'assigned_employee_id')::uuid;
    END IF;
  END IF;

  IF v_assigned_employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.employees AS employee
    WHERE employee.id = v_assigned_employee_id
      AND employee.company_id = p_company_id
      AND employee.status = 'active'
  ) THEN
    RAISE EXCEPTION 'TASK_EDIT_ASSIGNEE_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'priority' THEN
    IF jsonb_typeof(p_patch -> 'priority') <> 'string'
       OR p_patch ->> 'priority' NOT IN ('critical', 'high', 'medium', 'low') THEN
      RAISE EXCEPTION 'TASK_EDIT_INPUT_INVALID' USING ERRCODE = '22023';
    END IF;
    v_priority := p_patch ->> 'priority';
  END IF;

  IF p_patch ? 'status' THEN
    IF jsonb_typeof(p_patch -> 'status') <> 'string'
       OR p_patch ->> 'status' NOT IN ('pending', 'in_progress', 'completed', 'cancelled') THEN
      RAISE EXCEPTION 'TASK_EDIT_INPUT_INVALID' USING ERRCODE = '22023';
    END IF;
    v_status := p_patch ->> 'status';
  END IF;

  IF p_patch ? 'due_date' THEN
    IF jsonb_typeof(p_patch -> 'due_date') = 'null' THEN
      v_due_date := NULL;
    ELSIF jsonb_typeof(p_patch -> 'due_date') <> 'string'
       OR (p_patch ->> 'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'TASK_EDIT_INPUT_INVALID' USING ERRCODE = '22023';
    ELSE
      v_due_date := (p_patch ->> 'due_date')::date;
    END IF;
  END IF;

  IF p_patch ? 'due_at' THEN
    IF jsonb_typeof(p_patch -> 'due_at') = 'null' THEN
      v_due_at := NULL;
    ELSIF jsonb_typeof(p_patch -> 'due_at') <> 'string'
       OR (p_patch ->> 'due_at') !~
         '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION 'TASK_EDIT_INPUT_INVALID' USING ERRCODE = '22023';
    ELSE
      v_due_at := (p_patch ->> 'due_at')::timestamptz;
    END IF;
  END IF;

  IF (p_patch ? 'due_date' OR p_patch ? 'due_at')
     AND v_due_at IS NOT NULL
     AND (
       v_due_date IS NULL
       OR (v_due_at AT TIME ZONE v_timezone)::date IS DISTINCT FROM v_due_date
     ) THEN
    RAISE EXCEPTION 'TASK_EDIT_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'location_id' THEN
    IF jsonb_typeof(p_patch -> 'location_id') = 'null' THEN
      v_location_id := NULL;
    ELSIF jsonb_typeof(p_patch -> 'location_id') <> 'string'
       OR (p_patch ->> 'location_id') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'TASK_EDIT_INPUT_INVALID' USING ERRCODE = '22023';
    ELSE
      v_location_id := (p_patch ->> 'location_id')::uuid;
    END IF;
  END IF;

  IF v_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.locations AS location
    WHERE location.id = v_location_id
      AND location.company_id = p_company_id
      AND location.status = 'active'
  ) THEN
    RAISE EXCEPTION 'TASK_EDIT_LOCATION_INVALID' USING ERRCODE = '22023';
  END IF;

  IF v_task.status IN ('completed', 'cancelled')
     AND ROW(
       v_title,
       v_description,
       v_assigned_employee_id,
       v_priority,
       v_status,
       v_due_date,
       v_due_at,
       v_location_id
     ) IS DISTINCT FROM ROW(
       v_task.title,
       v_task.description,
       v_task.assigned_employee_id,
       v_task.priority,
       v_task.status,
       v_task.due_date,
       v_task.due_at,
       v_task.location_id
     ) THEN
    RAISE EXCEPTION 'TASK_TERMINAL_EDIT_FORBIDDEN' USING ERRCODE = '40001';
  END IF;

  IF v_status = 'completed' AND v_task.status IS DISTINCT FROM v_status THEN
    RAISE EXCEPTION 'TASK_COMPLETION_WORKFLOW_REQUIRED' USING ERRCODE = '40001';
  END IF;

  IF v_task.status IS DISTINCT FROM v_status AND NOT (
    v_task.status IN ('pending', 'in_progress')
    AND v_status IN ('pending', 'in_progress', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'TASK_STATUS_TRANSITION_INVALID' USING ERRCODE = '40001';
  END IF;

  IF ROW(
    v_title,
    v_description,
    v_assigned_employee_id,
    v_priority,
    v_status,
    v_due_date,
    v_due_at,
    v_location_id
  ) IS NOT DISTINCT FROM ROW(
    v_task.title,
    v_task.description,
    v_task.assigned_employee_id,
    v_task.priority,
    v_task.status,
    v_task.due_date,
    v_task.due_at,
    v_task.location_id
  ) THEN
    RETURN QUERY SELECT v_task.id, 'unchanged'::text, v_task.updated_at;
    RETURN;
  END IF;

  IF v_task.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'TASK_EDIT_STALE' USING ERRCODE = '40001';
  END IF;

  UPDATE public.tasks AS task
  SET title = v_title,
      description = v_description,
      assigned_employee_id = v_assigned_employee_id,
      priority = v_priority,
      status = v_status,
      due_date = v_due_date,
      due_at = v_due_at,
      location_id = v_location_id,
      updated_at = clock_timestamp()
  WHERE task.id = v_task.id
    AND task.company_id = v_task.company_id
    AND task.updated_at = v_task.updated_at
  RETURNING task.updated_at
  INTO v_result_updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_EDIT_STALE' USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT v_task.id, 'updated'::text, v_result_updated_at;
END
$function$;

ALTER FUNCTION public.update_management_task(uuid, uuid, uuid, timestamptz, jsonb)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_management_task(uuid, uuid, uuid, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.update_management_task(uuid, uuid, uuid, timestamptz, jsonb)
  TO service_role;

COMMIT;
