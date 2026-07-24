/*
 * Camera Evidence C3 pilot worker schedule.
 * The bearer value is resolved from Supabase Vault by the cron execution and
 * is never materialized in this migration or in cron.job.command.
 */

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $validation$
DECLARE
  v_secret_count bigint;
BEGIN
  SELECT count(*)
    INTO v_secret_count
    FROM vault.secrets AS secret_row
   WHERE secret_row.name = 'task_evidence_worker_secret';

  IF v_secret_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'Camera evidence worker scheduling requires exactly one Vault secret named task_evidence_worker_secret; found %s.',
        v_secret_count
      );
  END IF;
END;
$validation$;

DO $replace_job$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT scheduled_job.jobid
      FROM cron.job AS scheduled_job
     WHERE scheduled_job.jobname = 'camera-evidence-worker-every-minute'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END;
$replace_job$;

SELECT cron.schedule(
  'camera-evidence-worker-every-minute',
  '* * * * *',
  $worker_request$
    SELECT net.http_post(
      url := 'https://www.hospibrain.com/api/internal/task-evidence-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT runtime_secret.decrypted_secret
            FROM vault.decrypted_secrets AS runtime_secret
           WHERE runtime_secret.name = 'task_evidence_worker_secret'
        )
      ),
      body := '{}'::jsonb
    );
  $worker_request$
);

/*
 * Safe post-deployment verification queries. Run these manually; they do not
 * reveal the Vault value and do not mutate scheduler or application state.
 *
 * SELECT jobid, jobname, schedule, active, command
 *   FROM cron.job
 *  WHERE jobname = 'camera-evidence-worker-every-minute';
 *
 * SELECT jobid, status, return_message, start_time, end_time
 *   FROM cron.job_run_details
 *  WHERE jobid IN (
 *    SELECT jobid FROM cron.job
 *     WHERE jobname = 'camera-evidence-worker-every-minute'
 *  )
 *  ORDER BY start_time DESC
 *  LIMIT 20;
 *
 * SELECT id AS request_id, status_code, timed_out, error_msg, created
 *   FROM net._http_response
 *  ORDER BY created DESC
 *  LIMIT 20;
 */
