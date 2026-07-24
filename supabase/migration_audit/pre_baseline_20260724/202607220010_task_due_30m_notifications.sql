-- Notification N2: exact 30-minute task reminders.
--
-- Canonical deadline semantics:
--   public.tasks.due_at is timestamptz (an absolute PostgreSQL instant).
--   Legacy date-only due_date rows remain valid but do not qualify for N2.
--
-- N2 replaces generation/materialization of N1 task.due_soon and task.overdue
-- calendar reminders. Existing assignment, reassignment, update, completion,
-- preference, outbox, lease, retry, push, audit, and cron behavior is retained.
-- No task row or Brain quota row is mutated by this migration or its functions.

BEGIN;

DO $notification_n2_preflight$
DECLARE
  v_function regprocedure;
BEGIN
  IF to_regclass('public.tasks') IS NULL
    OR to_regclass('public.employees') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.notifications') IS NULL
    OR to_regclass('public.notification_preferences') IS NULL
    OR to_regclass('public.push_subscriptions') IS NULL
    OR to_regclass('public.notification_outbox') IS NULL
    OR to_regclass('public.notification_delivery_jobs') IS NULL
    OR to_regclass('public.notification_audit') IS NULL THEN
    RAISE EXCEPTION 'NOTIFICATION_N2_REQUIRED_RELATION_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = 'tasks'
      AND column_row.column_name = 'due_at'
      AND column_row.data_type = 'timestamp with time zone'
      AND column_row.is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'NOTIFICATION_N2_EXACT_DEADLINE_UNAVAILABLE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = 'notification_preferences'
      AND column_row.column_name = 'due_reminders'
      AND column_row.data_type = 'boolean'
      AND column_row.is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'NOTIFICATION_N2_DUE_PREFERENCE_DRIFT';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    to_regprocedure('public.generate_task_reminder_obligations()'),
    to_regprocedure('public.materialize_notification_outbox(uuid,uuid)'),
    to_regprocedure('public.claim_notification_delivery(integer)')
  ]
  LOOP
    IF v_function IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid = v_function
        AND procedure.prosecdef
        AND EXISTS (
          SELECT 1
          FROM unnest(coalesce(procedure.proconfig, ARRAY[]::text[])) AS setting(value)
          WHERE setting.value IN ('search_path=', 'search_path=""')
        )
    ) OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
      OR pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'NOTIFICATION_N2_N1_FUNCTION_SECURITY_DRIFT';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid IN (
      'public.notifications'::regclass,
      'public.notification_preferences'::regclass,
      'public.push_subscriptions'::regclass,
      'public.notification_outbox'::regclass,
      'public.notification_delivery_jobs'::regclass,
      'public.notification_audit'::regclass
    )
      AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'NOTIFICATION_N2_N1_FORCED_RLS_DRIFT';
  END IF;

  IF to_regclass('public.tasks_due_at_reminder_scan_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'NOTIFICATION_N2_TARGET_INDEX_ALREADY_EXISTS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notification_outbox AS outbox
    WHERE outbox.event_type = 'task.due_30m'
  ) OR EXISTS (
    SELECT 1
    FROM public.notifications AS notification
    WHERE notification.notification_type = 'task.due_30m'
  ) THEN
    RAISE EXCEPTION 'NOTIFICATION_N2_EVENT_ALREADY_IN_USE';
  END IF;
END
$notification_n2_preflight$;

CREATE INDEX tasks_due_at_reminder_scan_idx
  ON public.tasks(due_at, id)
  WHERE due_at IS NOT NULL
    AND assigned_employee_id IS NOT NULL
    AND status IN ('pending', 'in_progress');

CREATE OR REPLACE FUNCTION public.generate_task_reminder_obligations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_database_now timestamptz := clock_timestamp();
  v_count integer;
