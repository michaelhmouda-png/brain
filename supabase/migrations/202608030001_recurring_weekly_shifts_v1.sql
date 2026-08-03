-- Recurring Weekly Shifts V1. Versioned templates materialize only canonical public.shifts rows.
BEGIN;

CREATE TABLE public.weekly_shift_schedule_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT, location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0), created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.weekly_shift_schedule_versions (
  series_id uuid NOT NULL REFERENCES public.weekly_shift_schedule_series(id) ON DELETE RESTRICT, version integer NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE, weekdays smallint[] NOT NULL,
  start_time time NOT NULL, end_time time NOT NULL, effective_from date NOT NULL, effective_until date,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(series_id,version), CHECK (cardinality(weekdays) BETWEEN 1 AND 7),
  CHECK (weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]), CHECK (effective_until IS NULL OR effective_until >= effective_from)
);
CREATE TABLE public.weekly_shift_schedule_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), series_id uuid NOT NULL REFERENCES public.weekly_shift_schedule_series(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE, employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  exception_date date NOT NULL, kind text NOT NULL CHECK (kind IN ('day_off','approved_leave','override')),
  location_id uuid REFERENCES public.locations(id), start_time time, end_time time, note text,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(series_id,exception_date), CHECK ((kind='override')=(location_id IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL))
);
CREATE TABLE public.weekly_shift_generated_shifts (
  series_id uuid NOT NULL, version integer NOT NULL, company_id uuid NOT NULL, employee_id uuid NOT NULL,
  local_date date NOT NULL, shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(series_id,version,local_date), UNIQUE(shift_id),
  FOREIGN KEY(series_id,version) REFERENCES public.weekly_shift_schedule_versions(series_id,version) ON DELETE RESTRICT
);
CREATE INDEX weekly_shift_series_scope_idx ON public.weekly_shift_schedule_series(company_id,location_id,employee_id,status);
CREATE INDEX weekly_shift_versions_horizon_idx ON public.weekly_shift_schedule_versions(company_id,effective_from,effective_until);

CREATE OR REPLACE FUNCTION private.assert_weekly_shift_manager(p_profile_id uuid,p_company_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_profile_id AND profile.company_id=p_company_id
    AND profile.status='active' AND lower(profile.role) IN ('manager','owner','super_admin')) THEN RAISE EXCEPTION 'WEEKLY_SHIFT_FORBIDDEN'; END IF;
END $$;

