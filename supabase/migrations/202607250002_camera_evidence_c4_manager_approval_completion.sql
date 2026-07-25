-- Camera Evidence C4: one human approval atomically approves evidence and completes its linked task.
BEGIN;

ALTER TABLE public.task_evidence_audit
  DROP CONSTRAINT task_evidence_audit_event_type_check;

ALTER TABLE public.task_evidence_audit
  ADD CONSTRAINT task_evidence_audit_event_type_check CHECK (event_type IN (
    'upload.prepared',
    'upload.failed',
    'upload.completed',
    'verification.queued',
    'verification.started',
    'verification.succeeded',
    'verification.failed',
    'review.approved',
    'review.rejected',
    'task.completion_requested',
    'task.completed',
    'task.completion_noop',
    'task.completion_failed'
  ));

CREATE UNIQUE INDEX task_evidence_audit_c4_completion_once_idx
  ON public.task_evidence_audit (evidence_id, event_type)
  WHERE event_type IN (
    'task.completion_requested',
    'task.completed',
    'task.completion_noop',
    'task.completion_failed'
  );

CREATE OR REPLACE FUNCTION private.complete_task_transition(
  p_task_id uuid,
  p_company_id uuid,
  p_actor_profile_id uuid
)
RETURNS TABLE (
  transition_outcome text,
  resulting_status text,
  transitioned_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_result_status text;
  v_transitioned_at timestamptz;
BEGIN
  IF p_task_id IS NULL OR p_company_id IS NULL OR p_actor_profile_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TASK_COMPLETION_CONTEXT' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_profile_id
      AND profile.company_id = p_company_id
      AND profile.status = 'active'
  ) THEN
    RAISE EXCEPTION 'INVALID_TASK_COMPLETION_ACTOR' USING ERRCODE = '42501';
  END IF;

  SELECT task.*
  INTO v_task
  FROM public.tasks AS task
  WHERE task.id = p_task_id
    AND task.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_task.status = 'completed' THEN
    RETURN QUERY SELECT 'already_completed'::text, v_task.status, v_task.updated_at;
    RETURN;
  END IF;

  IF v_task.status NOT IN ('pending', 'in_progress') THEN
    RETURN QUERY SELECT 'not_completable'::text, v_task.status, NULL::timestamptz;
    RETURN;
  END IF;

  UPDATE public.tasks AS task
  SET status = 'completed',
      updated_at = clock_timestamp()
  WHERE task.id = v_task.id
    AND task.company_id = v_task.company_id
    AND task.status = v_task.status
  RETURNING task.status, task.updated_at
  INTO v_result_status, v_transitioned_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_COMPLETION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT 'completed'::text, v_result_status, v_transitioned_at;
END
$function$;

