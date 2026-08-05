-- Tenant-neutral worker telemetry and canonical queue health for Stage 1A.
-- Forward-only. Does not mutate business records or queued work.
BEGIN;

CREATE TABLE public.system_worker_runs (
  worker_name text PRIMARY KEY CHECK (worker_name IN ('notifications','recurring_tasks','weekly_shifts','evidence')),
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_failure_code text CHECK (last_failure_code IS NULL OR char_length(last_failure_code) <= 80),
  success_count bigint NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failure_count bigint NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.system_worker_runs OWNER TO postgres;
ALTER TABLE public.system_worker_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_worker_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.system_worker_runs FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_system_worker_run_v1(
  p_worker_name text,
  p_started_at timestamptz,
  p_outcome text,
  p_failure_code text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_worker_name NOT IN ('notifications','recurring_tasks','weekly_shifts','evidence')
    OR p_outcome NOT IN ('success','failure')
    OR p_started_at IS NULL
    OR p_started_at > clock_timestamp() + interval '1 minute'
    OR (p_outcome = 'success' AND p_failure_code IS NOT NULL)
    OR (p_outcome = 'failure' AND (p_failure_code IS NULL OR char_length(p_failure_code) NOT BETWEEN 1 AND 80)) THEN
    RAISE EXCEPTION 'WORKER_TELEMETRY_INVALID';
  END IF;
  INSERT INTO public.system_worker_runs(
    worker_name,last_started_at,last_succeeded_at,last_failed_at,last_failure_code,success_count,failure_count
  ) VALUES (
    p_worker_name,p_started_at,
    CASE WHEN p_outcome='success' THEN clock_timestamp() END,
    CASE WHEN p_outcome='failure' THEN clock_timestamp() END,
    CASE WHEN p_outcome='failure' THEN p_failure_code END,
    CASE WHEN p_outcome='success' THEN 1 ELSE 0 END,
    CASE WHEN p_outcome='failure' THEN 1 ELSE 0 END
  )
  ON CONFLICT (worker_name) DO UPDATE SET
    last_started_at = greatest(public.system_worker_runs.last_started_at, EXCLUDED.last_started_at),
    last_succeeded_at = CASE WHEN p_outcome='success' THEN clock_timestamp() ELSE public.system_worker_runs.last_succeeded_at END,
    last_failed_at = CASE WHEN p_outcome='failure' THEN clock_timestamp() ELSE public.system_worker_runs.last_failed_at END,
    last_failure_code = CASE WHEN p_outcome='failure' THEN p_failure_code ELSE public.system_worker_runs.last_failure_code END,
    success_count = public.system_worker_runs.success_count + CASE WHEN p_outcome='success' THEN 1 ELSE 0 END,
    failure_count = public.system_worker_runs.failure_count + CASE WHEN p_outcome='failure' THEN 1 ELSE 0 END,
    updated_at = clock_timestamp();
END $$;
ALTER FUNCTION public.record_system_worker_run_v1(text,timestamptz,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_system_worker_run_v1(text,timestamptz,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_system_worker_run_v1(text,timestamptz,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_system_worker_health_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'workers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name', names.worker_name,
      'lastStartedAt', runs.last_started_at,
      'lastSucceededAt', runs.last_succeeded_at,
      'lastFailedAt', runs.last_failed_at,
      'lastFailureCode', runs.last_failure_code,
      'successCount', COALESCE(runs.success_count,0),
      'failureCount', COALESCE(runs.failure_count,0)
    ) ORDER BY names.worker_name)
    FROM unnest(ARRAY['notifications','recurring_tasks','weekly_shifts','evidence']) names(worker_name)
    LEFT JOIN public.system_worker_runs runs USING(worker_name)), '[]'::jsonb),
    'queues', jsonb_build_object(
      'notifications', jsonb_build_object(
        'pending', (SELECT count(*) FROM public.notification_outbox WHERE status='pending'),
        'retrying', (SELECT count(*) FROM public.notification_outbox WHERE status='pending' AND attempt_count>0),
        'deadLetter', (SELECT count(*) FROM public.notification_outbox WHERE status='failed'),
        'oldestPendingAt', (SELECT min(created_at) FROM public.notification_outbox WHERE status='pending')
      ),
      'deliveries', jsonb_build_object(
        'pending', (SELECT count(*) FROM public.notification_delivery_jobs WHERE status='pending'),
        'retrying', (SELECT count(*) FROM public.notification_delivery_jobs WHERE status='pending' AND attempt_count>0),
        'deadLetter', (SELECT count(*) FROM public.notification_delivery_jobs WHERE status='failed'),
        'oldestPendingAt', (SELECT min(created_at) FROM public.notification_delivery_jobs WHERE status='pending')
      ),
      'evidence', jsonb_build_object(
        'pending', (SELECT count(*) FROM public.task_evidence_verification_jobs WHERE status='queued'),
        'retrying', (SELECT count(*) FROM public.task_evidence_verification_jobs WHERE status='queued' AND attempt_count>0),
        'deadLetter', (SELECT count(*) FROM public.task_evidence_verification_jobs WHERE status='failed'),
        'oldestPendingAt', (SELECT min(created_at) FROM public.task_evidence_verification_jobs WHERE status='queued')
      )
    ),
    'materialization', jsonb_build_object(
      'recurringTasksLastCompletedAt', (SELECT max(completed_at) FROM public.recurring_task_occurrences WHERE completed_at IS NOT NULL),
      'recurringTasksNextDueAt', (SELECT min(next_occurrence_at) FROM public.recurring_task_rules WHERE status='active'),
      'weeklyShiftsLastGeneratedAt', (SELECT max(created_at) FROM public.weekly_shift_generated_shifts),
      'weeklyShiftsLatestLocalDate', (SELECT max(local_date) FROM public.weekly_shift_generated_shifts),
      'activeRecurringTaskRules', (SELECT count(*) FROM public.recurring_task_rules WHERE status='active'),
      'activeWeeklyShiftSeries', (SELECT count(*) FROM public.weekly_shift_schedule_series WHERE status='active')
    ),
    'observedAt', clock_timestamp()
  )
$$;
ALTER FUNCTION public.get_system_worker_health_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_system_worker_health_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_worker_health_v1() TO service_role;

COMMIT;
