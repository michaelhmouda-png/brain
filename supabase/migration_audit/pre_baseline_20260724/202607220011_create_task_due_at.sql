-- Add a focused timed-task variant of the K8 atomic task/outbox RPC.
-- The deployed date-only create_task_with_outbox_event contract is unchanged.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.create_task_with_outbox_event(uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,uuid,text,integer,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'CREATE_TASK_DUE_AT_K8_RPC_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = 'tasks'
      AND c.column_name = 'due_at' AND c.data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'CREATE_TASK_DUE_AT_COLUMN_MISSING';
  END IF;
  IF to_regprocedure('public.create_task_with_outbox_event_due_at(uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,timestamptz,uuid,text,integer,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'CREATE_TASK_DUE_AT_RPC_ALREADY_EXISTS';
  END IF;
END;
$$;

CREATE FUNCTION public.create_task_with_outbox_event_due_at(
  p_task_id uuid,
  p_actor_id uuid,
  p_profile_id uuid,
  p_tenant_id uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_status text,
  p_assigned_employee_id uuid,
  p_due_date date,
  p_due_at timestamptz,
  p_event_id uuid,
  p_event_type text,
  p_event_schema_version integer,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_command_id uuid,
  p_correlation_id uuid,
  p_event_causation_id uuid,
  p_proposal_id uuid,
  p_idempotency_key text,
  p_event_payload jsonb,
  p_occurred_at timestamptz
)
RETURNS TABLE (
  task_id uuid,
  title text,
  priority text,
  status text,
  assigned_employee_id uuid,
  due_date date,
  due_at timestamptz,
  outbox_event_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected_payload jsonb;
  v_proposal_payload jsonb;
  v_timezone text;
BEGIN
  IF p_actor_id IS NULL OR p_profile_id IS NULL OR p_tenant_id IS NULL OR
     p_actor_id <> p_profile_id THEN
    RAISE EXCEPTION 'INVALID_ACTOR_CONTEXT' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS pr
    WHERE pr.id = p_profile_id AND pr.company_id = p_tenant_id AND pr.status = 'active'
  ) THEN
    RAISE EXCEPTION 'INVALID_ACTIVE_PROFILE' USING ERRCODE = '42501';
  END IF;

  SELECT bap.canonical_payload
    INTO v_proposal_payload
    FROM public.brain_action_proposals AS bap
   WHERE bap.id = p_proposal_id
     AND bap.actor_id = p_actor_id
     AND bap.profile_id = p_profile_id
     AND bap.tenant_id = p_tenant_id
     AND bap.canonical_action = 'create_task'
     AND bap.status = 'executing';
  IF v_proposal_payload IS NULL THEN
    RAISE EXCEPTION 'INVALID_EXECUTING_PROPOSAL' USING ERRCODE = '42501';
  END IF;

  IF p_assigned_employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.employees AS emp
    WHERE emp.id = p_assigned_employee_id AND emp.company_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'CROSS_TENANT_ASSIGNEE' USING ERRCODE = '42501';
  END IF;

  SELECT company.timezone INTO v_timezone
    FROM public.companies AS company
   WHERE company.id = p_tenant_id;
  IF v_timezone IS NULL OR p_due_date IS NULL OR p_due_at IS NULL OR
     v_proposal_payload->>'timezone' IS DISTINCT FROM v_timezone OR
     (v_proposal_payload->>'due_at')::timestamptz IS DISTINCT FROM p_due_at OR
     v_proposal_payload->>'due_date' IS DISTINCT FROM to_char(p_due_date, 'YYYY-MM-DD') OR
     v_proposal_payload->>'due_local' IS DISTINCT FROM to_char(p_due_at AT TIME ZONE v_timezone, 'YYYY-MM-DD"T"HH24:MI') OR
     (p_due_at AT TIME ZONE v_timezone)::date IS DISTINCT FROM p_due_date THEN
    RAISE EXCEPTION 'INVALID_DUE_TIME' USING ERRCODE = '22023';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' OR
     p_priority NOT IN ('low','medium','high','critical') OR
     p_status NOT IN ('pending','in_progress','completed','cancelled') THEN
    RAISE EXCEPTION 'INVALID_TASK_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  IF p_event_type <> 'task.created' OR p_event_schema_version <> 1 OR
     p_aggregate_type <> 'task' OR p_aggregate_id <> p_task_id OR
     p_event_causation_id <> p_command_id OR
     p_idempotency_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_EVENT_RELATIONSHIP' USING ERRCODE = '22023';
  END IF;

  v_expected_payload := jsonb_build_object(
    'taskId', p_task_id,
    'title', btrim(p_title),
    'priority', p_priority,
    'status', p_status,
    'assignedEmployeeId', p_assigned_employee_id,
    'dueDate', to_char(p_due_date, 'YYYY-MM-DD')
  );
  IF p_event_payload IS DISTINCT FROM v_expected_payload THEN
    RAISE EXCEPTION 'INVALID_EVENT_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tasks AS task (
    id, company_id, assigned_employee_id, title, description,
    priority, status, due_date, due_at, created_by
  ) VALUES (
    p_task_id, p_tenant_id, p_assigned_employee_id, btrim(p_title), p_description,
    p_priority, p_status, p_due_date, p_due_at, p_profile_id
  );

  INSERT INTO public.brain_event_outbox AS outbox (
    id, event_type, schema_version, company_id, actor_id, profile_id,
    aggregate_type, aggregate_id, command_id, correlation_id, causation_id,
    proposal_id, idempotency_key, payload, occurred_at
  ) VALUES (
    p_event_id, p_event_type, p_event_schema_version, p_tenant_id, p_actor_id, p_profile_id,
    p_aggregate_type, p_aggregate_id, p_command_id, p_correlation_id, p_event_causation_id,
    p_proposal_id, p_idempotency_key, p_event_payload, p_occurred_at
  );

  RETURN QUERY SELECT
    p_task_id, btrim(p_title), p_priority, p_status,
    p_assigned_employee_id, p_due_date, p_due_at, p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_task_with_outbox_event_due_at(
  uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,timestamptz,uuid,text,integer,
  text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_task_with_outbox_event_due_at(
  uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,timestamptz,uuid,text,integer,
  text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz
) TO service_role;

COMMIT;

-- Rollback (manual, only before application deployment):
-- DROP FUNCTION public.create_task_with_outbox_event_due_at(
--   uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,timestamptz,uuid,text,integer,
--   text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz
-- );