ALTER FUNCTION private.complete_task_transition(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.complete_task_transition(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_my_assigned_task(p_task_id uuid)
RETURNS TABLE(task_id uuid, task_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_task public.tasks%ROWTYPE;
  v_transition record;
BEGIN
  SELECT profile.*
  INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.status = 'active'
  FOR UPDATE;

  IF NOT FOUND OR v_profile.role <> 'employee' OR v_profile.employee_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_ACCESS_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT task.*
  INTO v_task
  FROM public.tasks AS task
  WHERE task.id = p_task_id
    AND task.company_id = v_profile.company_id
    AND task.assigned_employee_id = v_profile.employee_id
  FOR UPDATE;

  IF NOT FOUND OR v_task.status NOT IN ('pending', 'in_progress') THEN
    RAISE EXCEPTION 'TASK_NOT_COMPLETABLE' USING ERRCODE = '42501';
  END IF;

  SELECT transition.*
  INTO v_transition
  FROM private.complete_task_transition(
    v_task.id,
    v_task.company_id,
    v_profile.id
  ) AS transition;

  IF v_transition.transition_outcome <> 'completed' THEN
    RAISE EXCEPTION 'TASK_NOT_COMPLETABLE' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_task.id, v_transition.resulting_status;
END
$function$;

ALTER FUNCTION public.complete_my_assigned_task(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_my_assigned_task(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_my_assigned_task(uuid)
  TO authenticated, service_role;

DROP FUNCTION public.review_task_evidence(uuid, text, text, boolean);

CREATE FUNCTION public.review_task_evidence(
  p_evidence_id uuid,
  p_decision text,
  p_note text,
  p_confirm boolean
)
RETURNS TABLE (
  evidence_id uuid,
  evidence_status text,
  task_id uuid,
  task_status text,
  review_outcome text,
  task_completion_outcome text,
  idempotent boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_evidence public.task_evidence%ROWTYPE;
  v_task public.tasks%ROWTYPE;
  v_existing_review public.task_evidence_reviews%ROWTYPE;
  v_transition record;
  v_reviewable_states constant text[] := ARRAY[
    'ai_verified',
    'ai_rejected',
    'needs_human_review',
    'verification_failed'
  ]::text[];
BEGIN
  IF p_evidence_id IS NULL
     OR p_confirm IS NOT TRUE
     OR p_decision NOT IN ('approved', 'rejected')
     OR length(coalesce(p_note, '')) > 1000 THEN
    RAISE EXCEPTION 'INVALID_REVIEW' USING ERRCODE = '22023';
  END IF;

  SELECT profile.*
  INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.status = 'active'
    AND profile.role IN ('manager', 'owner', 'super_admin')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REVIEW_NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT evidence.*
  INTO v_evidence
  FROM public.task_evidence AS evidence
  WHERE evidence.id = p_evidence_id
    AND evidence.company_id = v_profile.company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_REVIEWABLE' USING ERRCODE = '42501';
  END IF;

  SELECT task.*
  INTO v_task
  FROM public.tasks AS task
  WHERE task.id = v_evidence.task_id
    AND task.company_id = v_evidence.company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_decision = 'approved' AND v_evidence.status = ANY(v_reviewable_states) THEN
      INSERT INTO public.task_evidence_audit (
        evidence_id,
        company_id,
        actor_profile_id,
        event_type,
        safe_details
      ) VALUES (
        v_evidence.id,
        v_evidence.company_id,
        v_profile.id,
        'task.completion_failed',
        jsonb_build_object('reason', 'task_not_found')
      )
      ON CONFLICT DO NOTHING;

      RETURN QUERY SELECT
        v_evidence.id,
        v_evidence.status,
        v_evidence.task_id,
        NULL::text,
        'failed'::text,
        'not_completable'::text,
        false;
      RETURN;
    END IF;

    RAISE EXCEPTION 'EVIDENCE_TASK_NOT_REVIEWABLE' USING ERRCODE = '42501';
  END IF;

  SELECT review.*
  INTO v_existing_review
  FROM public.task_evidence_reviews AS review
  WHERE review.evidence_id = v_evidence.id
    AND review.company_id = v_evidence.company_id
  FOR UPDATE;

  IF v_evidence.status = 'human_approved' AND p_decision = 'approved' THEN
    IF FOUND
       AND v_existing_review.decision = 'approved'
       AND v_task.status = 'completed' THEN
      INSERT INTO public.task_evidence_audit (
        evidence_id,
        company_id,
        actor_profile_id,
        event_type,
        safe_details
      ) VALUES (
        v_evidence.id,
        v_evidence.company_id,
        v_profile.id,
        'task.completion_noop',
        jsonb_build_object('reason', 'already_completed')
      )
      ON CONFLICT DO NOTHING;

      RETURN QUERY SELECT
        v_evidence.id,
        v_evidence.status,
        v_task.id,
        v_task.status,
        'already_approved'::text,
        'already_completed'::text,
        true;
      RETURN;
    END IF;

    RAISE EXCEPTION 'EVIDENCE_COMPLETION_INCONSISTENT' USING ERRCODE = '23514';
  END IF;

  IF v_evidence.status = 'human_rejected' AND p_decision = 'rejected' THEN
    IF FOUND AND v_existing_review.decision = 'rejected' THEN
      RETURN QUERY SELECT
        v_evidence.id,
        v_evidence.status,
        v_task.id,
        v_task.status,
        'already_rejected'::text,
        'not_requested'::text,
        true;
      RETURN;
    END IF;

    RAISE EXCEPTION 'EVIDENCE_REVIEW_INCONSISTENT' USING ERRCODE = '23514';
  END IF;

  IF NOT (v_evidence.status = ANY(v_reviewable_states)) THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_REVIEWABLE' USING ERRCODE = '42501';
  END IF;

  IF v_task.status NOT IN ('pending', 'in_progress', 'completed') THEN
    IF p_decision = 'approved' THEN
      INSERT INTO public.task_evidence_audit (
        evidence_id,
        company_id,
        actor_profile_id,
        event_type,
        safe_details
      ) VALUES (
        v_evidence.id,
        v_evidence.company_id,
        v_profile.id,
        'task.completion_failed',
        jsonb_build_object(
          'reason', 'task_not_completable',
          'taskStatus', v_task.status
        )
      )
      ON CONFLICT DO NOTHING;

      RETURN QUERY SELECT
        v_evidence.id,
        v_evidence.status,
        v_task.id,
        v_task.status,
        'failed'::text,
        'not_completable'::text,
        false;
      RETURN;
    END IF;

    RAISE EXCEPTION 'EVIDENCE_TASK_NOT_REVIEWABLE' USING ERRCODE = '42501';
  END IF;

  IF p_decision = 'rejected' AND v_task.status NOT IN ('pending', 'in_progress') THEN
    RAISE EXCEPTION 'EVIDENCE_TASK_NOT_REVIEWABLE' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.task_evidence_reviews (
    evidence_id,
    company_id,
    reviewer_profile_id,
    decision,
    note
  ) VALUES (
    v_evidence.id,
    v_evidence.company_id,
    v_profile.id,
    p_decision,
    nullif(btrim(p_note), '')
  );

  INSERT INTO public.task_evidence_audit (
    evidence_id,
    company_id,
    actor_profile_id,
    event_type,
    safe_details
  ) VALUES (
    v_evidence.id,
    v_evidence.company_id,
    v_profile.id,
    CASE p_decision
      WHEN 'approved' THEN 'review.approved'
      ELSE 'review.rejected'
    END,
    jsonb_build_object('has_note', nullif(btrim(p_note), '') IS NOT NULL)
  );

  IF p_decision = 'rejected' THEN
    UPDATE public.task_evidence AS evidence
    SET status = 'human_rejected'
    WHERE evidence.id = v_evidence.id
      AND evidence.company_id = v_evidence.company_id
      AND evidence.task_id = v_task.id
      AND evidence.status = v_evidence.status;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'EVIDENCE_REVIEW_CONFLICT' USING ERRCODE = '40001';
    END IF;

    RETURN QUERY SELECT
      v_evidence.id,
      'human_rejected'::text,
      v_task.id,
      v_task.status,
      'rejected'::text,
      'not_requested'::text,
      false;
    RETURN;
  END IF;

  INSERT INTO public.task_evidence_audit (
    evidence_id,
    company_id,
    actor_profile_id,
    event_type,
    safe_details
  ) VALUES (
    v_evidence.id,
    v_evidence.company_id,
    v_profile.id,
    'task.completion_requested',
    jsonb_build_object('source', 'human_evidence_review')
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.task_evidence AS evidence
  SET status = 'human_approved'
  WHERE evidence.id = v_evidence.id
    AND evidence.company_id = v_evidence.company_id
    AND evidence.task_id = v_task.id
    AND evidence.status = v_evidence.status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVIDENCE_REVIEW_CONFLICT' USING ERRCODE = '40001';
  END IF;

  SELECT transition.*
  INTO v_transition
  FROM private.complete_task_transition(
    v_task.id,
    v_task.company_id,
    v_profile.id
  ) AS transition;

  IF v_transition.transition_outcome = 'completed' THEN
    INSERT INTO public.task_evidence_audit (
      evidence_id,
      company_id,
      actor_profile_id,
      event_type,
      safe_details
    ) VALUES (
      v_evidence.id,
      v_evidence.company_id,
      v_profile.id,
      'task.completed',
      jsonb_build_object(
        'fromStatus', v_task.status,
        'toStatus', v_transition.resulting_status
      )
    )
    ON CONFLICT DO NOTHING;

    RETURN QUERY SELECT
      v_evidence.id,
      'human_approved'::text,
      v_task.id,
      v_transition.resulting_status,
      'approved'::text,
      'completed'::text,
      false;
    RETURN;
  END IF;

  IF v_transition.transition_outcome = 'already_completed' THEN
    INSERT INTO public.task_evidence_audit (
      evidence_id,
      company_id,
      actor_profile_id,
      event_type,
      safe_details
    ) VALUES (
      v_evidence.id,
      v_evidence.company_id,
      v_profile.id,
      'task.completion_noop',
      jsonb_build_object('reason', 'already_completed')
    )
    ON CONFLICT DO NOTHING;

    RETURN QUERY SELECT
      v_evidence.id,
      'human_approved'::text,
      v_task.id,
      v_transition.resulting_status,
      'approved'::text,
      'already_completed'::text,
      true;
    RETURN;
  END IF;

  RAISE EXCEPTION 'TASK_COMPLETION_CONFLICT' USING ERRCODE = '40001';
END
$function$;

ALTER FUNCTION public.review_task_evidence(uuid, text, text, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_task_evidence(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_task_evidence(uuid, text, text, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION private.complete_task_transition(uuid, uuid, uuid) IS
  'Canonical locked task completion transition used by employee self-service and human evidence approval; the existing task trigger emits task.completed notification outbox events.';

COMMENT ON FUNCTION public.review_task_evidence(uuid, text, text, boolean) IS
  'Atomically records a human evidence decision and completes an active linked task on approval. AI verdicts never invoke task completion.';

COMMIT;