CREATE OR REPLACE FUNCTION private.weekly_shift_preview(p_actor_profile_id uuid,p_company_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_location public.locations;v_employee_id uuid;v_employee public.employees;v_day integer;v_date date;v_end_date date;
 v_start time;v_end time;v_start_at timestamptz;v_end_at timestamptz;v_rows jsonb:='[]';v_errors jsonb:='[]';v_employee_errors jsonb;
BEGIN
  PERFORM private.assert_weekly_shift_manager(p_actor_profile_id,p_company_id);
  IF jsonb_typeof(p_input->'employeeIds')<>'array' OR jsonb_array_length(p_input->'employeeIds') NOT BETWEEN 1 AND 100
    OR jsonb_typeof(p_input->'weekdays')<>'array' OR jsonb_array_length(p_input->'weekdays') NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'WEEKLY_SHIFT_INPUT_INVALID';END IF;
  SELECT location.* INTO v_location FROM public.locations location WHERE location.id=(p_input->>'locationId')::uuid
    AND location.company_id=p_company_id AND location.status='active';
  IF NOT FOUND OR v_location.timezone IS NULL THEN RAISE EXCEPTION 'WEEKLY_SHIFT_LOCATION_INVALID';END IF;
  v_start:=(p_input->>'startTime')::time;v_end:=(p_input->>'endTime')::time;v_date:=(p_input->>'startDate')::date;
  v_end_date:=least(coalesce(nullif(p_input->>'endDate','')::date,v_date+41),v_date+41);
  FOR v_employee_id IN SELECT value::uuid FROM jsonb_array_elements_text(p_input->'employeeIds') LOOP
    v_employee_errors:='[]';
    SELECT employee.* INTO v_employee FROM public.employees employee WHERE employee.id=v_employee_id AND employee.company_id=p_company_id AND employee.status='active';
    IF NOT FOUND THEN v_errors:=v_errors||jsonb_build_array(jsonb_build_object('employeeId',v_employee_id,'code','WEEKLY_SHIFT_EMPLOYEE_INVALID'));CONTINUE;END IF;
    FOR v_date IN SELECT day::date FROM generate_series((p_input->>'startDate')::date,v_end_date,interval '1 day') day LOOP
      v_day:=extract(dow FROM v_date);
      IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_input->'weekdays') weekday WHERE weekday::integer=v_day) THEN
        BEGIN
          v_start_at:=private.strict_local_to_utc(v_date::timestamp+v_start,v_location.timezone);
          v_end_at:=private.strict_local_to_utc((v_date+CASE WHEN v_end<=v_start THEN 1 ELSE 0 END)::timestamp+v_end,v_location.timezone);
        EXCEPTION WHEN SQLSTATE 'P0001' THEN v_employee_errors:=v_employee_errors||jsonb_build_array(jsonb_build_object('date',v_date,'code','WEEKLY_SHIFT_DST_INVALID'));CONTINUE;END;
        IF EXISTS(SELECT 1 FROM public.shifts shift WHERE shift.company_id=p_company_id AND shift.employee_id=v_employee_id AND shift.status='scheduled'
          AND coalesce(shift.starts_at,shift.shift_date::timestamp+shift.start_time)<v_end_at
          AND coalesce(shift.ends_at,shift.shift_date::timestamp+shift.end_time+CASE WHEN shift.end_time<=shift.start_time THEN interval '1 day' ELSE interval '0' END)>v_start_at)
        THEN v_employee_errors:=v_employee_errors||jsonb_build_array(jsonb_build_object('date',v_date,'code','WEEKLY_SHIFT_CONFLICT'));CONTINUE;END IF;
        v_rows:=v_rows||jsonb_build_array(jsonb_build_object('employeeId',v_employee_id,'locationId',v_location.id,'date',v_date,
          'startTime',to_char(v_start,'HH24:MI'),'endTime',to_char(v_end,'HH24:MI'),'startsAt',v_start_at,'endsAt',v_end_at,'overnight',v_end<=v_start));
      END IF;
    END LOOP;
    IF jsonb_array_length(v_employee_errors)>0 THEN v_errors:=v_errors||jsonb_build_array(jsonb_build_object('employeeId',v_employee_id,'errors',v_employee_errors));END IF;
  END LOOP;
  RETURN jsonb_build_object('rows',v_rows,'errors',v_errors,'valid',jsonb_array_length(v_errors)=0,'previewToken',
    encode(extensions.digest(convert_to(p_company_id::text||':'||p_actor_profile_id::text||':'||p_input::text||':'||v_rows::text,'UTF8'),'sha256'),'hex'));
END $$;

