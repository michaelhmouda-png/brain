-- Stage 1B Production-health semantics repair.
-- Forward-only. Historical evidence, tasks, gateways, and tenant rows are preserved.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_system_worker_health_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'workers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name', names.worker_name,'lastStartedAt', runs.last_started_at,'lastSucceededAt', runs.last_succeeded_at,
      'lastFailedAt', runs.last_failed_at,'lastFailureCode', runs.last_failure_code,
      'successCount', COALESCE(runs.success_count,0),'failureCount', COALESCE(runs.failure_count,0)
    ) ORDER BY names.worker_name)
    FROM unnest(ARRAY['notifications','recurring_tasks','weekly_shifts','evidence']) names(worker_name)
    LEFT JOIN public.system_worker_runs runs USING(worker_name)), '[]'::jsonb),
    'queues', jsonb_build_object(
      'notifications', jsonb_build_object(
        'pending',(SELECT count(*) FROM public.notification_outbox WHERE status='pending'),
        'retrying',(SELECT count(*) FROM public.notification_outbox WHERE status='pending' AND attempt_count>0),
        'deadLetter',(SELECT count(*) FROM public.notification_outbox WHERE status='failed'),
        'oldestPendingAt',(SELECT min(created_at) FROM public.notification_outbox WHERE status='pending')),
      'deliveries', jsonb_build_object(
        'pending',(SELECT count(*) FROM public.notification_delivery_jobs WHERE status='pending'),
        'retrying',(SELECT count(*) FROM public.notification_delivery_jobs WHERE status='pending' AND attempt_count>0),
        'deadLetter',(SELECT count(*) FROM public.notification_delivery_jobs WHERE status='failed'),
        'oldestPendingAt',(SELECT min(created_at) FROM public.notification_delivery_jobs WHERE status='pending')),
      'evidence', jsonb_build_object(
        'pending',(SELECT count(*) FROM public.task_evidence_verification_jobs WHERE status='queued'),
        'retrying',(SELECT count(*) FROM public.task_evidence_verification_jobs WHERE status='queued' AND attempt_count>0),
        'deadLetter',(SELECT count(*)
          FROM public.task_evidence_verification_jobs job
          JOIN public.task_evidence evidence ON evidence.id=job.evidence_id AND evidence.company_id=job.company_id
          JOIN public.tasks task ON task.id=evidence.task_id AND task.company_id=evidence.company_id
          WHERE job.status='failed'
            AND evidence.status <> 'human_approved'
            AND task.status NOT IN ('completed','cancelled')),
        'oldestPendingAt',(SELECT min(created_at) FROM public.task_evidence_verification_jobs WHERE status='queued'))
    ),
    'materialization', jsonb_build_object(
      'recurringTasksLastCompletedAt',(SELECT max(completed_at) FROM public.recurring_task_occurrences WHERE completed_at IS NOT NULL),
      'recurringTasksNextDueAt',(SELECT min(next_occurrence_at) FROM public.recurring_task_rules WHERE status='active'),
      'weeklyShiftsLastGeneratedAt',(SELECT max(created_at) FROM public.weekly_shift_generated_shifts),
      'weeklyShiftsLatestLocalDate',(SELECT max(local_date) FROM public.weekly_shift_generated_shifts),
      'activeRecurringTaskRules',(SELECT count(*) FROM public.recurring_task_rules WHERE status='active'),
      'activeWeeklyShiftSeries',(SELECT count(*) FROM public.weekly_shift_schedule_series WHERE status='active')),
    'agents', jsonb_build_object(
      'configured',(SELECT count(*) FROM public.device_gateways WHERE status <> 'disabled'),
      'online',(SELECT count(*) FROM public.device_gateways WHERE status='online' AND last_seen_at >= clock_timestamp()-interval '10 minutes'),
      'offline',(SELECT count(*) FROM public.device_gateways WHERE status IN ('online','offline','error')
        AND (last_seen_at IS NULL OR last_seen_at < clock_timestamp()-interval '10 minutes'))),
    'recurring', jsonb_build_object(
      'failedLast24Hours',(SELECT count(*) FROM public.recurring_task_occurrences
        WHERE outcome='failed' AND completed_at >= clock_timestamp()-interval '24 hours')),
    'observedAt', clock_timestamp()
  )
$$;
ALTER FUNCTION public.get_system_worker_health_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_system_worker_health_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_worker_health_v1() TO service_role;

COMMIT;
