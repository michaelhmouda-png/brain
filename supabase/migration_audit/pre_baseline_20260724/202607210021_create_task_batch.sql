-- Atomic, service-only multi-task creation. Existing create_task remains unchanged.
BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS tasks_company_location_due_at_idx
  ON public.tasks(company_id, location_id, due_at);
CREATE INDEX IF NOT EXISTS tasks_active_assignee_due_at_idx
  ON public.tasks(company_id, assigned_employee_id, due_at)
  WHERE status IN ('pending', 'in_progress');

CREATE OR REPLACE FUNCTION public.create_task_batch_with_outbox_events(
  p_actor_id uuid,
  p_profile_id uuid,
  p_tenant_id uuid,
  p_proposal_id uuid,
  p_items jsonb
)
RETURNS TABLE(created_count integer, task_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_timezone text;
  v_proposal_status text;
  v_proposal_payload jsonb;
  v_count integer;
  v_existing integer;
  v_item jsonb;
  v_index integer;
  v_task_ids uuid[] := ARRAY[]::uuid[];
  v_expected_event_payload jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_profile_id IS NULL OR p_tenant_id IS NULL OR
     p_proposal_id IS NULL OR p_actor_id <> p_profile_id THEN
    RAISE EXCEPTION 'INVALID_ACTOR_CONTEXT' USING ERRCODE = '22023';
  END IF;

  SELECT p.role INTO v_role
    FROM public.profiles AS p
   WHERE p.id = p_profile_id
     AND p.company_id = p_tenant_id
     AND p.status = 'active';
  IF v_role IS NULL OR v_role NOT IN ('manager', 'owner', 'super_admin') THEN
    RAISE EXCEPTION 'BATCH_TASK_ROLE_DENIED' USING ERRCODE = '42501';
  END IF;

  SELECT c.timezone INTO v_timezone
    FROM public.companies AS c
   WHERE c.id = p_tenant_id;
  IF v_timezone IS NULL OR btrim(v_timezone) = '' THEN
    RAISE EXCEPTION 'COMPANY_TIMEZONE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT bap.status, bap.canonical_payload
    INTO v_proposal_status, v_proposal_payload
    FROM public.brain_action_proposals AS bap
   WHERE bap.id = p_proposal_id
     AND bap.actor_id = p_actor_id
     AND bap.profile_id = p_profile_id
     AND bap.tenant_id = p_tenant_id
     AND bap.canonical_action = 'create_task_batch'
     AND bap.schema_version = 1;
  IF v_proposal_status IS NULL THEN
    RAISE EXCEPTION 'INVALID_BATCH_PROPOSAL' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_BATCH_ITEMS' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_items);
  IF v_count < 1 OR v_count > 25 OR jsonb_array_length(v_proposal_payload->'tasks') <> v_count THEN
    RAISE EXCEPTION 'INVALID_BATCH_SIZE' USING ERRCODE = '22023';
  END IF;
  IF v_proposal_payload->>'timezone' IS DISTINCT FROM v_timezone OR
     (SELECT count(DISTINCT entry.value->>'task_id') FROM jsonb_array_elements(p_items) AS entry(value)) <> v_count OR
     (SELECT count(DISTINCT entry.value->>'event_id') FROM jsonb_array_elements(p_items) AS entry(value)) <> v_count OR
     (SELECT count(DISTINCT entry.value->>'command_id') FROM jsonb_array_elements(p_items) AS entry(value)) <> v_count OR
     (SELECT count(DISTINCT entry.value->>'idempotency_key') FROM jsonb_array_elements(p_items) AS entry(value)) <> v_count THEN
    RAISE EXCEPTION 'INVALID_BATCH_IDENTITY' USING ERRCODE = '22023';
  END IF;

  -- Validate the complete batch and its exact proposal relationship before any insert.
  FOR v_item, v_index IN
    SELECT entry.value, (entry.ordinality - 1)::integer
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entry(value, ordinality)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' OR
       (SELECT count(*) FROM jsonb_object_keys(v_item)) <> 17 OR
       (v_item->>'item_index')::integer <> v_index OR
       (v_item - ARRAY['task_id','event_id','command_id','correlation_id','idempotency_key']::text[])
         IS DISTINCT FROM (v_proposal_payload->'tasks'->v_index) OR
       nullif(btrim(v_item->>'title'), '') IS NULL OR
       nullif(btrim(v_item->>'description'), '') IS NULL OR
       v_item->>'priority' NOT IN ('low','medium','high','critical') OR
       v_item->>'status' <> 'pending' OR
       (v_item->>'due_date')::date IS DISTINCT FROM
         ((v_item->>'due_at')::timestamptz AT TIME ZONE v_timezone)::date OR
       (v_item->>'correlation_id')::uuid IS DISTINCT FROM
         (SELECT bap.correlation_id FROM public.brain_action_proposals AS bap WHERE bap.id = p_proposal_id) OR
       v_item->>'idempotency_key' !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'INVALID_CANONICAL_BATCH_ITEM' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.employees AS e
       WHERE e.id = (v_item->>'assigned_employee_id')::uuid
         AND e.company_id = p_tenant_id AND e.status = 'active'
         AND btrim(concat_ws(' ', e.first_name, e.last_name)) = v_item->>'assigned_employee_name'
    ) THEN
      RAISE EXCEPTION 'INVALID_BATCH_ASSIGNEE' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.locations AS l
       WHERE l.id = (v_item->>'location_id')::uuid
         AND l.company_id = p_tenant_id
         AND (l.status IS NULL OR l.status = 'active')
         AND l.name = v_item->>'location_name'
    ) THEN
      RAISE EXCEPTION 'INVALID_BATCH_LOCATION' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  SELECT count(*) INTO v_existing
    FROM public.tasks AS t
   WHERE t.id IN (SELECT (entry.value->>'task_id')::uuid FROM jsonb_array_elements(p_items) AS entry(value));
  IF v_existing > 0 THEN
    IF v_existing <> v_count OR v_proposal_status NOT IN ('executing','executed') OR
       (SELECT count(*) FROM public.brain_event_outbox AS beo
         WHERE beo.proposal_id = p_proposal_id
           AND beo.aggregate_id IN (SELECT (entry.value->>'task_id')::uuid FROM jsonb_array_elements(p_items) AS entry(value))) <> v_count THEN
      RAISE EXCEPTION 'CONFLICTING_BATCH_RETRY' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_count, array_agg((entry.value->>'task_id')::uuid ORDER BY entry.ordinality)
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entry(value, ordinality);
    RETURN;
  END IF;
  IF v_proposal_status <> 'executing' THEN
    RAISE EXCEPTION 'BATCH_PROPOSAL_NOT_EXECUTING' USING ERRCODE = '42501';
  END IF;

  FOR v_item, v_index IN
    SELECT entry.value, (entry.ordinality - 1)::integer
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entry(value, ordinality)
  LOOP
    INSERT INTO public.tasks (
      id, company_id, location_id, assigned_employee_id, title, description,
      priority, status, due_date, due_at, created_by
    ) VALUES (
      (v_item->>'task_id')::uuid, p_tenant_id, (v_item->>'location_id')::uuid,
      (v_item->>'assigned_employee_id')::uuid, btrim(v_item->>'title'), v_item->>'description',
      v_item->>'priority', 'pending', (v_item->>'due_date')::date,
      (v_item->>'due_at')::timestamptz, p_profile_id
    );

    v_expected_event_payload := jsonb_build_object(
      'taskId', (v_item->>'task_id')::uuid,
      'title', btrim(v_item->>'title'),
      'priority', v_item->>'priority',
      'status', 'pending',
      'assignedEmployeeId', (v_item->>'assigned_employee_id')::uuid,
      'dueDate', v_item->>'due_date'
    );
    INSERT INTO public.brain_event_outbox (
      id, event_type, schema_version, company_id, actor_id, profile_id,
      aggregate_type, aggregate_id, command_id, correlation_id, causation_id,
      proposal_id, idempotency_key, payload, occurred_at
    ) VALUES (
      (v_item->>'event_id')::uuid, 'task.created', 1, p_tenant_id, p_actor_id, p_profile_id,
      'task', (v_item->>'task_id')::uuid, (v_item->>'command_id')::uuid,
      (v_item->>'correlation_id')::uuid, (v_item->>'command_id')::uuid,
      p_proposal_id, v_item->>'idempotency_key', v_expected_event_payload, clock_timestamp()
    );
    v_task_ids := array_append(v_task_ids, (v_item->>'task_id')::uuid);
  END LOOP;

  RETURN QUERY SELECT v_count, v_task_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.create_task_batch_with_outbox_events(uuid,uuid,uuid,uuid,jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_task_batch_with_outbox_events(uuid,uuid,uuid,uuid,jsonb)
  TO service_role;

COMMENT ON FUNCTION public.create_task_batch_with_outbox_events(uuid,uuid,uuid,uuid,jsonb) IS
  'Atomically inserts one validated create_task_batch proposal and one task.created outbox obligation per task; service role only.';

COMMIT;