CREATE OR REPLACE FUNCTION public.preview_weekly_shift_schedule_v1(p_actor_profile_id uuid,p_company_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT private.weekly_shift_preview(p_actor_profile_id,p_company_id,p_input) $$;

CREATE OR REPLACE FUNCTION public.confirm_weekly_shift_schedule_v1(p_actor_profile_id uuid,p_company_id uuid,p_input jsonb,p_preview_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_preview jsonb;v_row jsonb;v_employee_id uuid;v_series public.weekly_shift_schedule_series;v_shift_id uuid;v_count integer:=0;
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
      SELECT created.id INTO v_shift_id FROM public.create_concrete_shift(p_actor_profile_id,p_company_id,v_employee_id,
        (v_row->>'locationId')::uuid,(v_row->>'date')::date,(v_row->>'startTime')::time,(v_row->>'endTime')::time,
        (v_row->>'startsAt')::timestamptz,(v_row->>'endsAt')::timestamptz,NULL) created;
      INSERT INTO public.weekly_shift_generated_shifts(series_id,version,company_id,employee_id,local_date,shift_id)
      VALUES(v_series.id,1,p_company_id,v_employee_id,(v_row->>'date')::date,v_shift_id);v_count:=v_count+1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('seriesCreated',jsonb_array_length(p_input->'employeeIds'),'shiftsCreated',v_count);
END $$;

CREATE OR REPLACE FUNCTION public.materialize_weekly_shift_schedules_v1(p_batch_limit integer DEFAULT 25,p_horizon_days integer DEFAULT 42)
RETURNS TABLE(series_processed integer,shifts_created integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_series public.weekly_shift_schedule_series;v_version public.weekly_shift_schedule_versions;v_location public.locations;v_effective_location public.locations;v_exception public.weekly_shift_schedule_exceptions;v_date date;
 v_effective_start time;v_effective_end time;v_start_at timestamptz;v_end_at timestamptz;v_shift_id uuid;v_processed integer:=0;v_created integer:=0;
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
     SELECT created.id INTO v_shift_id FROM public.create_concrete_shift(v_series.created_by_profile_id,v_series.company_id,v_series.employee_id,v_effective_location.id,
       v_date,v_effective_start,v_effective_end,v_start_at,v_end_at,NULL) created;
     INSERT INTO public.weekly_shift_generated_shifts VALUES(v_series.id,v_version.version,v_series.company_id,v_series.employee_id,v_date,v_shift_id,clock_timestamp());v_created:=v_created+1;
   END IF;
  END LOOP;v_processed:=v_processed+1;
 END LOOP;RETURN QUERY SELECT v_processed,v_created;
END $$;

CREATE OR REPLACE FUNCTION public.manage_weekly_shift_schedules_v1(p_actor_profile_id uuid,p_company_id uuid,p_action text,p_series_ids uuid[],p_input jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_series public.weekly_shift_schedule_series;v_series_id uuid;v_version public.weekly_shift_schedule_versions;v_effective date;v_count integer:=0;
BEGIN
 PERFORM private.assert_weekly_shift_manager(p_actor_profile_id,p_company_id);
 IF cardinality(p_series_ids) NOT BETWEEN 1 AND 100 OR p_action NOT IN ('pause','resume','end','edit','exception') THEN RAISE EXCEPTION 'WEEKLY_SHIFT_INPUT_INVALID';END IF;
 v_effective:=coalesce(nullif(p_input->>'effectiveFrom','')::date,current_date+1);
 IF v_effective<=current_date AND p_action IN ('edit','end') THEN RAISE EXCEPTION 'WEEKLY_SHIFT_FUTURE_ONLY';END IF;
 FOREACH v_series_id IN ARRAY p_series_ids LOOP
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(p_company_id::text||':'||v_series_id::text,0));
  SELECT series.* INTO v_series FROM public.weekly_shift_schedule_series series WHERE series.id=v_series_id AND series.company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEEKLY_SHIFT_SERIES_INVALID';END IF;
  IF p_action IN ('pause','resume','end') THEN
   UPDATE public.weekly_shift_schedule_series SET status=CASE p_action WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'active' ELSE 'ended' END,updated_at=clock_timestamp() WHERE id=v_series.id;
   IF p_action='end' THEN UPDATE public.weekly_shift_schedule_versions SET effective_until=v_effective-1 WHERE series_id=v_series.id AND version=v_series.current_version;
   END IF;
  ELSIF p_action='edit' THEN
   SELECT version.* INTO v_version FROM public.weekly_shift_schedule_versions version WHERE version.series_id=v_series.id AND version.version=v_series.current_version;
   UPDATE public.weekly_shift_schedule_versions SET effective_until=v_effective-1 WHERE series_id=v_series.id AND version=v_series.current_version;
   UPDATE public.shifts shift SET status='cancelled',updated_at=clock_timestamp() FROM public.weekly_shift_generated_shifts generated
    WHERE generated.series_id=v_series.id AND generated.version=v_series.current_version AND generated.shift_id=shift.id
      AND generated.local_date>=v_effective AND shift.status='scheduled';
   INSERT INTO public.weekly_shift_schedule_versions(series_id,version,company_id,weekdays,start_time,end_time,effective_from,effective_until,created_by_profile_id)
   VALUES(v_series.id,v_series.current_version+1,p_company_id,
    coalesce(ARRAY(SELECT value::smallint FROM jsonb_array_elements_text(p_input->'weekdays') value),v_version.weekdays),
    coalesce(nullif(p_input->>'startTime','')::time,v_version.start_time),coalesce(nullif(p_input->>'endTime','')::time,v_version.end_time),
    v_effective,nullif(p_input->>'endDate','')::date,p_actor_profile_id);
   UPDATE public.weekly_shift_schedule_series SET current_version=current_version+1,
    location_id=coalesce(nullif(p_input->>'locationId','')::uuid,location_id),status='active',updated_at=clock_timestamp() WHERE id=v_series.id;
  ELSE
   INSERT INTO public.weekly_shift_schedule_exceptions(series_id,company_id,employee_id,exception_date,kind,location_id,start_time,end_time,note,created_by_profile_id)
   VALUES(v_series.id,p_company_id,v_series.employee_id,(p_input->>'date')::date,p_input->>'kind',nullif(p_input->>'locationId','')::uuid,
    nullif(p_input->>'startTime','')::time,nullif(p_input->>'endTime','')::time,nullif(p_input->>'note',''),p_actor_profile_id);
   UPDATE public.shifts shift SET status='cancelled',updated_at=clock_timestamp() FROM public.weekly_shift_generated_shifts generated
    WHERE generated.series_id=v_series.id AND generated.shift_id=shift.id AND generated.local_date=(p_input->>'date')::date AND shift.status='scheduled';
  END IF;v_count:=v_count+1;
 END LOOP;RETURN jsonb_build_object('updated',v_count,'action',p_action);
END $$;

ALTER TABLE public.weekly_shift_schedule_series ENABLE ROW LEVEL SECURITY;ALTER TABLE public.weekly_shift_schedule_series FORCE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_shift_schedule_versions ENABLE ROW LEVEL SECURITY;ALTER TABLE public.weekly_shift_schedule_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_shift_schedule_exceptions ENABLE ROW LEVEL SECURITY;ALTER TABLE public.weekly_shift_schedule_exceptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_shift_generated_shifts ENABLE ROW LEVEL SECURITY;ALTER TABLE public.weekly_shift_generated_shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY weekly_series_management_read ON public.weekly_shift_schedule_series FOR SELECT TO authenticated USING (private.can_manage_company(company_id));
CREATE POLICY weekly_versions_management_read ON public.weekly_shift_schedule_versions FOR SELECT TO authenticated USING (private.can_manage_company(company_id));
CREATE POLICY weekly_exceptions_management_read ON public.weekly_shift_schedule_exceptions FOR SELECT TO authenticated USING (private.can_manage_company(company_id));
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;REVOKE INSERT,UPDATE,DELETE ON public.weekly_shift_schedule_series,public.weekly_shift_schedule_versions,public.weekly_shift_schedule_exceptions,public.weekly_shift_generated_shifts FROM authenticated;
ALTER FUNCTION public.preview_weekly_shift_schedule_v1(uuid,uuid,jsonb) OWNER TO postgres;ALTER FUNCTION public.confirm_weekly_shift_schedule_v1(uuid,uuid,jsonb,text) OWNER TO postgres;ALTER FUNCTION public.materialize_weekly_shift_schedules_v1(integer,integer) OWNER TO postgres;ALTER FUNCTION public.manage_weekly_shift_schedules_v1(uuid,uuid,text,uuid[],jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_weekly_shift_schedule_v1(uuid,uuid,jsonb),public.confirm_weekly_shift_schedule_v1(uuid,uuid,jsonb,text),public.materialize_weekly_shift_schedules_v1(integer,integer),public.manage_weekly_shift_schedules_v1(uuid,uuid,text,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_weekly_shift_schedule_v1(uuid,uuid,jsonb),public.confirm_weekly_shift_schedule_v1(uuid,uuid,jsonb,text),public.materialize_weekly_shift_schedules_v1(integer,integer),public.manage_weekly_shift_schedules_v1(uuid,uuid,text,uuid[],jsonb) TO service_role;
COMMIT;
