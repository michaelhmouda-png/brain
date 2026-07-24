-- Stage K8: focused transactional outbox for the canonical task.create path.
-- The service-only RPC inserts the task and its task.created obligation in one transaction.

CREATE TABLE public.brain_event_outbox (
  id uuid PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type = 'task.created'),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  aggregate_type text NOT NULL CHECK (aggregate_type = 'task'),
  aggregate_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid NOT NULL,
  proposal_id uuid NOT NULL REFERENCES public.brain_action_proposals(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','delivered')),
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_safe_error_code text,
  CONSTRAINT brain_event_outbox_one_type_per_command UNIQUE (command_id, event_type),
  CONSTRAINT brain_event_outbox_tenant_idempotency UNIQUE (company_id, idempotency_key),
  CONSTRAINT brain_event_outbox_delivery_state CHECK (
    (delivery_status = 'pending' AND delivered_at IS NULL) OR
    (delivery_status = 'delivered' AND delivered_at IS NOT NULL)
  )
);

CREATE INDEX brain_event_outbox_pending_available_idx
  ON public.brain_event_outbox(available_at, created_at)
  WHERE delivery_status = 'pending';
CREATE INDEX brain_event_outbox_company_created_idx
  ON public.brain_event_outbox(company_id, created_at DESC);
CREATE INDEX brain_event_outbox_aggregate_idx
  ON public.brain_event_outbox(aggregate_type, aggregate_id);
CREATE INDEX brain_event_outbox_correlation_idx
  ON public.brain_event_outbox(correlation_id);

ALTER TABLE public.brain_event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_event_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brain_event_outbox FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.brain_event_outbox TO service_role;

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
    SELECT 1 FROM public.profiles
     WHERE id = p_profile_id
       AND company_id = p_tenant_id
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'INVALID_ACTIVE_PROFILE' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.brain_action_proposals
     WHERE id = p_proposal_id
       AND actor_id = p_actor_id
       AND profile_id = p_profile_id
       AND tenant_id = p_tenant_id
       AND canonical_action = 'create_task'
       AND status = 'executing'
  ) THEN
    RAISE EXCEPTION 'INVALID_EXECUTING_PROPOSAL' USING ERRCODE = '42501';
  END IF;

  IF p_assigned_employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.employees
     WHERE id = p_assigned_employee_id
       AND company_id = p_tenant_id
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

COMMENT ON TABLE public.brain_event_outbox IS
  'Server-only Stage K8 task.created publication obligations; delivery is at-least-once and idempotent by command/event type.';
COMMENT ON FUNCTION public.create_task_with_outbox_event(
  uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,uuid,text,integer,text,
  uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz
) IS 'Atomically inserts one canonical task and its validated task.created outbox obligation.';
