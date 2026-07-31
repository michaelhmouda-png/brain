-- Recurring Task Engine V1 materialization repair.
-- Forward-only, creates no business rows and performs no backfill.

BEGIN;

CREATE OR REPLACE FUNCTION private.create_recurring_canonical_task(
  p_occurrence public.recurring_task_occurrences,
  p_rule public.recurring_task_rules,
  p_version public.recurring_task_rule_versions,
  p_employee_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_task_id uuid:=md5(p_occurrence.id::text||':'||p_employee_id::text||':0')::uuid;
  v_template jsonb:=p_version.task_template;
  v_task_inserted boolean:=false;
  v_provenance_inserted boolean:=false;
BEGIN
  INSERT INTO public.tasks(
    id,company_id,title,description,assigned_employee_id,priority,status,
    due_date,due_at,location_id,created_by
  ) VALUES(
    v_task_id,p_rule.company_id,v_template->>'title',nullif(v_template->>'description',''),
    p_employee_id,v_template->>'priority','pending',
    (p_occurrence.due_at AT TIME ZONE p_rule.timezone)::date,p_occurrence.due_at,
    p_rule.location_id,p_rule.created_by_profile_id
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING true INTO v_task_inserted;

  IF NOT EXISTS (
    SELECT 1 FROM public.tasks AS task
    WHERE task.id=v_task_id
      AND task.company_id=p_rule.company_id
      AND task.title=v_template->>'title'
      AND task.description IS NOT DISTINCT FROM nullif(v_template->>'description','')
      AND task.assigned_employee_id=p_employee_id
      AND task.priority=v_template->>'priority'
      AND task.status='pending'
      AND task.due_date=(p_occurrence.due_at AT TIME ZONE p_rule.timezone)::date
      AND task.due_at=p_occurrence.due_at
      AND task.location_id IS NOT DISTINCT FROM p_rule.location_id
      AND task.created_by=p_rule.created_by_profile_id
  ) THEN
    RAISE EXCEPTION 'RECURRING_TASK_ID_CONFLICT' USING ERRCODE='23505';
  END IF;

  INSERT INTO public.recurring_task_generated_tasks(
    occurrence_id,company_id,assigned_employee_id,task_id,evidence_required
  ) VALUES(
    p_occurrence.id,p_rule.company_id,p_employee_id,v_task_id,
    coalesce((v_template->>'evidenceRequired')::boolean,false)
  )
  ON CONFLICT (occurrence_id,assigned_employee_id,template_position) DO NOTHING
  RETURNING true INTO v_provenance_inserted;

  IF NOT EXISTS (
    SELECT 1 FROM public.recurring_task_generated_tasks AS generated
    WHERE generated.occurrence_id=p_occurrence.id
      AND generated.company_id=p_rule.company_id
      AND generated.assigned_employee_id=p_employee_id
      AND generated.template_position=0
      AND generated.task_id=v_task_id
      AND generated.evidence_required=coalesce((v_template->>'evidenceRequired')::boolean,false)
  ) THEN
    RAISE EXCEPTION 'RECURRING_PROVENANCE_CONFLICT' USING ERRCODE='23505';
  END IF;

  IF jsonb_typeof(v_template->'countRequirement')='object' THEN
    INSERT INTO public.task_evidence_count_requirements(
      task_id,company_id,count_required,count_label,canonical_unit,damaged_quantity_requested,
      allow_decimals,employee_instructions,created_by_profile_id,updated_by_profile_id
    ) VALUES(
      v_task_id,p_rule.company_id,true,v_template#>>'{countRequirement,countLabel}',
      v_template#>>'{countRequirement,unit}',
      coalesce((v_template#>>'{countRequirement,damagedQuantityRequested}')::boolean,false),
      coalesce((v_template#>>'{countRequirement,allowDecimals}')::boolean,false),
      nullif(v_template#>>'{countRequirement,instructions}',''),
      p_rule.created_by_profile_id,p_rule.created_by_profile_id
    ) ON CONFLICT (task_id) DO NOTHING;

    IF NOT EXISTS (
      SELECT 1 FROM public.task_evidence_count_requirements AS requirement
      WHERE requirement.task_id=v_task_id
        AND requirement.company_id=p_rule.company_id
        AND requirement.count_required
        AND requirement.count_label=v_template#>>'{countRequirement,countLabel}'
        AND requirement.canonical_unit=v_template#>>'{countRequirement,unit}'
        AND requirement.damaged_quantity_requested=
          coalesce((v_template#>>'{countRequirement,damagedQuantityRequested}')::boolean,false)
        AND requirement.allow_decimals=
          coalesce((v_template#>>'{countRequirement,allowDecimals}')::boolean,false)
        AND requirement.employee_instructions IS NOT DISTINCT FROM
          nullif(v_template#>>'{countRequirement,instructions}','')
    ) THEN
      RAISE EXCEPTION 'RECURRING_COUNT_REQUIREMENT_CONFLICT' USING ERRCODE='23505';
    END IF;
  END IF;

  -- The canonical public.tasks triggers create the single assignment notification
  -- obligation and the Arabic localization job when the employee requires one.

  INSERT INTO public.recurring_task_reminders(
    company_id,occurrence_id,task_id,assigned_employee_id,offset_minutes,remind_at
  )
  SELECT p_rule.company_id,p_occurrence.id,v_task_id,p_employee_id,offset_value,
    p_occurrence.due_at-make_interval(mins=>offset_value)
  FROM unnest(p_version.reminder_offsets_minutes) AS offset_value
  ON CONFLICT(task_id,offset_minutes) DO NOTHING;

  IF coalesce(v_task_inserted,false) OR coalesce(v_provenance_inserted,false) THEN
    INSERT INTO public.recurring_task_audit_events(
      company_id,rule_id,occurrence_id,event_type,safe_details
    ) VALUES(
      p_rule.company_id,p_rule.id,p_occurrence.id,'task.created',
      jsonb_build_object('taskId',v_task_id)
    );
  END IF;

  -- Counted success requires both canonical rows to exist in this transaction.
  IF NOT EXISTS (SELECT 1 FROM public.tasks AS task WHERE task.id=v_task_id)
    OR NOT EXISTS (
      SELECT 1 FROM public.recurring_task_generated_tasks AS generated
      WHERE generated.occurrence_id=p_occurrence.id
        AND generated.assigned_employee_id=p_employee_id
        AND generated.template_position=0
        AND generated.task_id=v_task_id
    ) THEN
    RAISE EXCEPTION 'RECURRING_TASK_PERSISTENCE_FAILED' USING ERRCODE='23514';
  END IF;

  RETURN v_task_id;
END $$;
ALTER FUNCTION private.create_recurring_canonical_task(
  public.recurring_task_occurrences,public.recurring_task_rules,
  public.recurring_task_rule_versions,uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.create_recurring_canonical_task(
  public.recurring_task_occurrences,public.recurring_task_rules,
  public.recurring_task_rule_versions,uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.materialize_recurring_task_occurrences(
  p_batch_limit integer DEFAULT 10,p_horizon_hours integer DEFAULT 24,
  p_lease_seconds integer DEFAULT 120
) RETURNS TABLE(processed integer,created_tasks integer,unresolved integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_now timestamptz:=clock_timestamp();
  v_processed integer:=0;
  v_created integer:=0;
  v_unresolved integer:=0;
  v_rule public.recurring_task_rules;
  v_version public.recurring_task_rule_versions;
  v_date date;
  v_local timestamp;
  v_due timestamptz;
  v_occ public.recurring_task_occurrences;
  v_employee record;
  v_count integer;
  v_rotation integer;
  v_previous integer;
  v_occ_created integer;
  v_task_id uuid;
  v_task_was_present boolean;
  v_retry_date date;
  v_retry_pending boolean;
BEGIN
  IF p_batch_limit NOT BETWEEN 1 AND 50
    OR p_horizon_hours NOT BETWEEN 1 AND 24
    OR p_lease_seconds NOT BETWEEN 30 AND 600
  THEN
    RAISE EXCEPTION 'RECURRING_WORKER_INPUT_INVALID';
  END IF;

  FOR v_rule IN
    SELECT rule.* FROM public.recurring_task_rules AS rule
    WHERE rule.status='active' ORDER BY rule.id
  LOOP
    EXIT WHEN v_processed>=p_batch_limit;
    SELECT version.* INTO v_version
    FROM public.recurring_task_rule_versions AS version
    WHERE version.rule_id=v_rule.id AND version.version=v_rule.current_version;
    v_date:=(v_now AT TIME ZONE v_rule.timezone)::date;
    SELECT min(occurrence.local_occurrence_at::date) INTO v_retry_date
    FROM public.recurring_task_occurrences AS occurrence
    WHERE occurrence.rule_id=v_rule.id
      AND occurrence.rule_version=v_version.version
      AND occurrence.outcome='pending'
      AND occurrence.attempt_count<5;
    IF v_retry_date IS NOT NULL AND v_retry_date<v_date THEN
      v_date:=v_retry_date;
    END IF;

    WHILE v_date<=((v_now+make_interval(hours=>p_horizon_hours)) AT TIME ZONE v_rule.timezone)::date LOOP
      EXIT WHEN v_processed>=p_batch_limit;
      IF v_date>=v_version.start_date
        AND (v_version.end_date IS NULL OR v_date<=v_version.end_date)
        AND private.recurring_day_matches(v_version.recurrence,v_date)
      THEN
        BEGIN
          v_local:=private.recurring_local_occurrence(v_rule,v_version,v_date);
          v_due:=private.strict_local_to_utc(v_local,v_rule.timezone);
          SELECT EXISTS(
            SELECT 1 FROM public.recurring_task_occurrences AS occurrence
            WHERE occurrence.rule_id=v_rule.id
              AND occurrence.rule_version=v_version.version
              AND occurrence.local_occurrence_at=v_local
              AND occurrence.outcome='pending'
              AND occurrence.attempt_count<5
          ) INTO v_retry_pending;
          IF (v_due BETWEEN v_now-interval '15 minutes'
            AND v_now+make_interval(hours=>p_horizon_hours)) OR v_retry_pending
          THEN
            INSERT INTO public.recurring_task_occurrences(
              rule_id,rule_version,company_id,location_id,local_occurrence_at,timezone,due_at
            ) VALUES(
              v_rule.id,v_version.version,v_rule.company_id,v_rule.location_id,
              v_local,v_rule.timezone,v_due
            ) ON CONFLICT(rule_id,rule_version,local_occurrence_at) DO NOTHING;

            SELECT occurrence.* INTO v_occ
            FROM public.recurring_task_occurrences AS occurrence
            WHERE occurrence.rule_id=v_rule.id
              AND occurrence.rule_version=v_version.version
              AND occurrence.local_occurrence_at=v_local
            FOR UPDATE;
            -- Existing failed attempts keep their original canonical instant.
            v_due:=v_occ.due_at;

            IF v_occ.outcome='materialized'
              OR v_occ.outcome IN ('no_eligible_employee','invalid_schedule','dst_failure')
            THEN
              INSERT INTO public.recurring_task_audit_events(
                company_id,rule_id,occurrence_id,event_type
              ) VALUES(
                v_rule.company_id,v_rule.id,v_occ.id,'occurrence.idempotent_replay'
              );
            ELSE
              v_occ_created:=0;
              UPDATE public.recurring_task_occurrences AS occurrence
              SET outcome='processing',attempt_count=occurrence.attempt_count+1,
                lease_token=gen_random_uuid(),
                lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),
                safe_failure_code=NULL,completed_at=NULL
              WHERE occurrence.id=v_occ.id;

              SELECT count(*) INTO v_count
              FROM public.employees AS employee
              WHERE employee.company_id=v_rule.company_id
                AND employee.status='active'
                AND (v_rule.location_id IS NULL OR employee.location_id=v_rule.location_id)
                AND (nullif(v_version.workforce->>'departmentId','') IS NULL
                  OR employee.department_id=(v_version.workforce->>'departmentId')::uuid)
                AND (nullif(v_version.workforce->>'employeeRole','') IS NULL
                  OR lower(employee.role)=lower(v_version.workforce->>'employeeRole'))
                AND (nullif(v_version.workforce->>'specificEmployeeId','') IS NULL
                  OR employee.id=(v_version.workforce->>'specificEmployeeId')::uuid)
                AND EXISTS(
                  SELECT 1 FROM public.shifts AS shift
                  WHERE shift.company_id=v_rule.company_id
                    AND shift.employee_id=employee.id
                    AND shift.status='scheduled'
                    AND (
                      (
                        shift.starts_at IS NOT NULL AND shift.ends_at IS NOT NULL
                        AND (v_rule.location_id IS NULL OR shift.location_id=v_rule.location_id)
                        AND v_due BETWEEN shift.starts_at AND shift.ends_at
                      )
                      OR (
                        shift.starts_at IS NULL AND shift.ends_at IS NULL
                        AND shift.shift_date=v_local::date
                        AND (
                          (shift.end_time>shift.start_time
                            AND v_local::time BETWEEN shift.start_time AND shift.end_time)
                          OR (shift.end_time<=shift.start_time
                            AND (v_local::time>=shift.start_time OR v_local::time<=shift.end_time))
                        )
                      )
                    )
                );

              UPDATE public.recurring_task_occurrences AS occurrence
              SET eligible_count=v_count WHERE occurrence.id=v_occ.id;

              IF v_count=0 THEN
                UPDATE public.recurring_task_occurrences AS occurrence
                SET outcome='no_eligible_employee',completed_at=clock_timestamp(),
                  lease_token=NULL,lease_expires_at=NULL,
                  safe_failure_code='NO_ELIGIBLE_EMPLOYEE',created_task_count=0,
                  selected_employee_id=NULL,selection_reason=NULL
                WHERE occurrence.id=v_occ.id;
                INSERT INTO public.recurring_task_audit_events(
                  company_id,rule_id,occurrence_id,event_type
                ) VALUES(
                  v_rule.company_id,v_rule.id,v_occ.id,'occurrence.no_eligible_employee'
                );
                INSERT INTO public.notification_outbox(
                  company_id,event_key,event_type,aggregate_type,aggregate_id
                ) VALUES(
                  v_rule.company_id,'recurring.no_eligible:'||v_occ.id,
                  'recurring.no_eligible_employee','recurring_task_occurrences',v_occ.id
                ) ON CONFLICT(company_id,event_key) DO NOTHING;
                v_unresolved:=v_unresolved+1;
              ELSE
                IF v_version.assignment_mode='one_matching_employee_on_shift' THEN
                  SELECT count(*) INTO v_previous
                  FROM public.recurring_task_occurrences AS occurrence
                  WHERE occurrence.rule_id=v_rule.id
                    AND occurrence.outcome='materialized'
                    AND occurrence.local_occurrence_at<v_local;
                  v_rotation:=v_previous%v_count;
                ELSE
                  v_rotation:=NULL;
                END IF;

                FOR v_employee IN
                  SELECT employee.id,
                    row_number() OVER(ORDER BY employee.id)-1 AS position
                  FROM public.employees AS employee
                  WHERE employee.company_id=v_rule.company_id
                    AND employee.status='active'
                    AND (v_rule.location_id IS NULL OR employee.location_id=v_rule.location_id)
                    AND (nullif(v_version.workforce->>'departmentId','') IS NULL
                      OR employee.department_id=(v_version.workforce->>'departmentId')::uuid)
                    AND (nullif(v_version.workforce->>'employeeRole','') IS NULL
                      OR lower(employee.role)=lower(v_version.workforce->>'employeeRole'))
                    AND (nullif(v_version.workforce->>'specificEmployeeId','') IS NULL
                      OR employee.id=(v_version.workforce->>'specificEmployeeId')::uuid)
                    AND EXISTS(
                      SELECT 1 FROM public.shifts AS shift
                      WHERE shift.company_id=v_rule.company_id
                        AND shift.employee_id=employee.id
                        AND shift.status='scheduled'
                        AND (
                          (
                            shift.starts_at IS NOT NULL AND shift.ends_at IS NOT NULL
                            AND (v_rule.location_id IS NULL OR shift.location_id=v_rule.location_id)
                            AND v_due BETWEEN shift.starts_at AND shift.ends_at
                          )
                          OR (
                            shift.starts_at IS NULL AND shift.ends_at IS NULL
                            AND shift.shift_date=v_local::date
                            AND (
                              (shift.end_time>shift.start_time
                                AND v_local::time BETWEEN shift.start_time AND shift.end_time)
                              OR (shift.end_time<=shift.start_time
                                AND (v_local::time>=shift.start_time OR v_local::time<=shift.end_time))
                            )
                          )
                        )
                    )
                  ORDER BY employee.id
                LOOP
                  IF v_version.assignment_mode<>'one_matching_employee_on_shift'
                    OR v_employee.position=v_rotation
                  THEN
                    v_task_id:=md5(v_occ.id::text||':'||v_employee.id::text||':0')::uuid;
                    SELECT EXISTS(
                      SELECT 1 FROM public.tasks AS task WHERE task.id=v_task_id
                    ) INTO v_task_was_present;

                    v_task_id:=private.create_recurring_canonical_task(
                      v_occ,v_rule,v_version,v_employee.id
                    );

                    IF NOT EXISTS(
                      SELECT 1 FROM public.tasks AS task
                      JOIN public.recurring_task_generated_tasks AS generated
                        ON generated.task_id=task.id
                      WHERE task.id=v_task_id
                        AND task.company_id=v_rule.company_id
                        AND generated.occurrence_id=v_occ.id
                        AND generated.company_id=v_rule.company_id
                        AND generated.assigned_employee_id=v_employee.id
                        AND generated.template_position=0
                    ) THEN
                      RAISE EXCEPTION 'RECURRING_TASK_PERSISTENCE_FAILED' USING ERRCODE='23514';
                    END IF;

                    IF NOT v_task_was_present THEN
                      v_occ_created:=v_occ_created+1;
                    END IF;
                  END IF;
                END LOOP;

                UPDATE public.recurring_task_occurrences AS occurrence
                SET outcome='materialized',rotation_index=v_rotation,
                  selected_employee_id=CASE
                    WHEN v_version.assignment_mode IN (
                      'one_matching_employee_on_shift','specific_employee_if_on_shift'
                    )
                    THEN (
                      SELECT generated.assigned_employee_id
                      FROM public.recurring_task_generated_tasks AS generated
                      WHERE generated.occurrence_id=v_occ.id
                      ORDER BY generated.template_position,generated.assigned_employee_id
                      LIMIT 1
                    ) ELSE NULL END,
                  selection_reason=CASE
                    WHEN v_version.assignment_mode='one_matching_employee_on_shift'
                    THEN 'stable_employee_uuid_order_previous_occurrence_modulo'
                    ELSE v_version.assignment_mode END,
                  created_task_count=(
                    SELECT count(*) FROM public.recurring_task_generated_tasks AS generated
                    WHERE generated.occurrence_id=v_occ.id
                  ),
                  completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,
                  safe_failure_code=NULL
                WHERE occurrence.id=v_occ.id;

                IF NOT EXISTS(
                  SELECT 1 FROM public.recurring_task_occurrences AS occurrence
                  WHERE occurrence.id=v_occ.id
                    AND occurrence.outcome='materialized'
                    AND occurrence.created_task_count=(
                      SELECT count(*)
                      FROM public.recurring_task_generated_tasks AS generated
                      WHERE generated.occurrence_id=v_occ.id
                    )
                    AND occurrence.created_task_count>0
                ) THEN
                  RAISE EXCEPTION 'RECURRING_OCCURRENCE_VERIFICATION_FAILED' USING ERRCODE='23514';
                END IF;

                INSERT INTO public.recurring_task_audit_events(
                  company_id,rule_id,occurrence_id,event_type,safe_details
                ) VALUES(
                  v_rule.company_id,v_rule.id,v_occ.id,'occurrence.materialized',
                  jsonb_build_object('eligibleCount',v_count,'rotationIndex',v_rotation)
                );

                -- Aggregate only after the task, provenance, occurrence, and audit are verified.
                v_created:=v_created+v_occ_created;
              END IF;
              v_processed:=v_processed+1;
            END IF;
          END IF;
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
          v_occ:=NULL;
          INSERT INTO public.recurring_task_occurrences(
            rule_id,rule_version,company_id,location_id,local_occurrence_at,timezone,
            outcome,safe_failure_code,completed_at
          ) VALUES(
            v_rule.id,v_version.version,v_rule.company_id,v_rule.location_id,
            coalesce(v_local,v_date::timestamp),v_rule.timezone,
            CASE WHEN SQLERRM='RECURRING_DST_TIME_INVALID'
              THEN 'dst_failure' ELSE 'invalid_schedule' END,
            CASE WHEN SQLERRM='RECURRING_DST_TIME_INVALID'
              THEN 'DST_TIME_INVALID' ELSE 'OPERATING_HOURS_MISSING' END,
            clock_timestamp()
          ) ON CONFLICT(rule_id,rule_version,local_occurrence_at) DO UPDATE
          SET outcome=EXCLUDED.outcome,
            safe_failure_code=EXCLUDED.safe_failure_code,
            completed_at=EXCLUDED.completed_at,
            lease_token=NULL,lease_expires_at=NULL
          WHERE public.recurring_task_occurrences.outcome IN ('pending','processing')
          RETURNING * INTO v_occ;
          IF v_occ.id IS NOT NULL THEN
            v_unresolved:=v_unresolved+1;
            v_processed:=v_processed+1;
          END IF;
        WHEN OTHERS THEN
          INSERT INTO public.recurring_task_occurrences(
            rule_id,rule_version,company_id,location_id,local_occurrence_at,timezone,due_at,
            outcome,attempt_count,safe_failure_code
          ) VALUES(
            v_rule.id,v_version.version,v_rule.company_id,v_rule.location_id,
            coalesce(v_local,v_date::timestamp),v_rule.timezone,v_due,'pending',1,
            'GENERATION_FAILED_'||SQLSTATE
          )
          ON CONFLICT(rule_id,rule_version,local_occurrence_at) DO UPDATE
          SET attempt_count=public.recurring_task_occurrences.attempt_count+1,
            outcome=CASE
              WHEN public.recurring_task_occurrences.attempt_count+1>=5 THEN 'failed'
              ELSE 'pending' END,
            safe_failure_code='GENERATION_FAILED_'||SQLSTATE,
            lease_token=NULL,lease_expires_at=NULL,
            completed_at=CASE
              WHEN public.recurring_task_occurrences.attempt_count+1>=5
              THEN clock_timestamp() ELSE NULL END;
          SELECT occurrence.* INTO v_occ
          FROM public.recurring_task_occurrences AS occurrence
          WHERE occurrence.rule_id=v_rule.id
            AND occurrence.rule_version=v_version.version
            AND occurrence.local_occurrence_at=coalesce(v_local,v_date::timestamp);
          INSERT INTO public.recurring_task_audit_events(
            company_id,rule_id,occurrence_id,event_type,safe_details
          ) VALUES(
            v_rule.company_id,v_rule.id,v_occ.id,'occurrence.failed',
            jsonb_build_object(
              'safeCode','GENERATION_FAILED_'||SQLSTATE,'attempt',v_occ.attempt_count
            )
          );
          IF v_occ.outcome='failed' THEN
            INSERT INTO public.notification_outbox(
              company_id,event_key,event_type,aggregate_type,aggregate_id
            ) VALUES(
              v_rule.company_id,'recurring.generation_failed:'||v_occ.id,
              'recurring.generation_failed','recurring_task_occurrences',v_occ.id
            ) ON CONFLICT(company_id,event_key) DO NOTHING;
            v_unresolved:=v_unresolved+1;
          END IF;
          -- No created counter is changed in the exception path; its writes rolled back.
          v_processed:=v_processed+1;
        END;
      END IF;
      v_date:=v_date+1;
    END LOOP;
  END LOOP;
  RETURN QUERY SELECT v_processed,v_created,v_unresolved;
END $$;
ALTER FUNCTION public.materialize_recurring_task_occurrences(integer,integer,integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.materialize_recurring_task_occurrences(integer,integer,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_recurring_task_occurrences(integer,integer,integer)
  TO service_role;

COMMENT ON FUNCTION public.materialize_recurring_task_occurrences(integer,integer,integer) IS
  'Materializes recurring tasks with canonical shift intervals, committed-outcome counters, retry safety, and idempotent replay.';

COMMIT;
