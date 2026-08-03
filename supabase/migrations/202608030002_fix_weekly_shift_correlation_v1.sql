-- Recurring Weekly Shifts V1 correlation repair.
-- Replaces only the two affected functions and creates no business rows.
BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_weekly_shift_schedule_v1(p_actor_profile_id uuid,p_company_id uuid,p_input jsonb,p_preview_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_preview jsonb;v_row jsonb;v_employee_id uuid;v_series public.weekly_shift_schedule_series;v_shift_id uuid;v_correlation_id uuid;v_count integer:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(p_company_id::text||':weekly-shifts',0));
  v_preview:=private.weekly_shift_preview(p_actor_profile_id,p_company_id,p_input);
  IF NOT (v_preview->>'valid')::boolean THEN RAISE EXCEPTION 'WEEKLY_SHIFT_CONFLICT';END IF;
  IF v_preview->>'previewToken' IS DISTINCT FROM p_preview_token THEN RAISE EXCEPTION 'WEEKLY_SHIFT_STALE_PREVIEW';END IF;
  FOR v_employee_id IN SELECT value::uuid FROM jsonb_array_elements_text(p_input->'employeeIds') LOOP
    INSERT INTO public.weekly_shift_schedule_series(company_id,employee_id,location_id,created_by_profile_id)
    VALUES(p_company_id,v_employee_id,(p_input->>'locationId')::uuid,p_actor_profile_id) RETURNING * INTO v_series;
    INSERT INTO public.weekly_shift_schedule_versions(series_id,version,company_id,weekdays,start_time,end_time,effective_from,effective_until,created_by_profile_id)
    VALUES(v_series.id,1,p_company_id,ARRAY(SELECT value::smallint FROM jsonb_array_elements_text(p_input->'weekdays') value),
      (p_input->>'startTime')::time,(p_input->>'endTime')::time,(p_input->>'startDate')::date,nullif(p_input->>'endDate','')::date,p_actor_profile_id);
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_preview->'rows') value WHERE value->>'employeeId'=v_employee_id::text LOOP
      v_correlation_id:=md5('weekly-shift-v1:'||v_series.id::text||':1:'||v_employee_id::text||':'||(v_row->>'date'))::uuid;
      SELECT created.id INTO v_shift_id FROM public.create_concrete_shift(p_actor_profile_id,p_company_id,v_employee_id,
        (v_row->>'locationId')::uuid,(v_row->>'date')::date,(v_row->>'startTime')::time,(v_row->>'endTime')::time,
        (v_row->>'startsAt')::timestamptz,(v_row->>'endsAt')::timestamptz,v_correlation_id) created;
      INSERT INTO public.weekly_shift_generated_shifts(series_id,version,company_id,employee_id,local_date,shift_id)
      VALUES(v_series.id,1,p_company_id,v_employee_id,(v_row->>'date')::date,v_shift_id);v_count:=v_count+1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('seriesCreated',jsonb_array_length(p_input->'employeeIds'),'shiftsCreated',v_count);
END $$;

CREATE OR REPLACE FUNCTION public.materialize_weekly_shift_schedules_v1(p_batch_limit integer DEFAULT 25,p_horizon_days integer DEFAULT 42)
RETURNS TABLE(series_processed integer,shifts_created integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_series public.weekly_shift_schedule_series;v_version public.weekly_shift_schedule_versions;v_location public.locations;v_effective_location public.locations;v_exception public.weekly_shift_schedule_exceptions;v_date date;
 v_effective_start time;v_effective_end time;v_start_at timestamptz;v_end_at timestamptz;v_shift_id uuid;v_correlation_id uuid;v_processed integer:=0;v_created integer:=0;
BEGIN
 IF current_user NOT IN ('service_role','postgres') OR p_batch_limit NOT BETWEEN 1 AND 50 OR p_horizon_days NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'WEEKLY_SHIFT_WORKER_FORBIDDEN';END IF;
 FOR v_series IN SELECT series.* FROM public.weekly_shift_schedule_series series WHERE series.status='active' ORDER BY series.id LIMIT p_batch_limit LOOP
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(v_series.company_id::text||':'||v_series.employee_id::text,0));
  SELECT version.* INTO v_version FROM public.weekly_shift_schedule_versions version WHERE version.series_id=v_series.id AND version.version=v_series.current_version;
  SELECT location.* INTO v_location FROM public.locations location WHERE location.id=v_series.location_id AND location.company_id=v_series.company_id AND location.status='active';
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.employees employee WHERE employee.id=v_series.employee_id AND employee.company_id=v_series.company_id AND employee.status='active') THEN CONTINUE;END IF;
  FOR v_date IN SELECT day::date FROM generate_series(greatest(current_date,v_version.effective_from),least(current_date+p_horizon_days,coalesce(v_version.effective_until,current_date+p_horizon_days)),interval '1 day') day LOOP
   SELECT exception.* INTO v_exception FROM public.weekly_shift_schedule_exceptions exception WHERE exception.series_id=v_series.id AND exception.exception_date=v_date;
   IF (extract(dow FROM v_date)::smallint=ANY(v_version.weekdays) OR v_exception.kind='override')
    AND coalesce(v_exception.kind,'') NOT IN ('day_off','approved_leave')
    AND NOT EXISTS(SELECT 1 FROM public.weekly_shift_generated_shifts generated WHERE generated.series_id=v_series.id AND generated.version=v_version.version AND generated.local_date=v_date) THEN
     v_effective_start:=coalesce(v_exception.start_time,v_version.start_time);v_effective_end:=coalesce(v_exception.end_time,v_version.end_time);v_effective_location:=v_location;
     IF v_exception.kind='override' THEN SELECT location.* INTO v_effective_location FROM public.locations location WHERE location.id=v_exception.location_id AND location.company_id=v_series.company_id AND location.status='active';IF NOT FOUND THEN RAISE EXCEPTION 'WEEKLY_SHIFT_LOCATION_INVALID';END IF;END IF;
     v_start_at:=private.strict_local_to_utc(v_date::timestamp+v_effective_start,v_effective_location.timezone);
     v_end_at:=private.strict_local_to_utc((v_date+CASE WHEN v_effective_end<=v_effective_start THEN 1 ELSE 0 END)::timestamp+v_effective_end,v_effective_location.timezone);
     v_correlation_id:=md5('weekly-shift-v1:'||v_series.id::text||':'||v_version.version::text||':'||v_series.employee_id::text||':'||v_date::text)::uuid;
     SELECT created.id INTO v_shift_id FROM public.create_concrete_shift(v_series.created_by_profile_id,v_series.company_id,v_series.employee_id,v_effective_location.id,
       v_date,v_effective_start,v_effective_end,v_start_at,v_end_at,v_correlation_id) created;
     INSERT INTO public.weekly_shift_generated_shifts VALUES(v_series.id,v_version.version,v_series.company_id,v_series.employee_id,v_date,v_shift_id,clock_timestamp());v_created:=v_created+1;
   END IF;
  END LOOP;v_processed:=v_processed+1;
 END LOOP;RETURN QUERY SELECT v_processed,v_created;
END $$;

ALTER FUNCTION public.confirm_weekly_shift_schedule_v1(uuid,uuid,jsonb,text) OWNER TO postgres;
ALTER FUNCTION public.materialize_weekly_shift_schedules_v1(integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_weekly_shift_schedule_v1(uuid,uuid,jsonb,text),public.materialize_weekly_shift_schedules_v1(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_weekly_shift_schedule_v1(uuid,uuid,jsonb,text),public.materialize_weekly_shift_schedules_v1(integer,integer) TO service_role;

COMMIT;
