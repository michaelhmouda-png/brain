-- Bounded, explicitly invoked legacy task-localization backfill.
-- Applying this migration does not enqueue jobs or call an external service.
BEGIN;

DO $$
DECLARE
  v_localizations_forced boolean;
  v_jobs_forced boolean;
BEGIN
  SELECT c.relrowsecurity AND c.relforcerowsecurity INTO v_localizations_forced
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'task_localizations' AND c.relkind = 'r';

  SELECT c.relrowsecurity AND c.relforcerowsecurity INTO v_jobs_forced
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'task_localization_jobs' AND c.relkind = 'r';

  IF v_localizations_forced IS DISTINCT FROM true OR v_jobs_forced IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TASK_LOCALIZATION_FOUNDATION_INCOMPATIBLE';
  END IF;

  IF to_regprocedure('public.claim_task_localization_job(integer)') IS NULL
     OR to_regprocedure('public.complete_task_localization_job(uuid,text,text,uuid,text,text)') IS NULL
     OR to_regprocedure('public.fail_task_localization_job(uuid,text,uuid,text)') IS NULL
     OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'TASK_LOCALIZATION_FOUNDATION_FUNCTIONS_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants AS grant_row
    WHERE grant_row.table_schema = 'public'
      AND grant_row.table_name IN ('task_localizations', 'task_localization_jobs')
      AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'TASK_LOCALIZATION_FOUNDATION_GRANT_DRIFT';
  END IF;
END $$;

CREATE FUNCTION public.enqueue_legacy_arabic_task_localizations(p_limit integer DEFAULT 25)
RETURNS TABLE(
  scanned bigint,
  enqueued bigint,
  already_current bigint,
  already_queued bigint,
  unresolved bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_task record;
  v_affected integer;
  v_live_hash text;
  v_live_recipient_resolved boolean;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'INVALID_BACKFILL_BATCH_LIMIT';
  END IF;

  scanned := 0;
  enqueued := 0;
  already_current := 0;
  already_queued := 0;
  unresolved := 0;

  FOR v_task IN
    WITH assessed AS (
      SELECT
        task.id,
        task.company_id,
        encode(extensions.digest(
          convert_to(task.title || E'\n' || coalesce(task.description, ''), 'UTF8'),
          'sha256'
        ), 'hex') AS source_hash,
        btrim(task.title) <> '' AS has_content,
        EXISTS (
          SELECT 1
          FROM public.employees AS employee
          JOIN public.profiles AS profile
            ON profile.employee_id = employee.id
           AND profile.company_id = employee.company_id
          WHERE employee.id = task.assigned_employee_id
            AND employee.company_id = task.company_id
            AND employee.status = 'active'
            AND profile.status = 'active'
            AND profile.preferred_language = 'ar'
        ) AS recipient_resolved
      FROM public.tasks AS task
      WHERE task.status IN ('pending', 'in_progress')
      ORDER BY task.created_at, task.id
    ), classified AS (
      SELECT
        assessed.*,
        EXISTS (
          SELECT 1 FROM public.task_localizations AS localization
          WHERE localization.task_id = assessed.id
            AND localization.company_id = assessed.company_id
            AND localization.language = 'ar'
            AND localization.source_hash = assessed.source_hash
        ) AS is_current,
        EXISTS (
          SELECT 1 FROM public.task_localization_jobs AS job
          WHERE job.task_id = assessed.id
            AND job.company_id = assessed.company_id
            AND job.language = 'ar'
            AND job.source_hash = assessed.source_hash
            AND job.status IN ('pending', 'processing')
        ) AS is_queued
      FROM assessed
    )
    SELECT classified.*
    FROM classified
    ORDER BY
      CASE
        WHEN classified.has_content AND classified.recipient_resolved
          AND NOT classified.is_current AND NOT classified.is_queued THEN 0
        WHEN classified.has_content AND classified.recipient_resolved AND classified.is_current THEN 1
        WHEN classified.has_content AND classified.recipient_resolved AND classified.is_queued THEN 2
        ELSE 3
      END,
      classified.id
    LIMIT p_limit
  LOOP
    scanned := scanned + 1;

    IF NOT v_task.has_content OR NOT v_task.recipient_resolved THEN
      unresolved := unresolved + 1;
      CONTINUE;
    END IF;

    IF v_task.is_current THEN
      already_current := already_current + 1;
      CONTINUE;
    END IF;

    IF v_task.is_queued THEN
      already_queued := already_queued + 1;
      CONTINUE;
    END IF;

    -- Lock and revalidate the canonical source immediately before the upsert.
    -- This prevents an edit or reassignment racing the bounded scan from
    -- replacing a newer job with a stale source hash.
    SELECT
      encode(extensions.digest(
        convert_to(task.title || E'\n' || coalesce(task.description, ''), 'UTF8'),
        'sha256'
      ), 'hex'),
      btrim(task.title) <> '' AND EXISTS (
        SELECT 1
        FROM public.employees AS employee
        JOIN public.profiles AS profile
          ON profile.employee_id = employee.id
         AND profile.company_id = employee.company_id
        WHERE employee.id = task.assigned_employee_id
          AND employee.company_id = task.company_id
          AND employee.status = 'active'
          AND profile.status = 'active'
          AND profile.preferred_language = 'ar'
      )
    INTO v_live_hash, v_live_recipient_resolved
    FROM public.tasks AS task
    WHERE task.id = v_task.id
      AND task.company_id = v_task.company_id
      AND task.status IN ('pending', 'in_progress')
    FOR UPDATE;

    IF NOT FOUND OR v_live_hash IS DISTINCT FROM v_task.source_hash
       OR v_live_recipient_resolved IS DISTINCT FROM true THEN
      unresolved := unresolved + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.task_localization_jobs AS job (
      task_id, company_id, language, source_hash, status, attempt_count,
      available_at, lease_token, lease_expires_at, safe_failure_code, updated_at
    ) VALUES (
      v_task.id, v_task.company_id, 'ar', v_task.source_hash, 'pending', 0,
      clock_timestamp(), NULL, NULL, NULL, clock_timestamp()
    )
    ON CONFLICT (task_id, language) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      source_hash = EXCLUDED.source_hash,
      status = 'pending',
      attempt_count = 0,
      available_at = clock_timestamp(),
      lease_token = NULL,
      lease_expires_at = NULL,
      safe_failure_code = NULL,
      updated_at = clock_timestamp()
    WHERE job.source_hash IS DISTINCT FROM EXCLUDED.source_hash
      AND job.status <> 'processing';

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 1 THEN
      enqueued := enqueued + 1;
    ELSE
      already_queued := already_queued + 1;
    END IF;
  END LOOP;

  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_legacy_arabic_task_localizations(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_legacy_arabic_task_localizations(integer)
  TO service_role;

COMMIT;

-- Rollback guidance: revoke and drop only
-- public.enqueue_legacy_arabic_task_localizations(integer). Existing jobs and
-- translations are durable evidence of completed work and must not be deleted.