BEGIN
  INSERT INTO public.notification_outbox (
    company_id,
    event_key,
    event_type,
    aggregate_type,
    aggregate_id
  )
  SELECT
    task.company_id,
    'task.due_30m:' || task.id::text || ':' ||
      to_char(
        task.due_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
    'task.due_30m',
    'tasks',
    task.id
  FROM public.tasks AS task
  WHERE task.due_at IS NOT NULL
    AND task.assigned_employee_id IS NOT NULL
    AND task.status IN ('pending', 'in_progress')
    AND v_database_now >= task.due_at - interval '30 minutes'
    AND v_database_now < task.due_at
  ON CONFLICT (company_id, event_key) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION public.materialize_notification_outbox(
  p_outbox_id uuid,
  p_lease_token uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_outbox public.notification_outbox%ROWTYPE;
  v_recipient record;
  v_notification_id uuid;
  v_count integer := 0;
  v_category text;
  v_title text;
  v_message text;
  v_route text;
  v_allowed boolean;
  v_in_app boolean;
BEGIN
  SELECT outbox.*
  INTO v_outbox
  FROM public.notification_outbox AS outbox
  WHERE outbox.id = p_outbox_id
    AND outbox.status = 'processing'
    AND outbox.lease_token = p_lease_token
    AND outbox.lease_expires_at >= clock_timestamp()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEASE_NOT_OWNED';
  END IF;

  -- N2 supersedes undelivered N1 calendar-day reminder obligations without
  -- fabricating a recipient-resolution failure or mutating the task.
  IF v_outbox.event_type IN ('task.due_soon', 'task.overdue') THEN
    INSERT INTO public.notification_audit (
      company_id,
      event_type,
      safe_details
    ) VALUES (
      v_outbox.company_id,
      'obligation.superseded',
      jsonb_build_object('eventType', v_outbox.event_type)
    );

    UPDATE public.notification_outbox AS outbox
    SET
      status = 'completed',
      lease_token = NULL,
      lease_expires_at = NULL,
      completed_at = clock_timestamp()
    WHERE outbox.id = v_outbox.id;

    RETURN 0;
  END IF;

  v_category := CASE
    WHEN v_outbox.event_type LIKE 'task.%' THEN 'tasks'
    WHEN v_outbox.event_type LIKE 'announcement.%' THEN 'announcements'
    WHEN v_outbox.event_type LIKE 'maintenance.%' THEN 'maintenance'
    WHEN v_outbox.event_type LIKE 'incident.%' THEN 'incidents'
    WHEN v_outbox.event_type LIKE 'evidence.%' THEN 'evidence'
    ELSE 'system'
  END;

  v_route := CASE v_category
    WHEN 'tasks' THEN '/dashboard/tasks'
    WHEN 'announcements' THEN '/dashboard/announcements'
    WHEN 'maintenance' THEN '/dashboard/maintenance'
    WHEN 'incidents' THEN '/dashboard/incidents'
    WHEN 'evidence' THEN CASE
      WHEN v_outbox.event_type IN (
        'evidence.needs_human_review',
        'evidence.verification_failed'
      ) THEN '/dashboard/evidence-review'
      ELSE '/dashboard/tasks'
    END
    ELSE '/dashboard'
  END;

  v_title := CASE v_outbox.event_type
    WHEN 'task.assigned' THEN 'Task assigned'
    WHEN 'task.reassigned' THEN 'Task assignment changed'
    WHEN 'task.due_30m' THEN 'Task due in 30 minutes.'
    WHEN 'task.completed' THEN 'Task completed'
    WHEN 'announcement.published' THEN 'New announcement'
    WHEN 'maintenance.assigned' THEN 'Maintenance ticket assigned'
    WHEN 'maintenance.urgent_created' THEN 'Urgent maintenance alert'
    WHEN 'incident.reported' THEN 'Incident reported'
    WHEN 'evidence.submitted' THEN 'Task evidence submitted'
    WHEN 'evidence.needs_human_review' THEN 'Evidence needs review'
    WHEN 'evidence.verification_failed' THEN 'Evidence verification failed'
    WHEN 'evidence.human_approved' THEN 'Evidence approved'
    WHEN 'evidence.human_rejected' THEN 'Evidence requires resubmission'
    ELSE 'Operational update'
  END;

  v_message := CASE
    WHEN v_outbox.event_type = 'evidence.human_rejected'
      THEN 'Open HospiBrain to review and resubmit evidence.'
    ELSE 'Open HospiBrain to view this update.'
  END;

  FOR v_recipient IN
    SELECT DISTINCT profile.id AS profile_id
    FROM public.profiles AS profile
    WHERE profile.company_id = v_outbox.company_id
      AND profile.status = 'active'
      AND profile.role IN ('employee', 'manager', 'owner', 'super_admin')
      AND (
        (
          v_outbox.event_type LIKE 'task.%'
          AND v_outbox.event_type <> 'task.due_30m'
          AND EXISTS (
            SELECT 1
            FROM public.tasks AS task
            WHERE task.id = v_outbox.aggregate_id
              AND task.company_id = v_outbox.company_id
              AND task.assigned_employee_id = profile.employee_id
          )
        )
        OR (
          v_outbox.event_type = 'task.due_30m'
          AND EXISTS (
            SELECT 1
            FROM public.tasks AS task
            JOIN public.employees AS employee
              ON employee.id = task.assigned_employee_id
              AND employee.company_id = task.company_id
              AND employee.status = 'active'
            WHERE task.id = v_outbox.aggregate_id
              AND task.company_id = v_outbox.company_id
              AND profile.employee_id = employee.id
              AND profile.company_id = employee.company_id
              AND task.status IN ('pending', 'in_progress')
              AND task.due_at IS NOT NULL
              AND clock_timestamp() < task.due_at
              AND v_outbox.event_key =
                'task.due_30m:' || task.id::text || ':' ||
                to_char(
                  task.due_at AT TIME ZONE 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                )
          )
        )
        OR (
          v_outbox.event_type = 'announcement.published'
          AND EXISTS (
            SELECT 1
            FROM public.announcements AS announcement
            WHERE announcement.id = v_outbox.aggregate_id
              AND announcement.company_id = v_outbox.company_id
              AND (
                announcement.expires_at IS NULL
                OR announcement.expires_at > clock_timestamp()
              )
              AND announcement.created_by_id <> profile.id
              AND (
                coalesce(cardinality(announcement.target_roles), 0) = 0
                OR profile.role = ANY (announcement.target_roles)
              )
          )
        )
        OR (
          v_outbox.event_type = 'maintenance.assigned'
          AND EXISTS (
            SELECT 1
            FROM public.maintenance_tickets AS maintenance
            WHERE maintenance.id = v_outbox.aggregate_id
              AND maintenance.company_id = v_outbox.company_id
              AND maintenance.assigned_to_id = profile.employee_id
          )
        )
        OR (
          v_outbox.event_type IN (
            'maintenance.urgent_created',
            'maintenance.updated',
            'incident.reported',
            'incident.updated',
            'evidence.needs_human_review',
            'evidence.verification_failed'
          )
          AND profile.role IN ('manager', 'owner', 'super_admin')
        )
        OR (
          v_outbox.event_type = 'evidence.submitted'
          AND EXISTS (
            SELECT 1
            FROM public.task_evidence AS evidence
            JOIN public.tasks AS task
              ON task.id = evidence.task_id
              AND task.company_id = evidence.company_id
            WHERE evidence.id = v_outbox.aggregate_id
              AND evidence.company_id = v_outbox.company_id
              AND task.assigned_employee_id = profile.employee_id
          )
        )
        OR (
          v_outbox.event_type IN (
            'evidence.human_approved',
            'evidence.human_rejected'
          )
          AND EXISTS (
            SELECT 1
            FROM public.task_evidence AS evidence
            JOIN public.tasks AS task
              ON task.id = evidence.task_id
              AND task.company_id = evidence.company_id
            WHERE evidence.id = v_outbox.aggregate_id
              AND evidence.company_id = v_outbox.company_id
              AND (
                evidence.submitted_by_profile_id = profile.id
                OR task.assigned_employee_id = profile.employee_id
              )
          )
        )
        OR (
          v_outbox.event_type = 'system.account_ready'
          AND profile.id = v_outbox.aggregate_id
        )
      )
  LOOP
    SELECT
      CASE v_category
        WHEN 'tasks' THEN CASE
          WHEN v_outbox.event_type IN ('task.assigned', 'task.reassigned')
            THEN coalesce(preference.task_assignments, true)
          WHEN v_outbox.event_type = 'task.due_30m'
            THEN coalesce(preference.due_reminders, true)
          ELSE coalesce(preference.task_updates, true)
        END
        WHEN 'announcements' THEN coalesce(preference.announcements, true)
        WHEN 'maintenance' THEN coalesce(preference.maintenance, true)
        WHEN 'incidents' THEN coalesce(preference.incidents, true)
        WHEN 'evidence' THEN coalesce(preference.evidence_review, true)
        ELSE true
      END,
      coalesce(preference.in_app_enabled, true)
    INTO v_allowed, v_in_app
    FROM public.profiles AS profile
    LEFT JOIN public.notification_preferences AS preference
      ON preference.profile_id = profile.id
    WHERE profile.id = v_recipient.profile_id;

    IF v_allowed THEN
      INSERT INTO public.notifications (
        company_id,
        recipient_id,
        title,
        message,
        notification_type,
        related_entity_type,
        related_entity_id,
        status,
        category,
        route,
        event_key,
        is_read
      ) VALUES (
        v_outbox.company_id,
        v_recipient.profile_id,
        v_title,
        v_message,
        v_outbox.event_type,
        v_outbox.aggregate_type,
        v_outbox.aggregate_id,
        CASE WHEN v_in_app THEN 'unread' ELSE 'archived' END,
        v_category,
        v_route,
        v_outbox.event_key,
        NOT v_in_app
      )
      ON CONFLICT (recipient_id, event_key)
        WHERE event_key IS NOT NULL
        DO NOTHING
      RETURNING id INTO v_notification_id;

      IF v_notification_id IS NOT NULL THEN
        v_count := v_count + 1;

        INSERT INTO public.notification_audit (
          company_id,
          notification_id,
          profile_id,
          event_type
        ) VALUES
          (
            v_outbox.company_id,
            v_notification_id,
            v_recipient.profile_id,
            'recipient.resolved'
          ),
          (
            v_outbox.company_id,
            v_notification_id,
            v_recipient.profile_id,
            'notification.created'
          );

        INSERT INTO public.notification_delivery_jobs (
          notification_id,
          subscription_id,
          company_id
        )
        SELECT
          v_notification_id,
          subscription.id,
          v_outbox.company_id
        FROM public.push_subscriptions AS subscription
        JOIN public.notification_preferences AS preference
          ON preference.profile_id = subscription.profile_id
        WHERE subscription.profile_id = v_recipient.profile_id
          AND subscription.company_id = v_outbox.company_id
          AND subscription.revoked_at IS NULL
          AND preference.push_enabled
          AND NOT (
            preference.quiet_hours_enabled
            AND CASE
              WHEN preference.quiet_hours_start <= preference.quiet_hours_end
                THEN
                  (clock_timestamp() AT TIME ZONE preference.timezone)::time
                    >= preference.quiet_hours_start
                  AND
                  (clock_timestamp() AT TIME ZONE preference.timezone)::time
                    < preference.quiet_hours_end
              ELSE
                (clock_timestamp() AT TIME ZONE preference.timezone)::time
                  >= preference.quiet_hours_start
                OR
                (clock_timestamp() AT TIME ZONE preference.timezone)::time
                  < preference.quiet_hours_end
            END
          )
        ON CONFLICT (notification_id, subscription_id) DO NOTHING;

        IF FOUND THEN
          INSERT INTO public.notification_audit (
            company_id,
            notification_id,
            profile_id,
            event_type
          ) VALUES (
            v_outbox.company_id,
            v_notification_id,
            v_recipient.profile_id,
            'push.queued'
          );
        END IF;
      END IF;
    END IF;

    v_notification_id := NULL;
  END LOOP;

  IF v_count = 0 THEN
    INSERT INTO public.notification_audit (
      company_id,
      event_type,
      safe_details
    ) VALUES (
      v_outbox.company_id,
      'recipient.unresolved',
      jsonb_build_object('eventType', v_outbox.event_type)
    );
  END IF;

  UPDATE public.notification_outbox AS outbox
  SET
    status = 'completed',
    lease_token = NULL,
    lease_expires_at = NULL,
    completed_at = clock_timestamp()
  WHERE outbox.id = v_outbox.id;

  RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION public.claim_notification_delivery(
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  job_id uuid,
  lease_token uuid,
  endpoint text,
  p256dh text,
  auth_key text,
  notification_id uuid,
  title text,
  summary text,
  route text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.notification_delivery_jobs%ROWTYPE;
  v_stale record;
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'INVALID_LEASE';
  END IF;

  -- Recheck N2 eligibility before Web Push claim. Stale jobs are terminally
  -- suppressed and their already-created in-app record is archived.
  FOR v_stale IN
    SELECT
      delivery.id AS job_id,
      notification.id AS notification_id,
      notification.company_id
    FROM public.notification_delivery_jobs AS delivery
    JOIN public.notifications AS notification
      ON notification.id = delivery.notification_id
    LEFT JOIN public.tasks AS task
      ON task.id = notification.related_entity_id
      AND task.company_id = notification.company_id
    WHERE notification.notification_type = 'task.due_30m'
      AND (
        delivery.status = 'pending'
        OR (
          delivery.status = 'processing'
          AND delivery.lease_expires_at < clock_timestamp()
        )
      )
      AND (
        task.id IS NULL
        OR task.status NOT IN ('pending', 'in_progress')
        OR task.due_at IS NULL
        OR clock_timestamp() >= task.due_at
        OR notification.event_key IS DISTINCT FROM
          'task.due_30m:' || task.id::text || ':' ||
          to_char(
            task.due_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
      )
    ORDER BY delivery.created_at
    FOR UPDATE OF delivery SKIP LOCKED
    LIMIT 50
  LOOP
    UPDATE public.notification_delivery_jobs AS delivery
    SET
      status = 'failed',
      lease_token = NULL,
      lease_expires_at = NULL,
      last_failure_code = 'REMINDER_NO_LONGER_ELIGIBLE'
    WHERE delivery.id = v_stale.job_id;

    UPDATE public.notifications AS notification
    SET
      status = 'archived',
      is_read = true,
      archived_at = coalesce(notification.archived_at, clock_timestamp()),
      updated_at = clock_timestamp()
    WHERE notification.id = v_stale.notification_id;

    INSERT INTO public.notification_audit (
      company_id,
      notification_id,
      event_type,
      safe_details
    ) VALUES (
      v_stale.company_id,
      v_stale.notification_id,
      'reminder.suppressed',
      jsonb_build_object('reason', 'no_longer_eligible')
    );
  END LOOP;

  SELECT delivery.*
  INTO v_job
  FROM public.notification_delivery_jobs AS delivery
  JOIN public.push_subscriptions AS subscription
    ON subscription.id = delivery.subscription_id
    AND subscription.revoked_at IS NULL
  JOIN public.notifications AS notification
    ON notification.id = delivery.notification_id
  WHERE (
      (
        delivery.status = 'pending'
        AND delivery.available_at <= clock_timestamp()
      )
      OR (
        delivery.status = 'processing'
        AND delivery.lease_expires_at < clock_timestamp()
      )
    )
    AND delivery.attempt_count < 5
    AND (
      notification.notification_type <> 'task.due_30m'
      OR EXISTS (
        SELECT 1
        FROM public.tasks AS task
        WHERE task.id = notification.related_entity_id
          AND task.company_id = notification.company_id
          AND task.status IN ('pending', 'in_progress')
          AND task.due_at IS NOT NULL
          AND clock_timestamp() < task.due_at
          AND notification.event_key =
            'task.due_30m:' || task.id::text || ':' ||
            to_char(
              task.due_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
      )
    )
  ORDER BY delivery.available_at, delivery.created_at
  FOR UPDATE OF delivery SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.notification_delivery_jobs AS delivery
  SET
    status = 'processing',
    attempt_count = delivery.attempt_count + 1,
    lease_token = v_token,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  WHERE delivery.id = v_job.id;

  RETURN QUERY
  SELECT
    v_job.id,
    v_token,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_key,
    notification.id,
    notification.title,
    'Open HospiBrain to view this notification.'::text,
    notification.route
  FROM public.push_subscriptions AS subscription
  JOIN public.notifications AS notification
    ON notification.id = v_job.notification_id
  WHERE subscription.id = v_job.subscription_id;
END
$$;

REVOKE ALL ON FUNCTION public.generate_task_reminder_obligations()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.materialize_notification_outbox(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_notification_delivery(integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.generate_task_reminder_obligations()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.materialize_notification_outbox(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_delivery(integer)
  TO service_role;

DO $notification_n2_postcondition$
DECLARE
  v_function regprocedure;
BEGIN
  IF to_regclass('public.tasks_due_at_reminder_scan_idx') IS NULL THEN
    RAISE EXCEPTION 'NOTIFICATION_N2_SCAN_INDEX_MISSING';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    to_regprocedure('public.generate_task_reminder_obligations()'),
    to_regprocedure('public.materialize_notification_outbox(uuid,uuid)'),
    to_regprocedure('public.claim_notification_delivery(integer)')
  ]
  LOOP
    IF v_function IS NULL
      OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
      OR pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'NOTIFICATION_N2_FUNCTION_GRANT_POSTCONDITION_FAILED';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.notifications'::regclass),
      ('public.notification_preferences'::regclass),
      ('public.push_subscriptions'::regclass),
      ('public.notification_outbox'::regclass),
      ('public.notification_delivery_jobs'::regclass),
      ('public.notification_audit'::regclass)
    ) AS required(relation_oid)
    JOIN pg_catalog.pg_class AS relation ON relation.oid = required.relation_oid
    WHERE NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'NOTIFICATION_N2_FORCED_RLS_POSTCONDITION_FAILED';
  END IF;
END
$notification_n2_postcondition$;

COMMIT;

-- Deployment order:
--   1. Confirm brain-production, backup/PITR, and the N1 every-minute cron job.
--   2. Apply this migration alone; do not edit or reapply migration 009.
--   3. Verify function signatures/grants, forced RLS, scan index, and cron job.
--   4. Create a future pending test task with due_at 10-29 minutes away and a
--      same-company active employee/profile link; do not use production PII.
--   5. Verify one task.due_30m outbox event, one in-app notification, and one
--      push job outside quiet hours. Re-run generation and prove no duplicates.
--   6. Verify preference-off, quiet-hours, reschedule, and terminal suppression.
--
-- Recovery:
--   Stop the worker if validation fails. Do not mutate tasks or delete durable
--   notification evidence. Restore the prior N1 function definitions only via
--   a separately reviewed forward corrective migration; never edit migration 009.
