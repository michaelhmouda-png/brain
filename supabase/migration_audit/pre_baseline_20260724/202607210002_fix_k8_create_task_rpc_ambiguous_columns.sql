-- Stage K8 corrective migration: qualify table columns that collide with
-- RETURNS TABLE output variables in PL/pgSQL. The public RPC signature,
-- validation, atomic inserts, safe result, and grants remain unchanged.

CREATE OR REPLACE FUNCTION public.create_task_with_outbox_event(
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
  outbox_event_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected_payload jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_profile_id IS NULL OR p_tenant_id IS NULL OR
     p_actor_id <> p_profile_id THEN
    RAISE EXCEPTION 'INVALID_ACTOR_CONTEXT' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles AS pr
     WHERE pr.id = p_profile_id
       AND pr.company_id = p_tenant_id
       AND pr.status = 'active'
  ) THEN
    RAISE EXCEPTION 'INVALID_ACTIVE_PROFILE' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.brain_action_proposals AS bap
     WHERE bap.id = p_proposal_id
       AND bap.actor_id = p_actor_id
       AND bap.profile_id = p_profile_id
       AND bap.tenant_id = p_tenant_id
       AND bap.canonical_action = 'create_task'
       AND bap.status = 'executing'
  ) THEN
    RAISE EXCEPTION 'INVALID_EXECUTING_PROPOSAL' USING ERRCODE = '42501';
  END IF;

  IF p_assigned_employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.employees AS emp
     WHERE emp.id = p_assigned_employee_id
       AND emp.company_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'CROSS_TENANT_ASSIGNEE' USING ERRCODE = '42501';
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
    'dueDate', CASE WHEN p_due_date IS NULL THEN NULL ELSE to_char(p_due_date, 'YYYY-MM-DD') END
  );
  IF p_event_payload IS DISTINCT FROM v_expected_payload THEN
    RAISE EXCEPTION 'INVALID_EVENT_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tasks (
    id, company_id, assigned_employee_id, title, description,
    priority, status, due_date, created_by
  ) VALUES (
    p_task_id, p_tenant_id, p_assigned_employee_id, btrim(p_title), p_description,
    p_priority, p_status, p_due_date, p_profile_id
  );

  INSERT INTO public.brain_event_outbox (
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
    p_assigned_employee_id, p_due_date, p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_task_with_outbox_event(
  uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,uuid,text,integer,text,
  uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_task_with_outbox_event(
  uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,uuid,text,integer,text,
  uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz
) TO service_role;
