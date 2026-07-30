-- Recurring Task Engine V1.
-- Forward-only, creates no business rows and performs no backfill.

BEGIN;

CREATE TABLE public.location_operating_hours (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  is_closed boolean NOT NULL DEFAULT false,
  opens_at time,
  closes_at time,
  updated_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (location_id, weekday),
  CHECK (
    (is_closed AND opens_at IS NULL AND closes_at IS NULL)
    OR (NOT is_closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL)
  )
);

CREATE TABLE public.recurring_task_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 80),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  next_occurrence_at timestamptz,
  source_proposal_id uuid REFERENCES public.brain_action_proposals(id) ON DELETE RESTRICT,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz
);

CREATE TABLE public.recurring_task_rule_versions (
  rule_id uuid NOT NULL REFERENCES public.recurring_task_rules(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  recurrence jsonb NOT NULL,
  time_anchor jsonb NOT NULL,
  start_date date NOT NULL,
  end_date date,
  task_template jsonb NOT NULL,
  workforce jsonb NOT NULL,
  assignment_mode text NOT NULL CHECK (assignment_mode IN (
    'every_matching_employee_on_shift','one_matching_employee_on_shift','specific_employee_if_on_shift'
  )),
  reminder_offsets_minutes integer[] NOT NULL DEFAULT '{}',
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (rule_id, version),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (cardinality(reminder_offsets_minutes) <= 8),
  CHECK (0 <= ALL(reminder_offsets_minutes) AND 1440 >= ALL(reminder_offsets_minutes))
);

CREATE TABLE public.recurring_task_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.recurring_task_rules(id) ON DELETE RESTRICT,
  rule_version integer NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  local_occurrence_at timestamp NOT NULL,
  timezone text NOT NULL,
  due_at timestamptz,
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN (
    'pending','processing','materialized','no_eligible_employee','invalid_schedule','dst_failure','failed'
  )),
  eligible_count integer NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  rotation_index integer CHECK (rotation_index IS NULL OR rotation_index >= 0),
  selected_employee_id uuid REFERENCES public.employees(id) ON DELETE RESTRICT,
  selection_reason text,
  created_task_count integer NOT NULL DEFAULT 0 CHECK (created_task_count >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  safe_failure_code text CHECK (safe_failure_code IS NULL OR char_length(safe_failure_code) <= 80),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (rule_id, rule_version, local_occurrence_at),
  FOREIGN KEY (rule_id, rule_version) REFERENCES public.recurring_task_rule_versions(rule_id, version) ON DELETE RESTRICT
);

CREATE TABLE public.recurring_task_generated_tasks (
  occurrence_id uuid NOT NULL REFERENCES public.recurring_task_occurrences(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  assigned_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  template_position smallint NOT NULL DEFAULT 0 CHECK (template_position >= 0),
  task_id uuid NOT NULL UNIQUE REFERENCES public.tasks(id) ON DELETE RESTRICT,
  evidence_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (occurrence_id, assigned_employee_id, template_position)
);

CREATE TABLE public.recurring_task_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  occurrence_id uuid NOT NULL REFERENCES public.recurring_task_occurrences(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  assigned_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  offset_minutes integer NOT NULL CHECK (offset_minutes BETWEEN 0 AND 1440),
  remind_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','enqueued','cancelled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  enqueued_at timestamptz,
  UNIQUE (task_id, offset_minutes)
);

CREATE TABLE public.recurring_task_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  rule_id uuid NOT NULL REFERENCES public.recurring_task_rules(id) ON DELETE RESTRICT,
  occurrence_id uuid REFERENCES public.recurring_task_occurrences(id) ON DELETE RESTRICT,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'rule.created','rule.versioned','rule.paused','rule.resumed','rule.ended',
    'occurrence.materialized','task.created','occurrence.no_eligible_employee',
    'occurrence.invalid_schedule','occurrence.dst_failure','occurrence.idempotent_replay','occurrence.failed'
  )),
  safe_details jsonb NOT NULL DEFAULT '{}',
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (jsonb_typeof(safe_details) = 'object')
);

CREATE INDEX recurring_task_rules_company_status_idx ON public.recurring_task_rules(company_id, status);
CREATE INDEX recurring_task_occurrences_pending_idx ON public.recurring_task_occurrences(due_at, created_at)
  WHERE outcome IN ('pending','processing');
CREATE INDEX recurring_task_occurrences_rule_recent_idx ON public.recurring_task_occurrences(rule_id, created_at DESC);
CREATE INDEX recurring_task_reminders_due_idx ON public.recurring_task_reminders(remind_at, created_at)
  WHERE status = 'pending';
CREATE INDEX recurring_task_audit_rule_idx ON public.recurring_task_audit_events(rule_id, created_at DESC);

ALTER TABLE public.location_operating_hours OWNER TO postgres;
ALTER TABLE public.recurring_task_rules OWNER TO postgres;
ALTER TABLE public.recurring_task_rule_versions OWNER TO postgres;
ALTER TABLE public.recurring_task_occurrences OWNER TO postgres;
ALTER TABLE public.recurring_task_generated_tasks OWNER TO postgres;
ALTER TABLE public.recurring_task_reminders OWNER TO postgres;
ALTER TABLE public.recurring_task_audit_events OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.reject_recurring_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  RAISE EXCEPTION 'RECURRING_APPEND_ONLY' USING ERRCODE = '42501';
END $$;
ALTER FUNCTION private.reject_recurring_append_only_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_recurring_append_only_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER recurring_task_rule_versions_append_only
BEFORE UPDATE OR DELETE ON public.recurring_task_rule_versions
FOR EACH ROW EXECUTE FUNCTION private.reject_recurring_append_only_mutation();
CREATE TRIGGER recurring_task_generated_tasks_append_only
BEFORE UPDATE OR DELETE ON public.recurring_task_generated_tasks
FOR EACH ROW EXECUTE FUNCTION private.reject_recurring_append_only_mutation();
CREATE TRIGGER recurring_task_audit_events_append_only
BEFORE UPDATE OR DELETE ON public.recurring_task_audit_events
FOR EACH ROW EXECUTE FUNCTION private.reject_recurring_append_only_mutation();

CREATE OR REPLACE FUNCTION private.assert_recurring_manager(
  p_actor_profile_id uuid, p_company_id uuid
) RETURNS public.profiles
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT profile.* INTO v_actor FROM public.profiles AS profile
  WHERE profile.id = p_actor_profile_id AND profile.company_id = p_company_id
    AND profile.status = 'active' AND profile.role IN ('manager','owner','super_admin');
  IF NOT FOUND THEN RAISE EXCEPTION 'RECURRING_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  RETURN v_actor;
END $$;
ALTER FUNCTION private.assert_recurring_manager(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.assert_recurring_manager(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.validate_recurring_rule_json(
  p_company_id uuid, p_rule jsonb
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_location public.locations; v_timezone text := p_rule->>'timezone';
BEGIN
  IF p_rule IS NULL OR jsonb_typeof(p_rule) <> 'object'
    OR length(btrim(p_rule->>'name')) NOT BETWEEN 1 AND 160
    OR length(btrim(p_rule#>>'{taskTemplate,title}')) NOT BETWEEN 1 AND 200
    OR (p_rule->>'assignmentMode') NOT IN (
      'every_matching_employee_on_shift','one_matching_employee_on_shift','specific_employee_if_on_shift')
    OR (p_rule#>>'{workforce,shiftOverlapRequired}')::boolean IS DISTINCT FROM true
    OR (p_rule#>>'{recurrence,kind}') NOT IN ('daily','selected_weekdays','except_weekdays','weekly')
    OR (p_rule#>>'{timeAnchor,kind}') NOT IN ('fixed_time','location_opening','location_closing')
  THEN RAISE EXCEPTION 'RECURRING_RULE_INVALID'; END IF;

  PERFORM 1 FROM pg_catalog.pg_timezone_names AS zone WHERE zone.name = v_timezone;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECURRING_TIMEZONE_INVALID'; END IF;

  IF nullif(p_rule->>'locationId','') IS NOT NULL THEN
    SELECT location.* INTO v_location FROM public.locations AS location
    WHERE location.id = (p_rule->>'locationId')::uuid AND location.company_id = p_company_id
      AND location.status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'RECURRING_LOCATION_INVALID'; END IF;
    IF v_location.timezone IS DISTINCT FROM v_timezone THEN RAISE EXCEPTION 'RECURRING_TIMEZONE_INVALID'; END IF;
  END IF;

  IF nullif(p_rule#>>'{workforce,departmentId}','') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments AS department
    WHERE department.id = (p_rule#>>'{workforce,departmentId}')::uuid
      AND department.company_id = p_company_id AND department.status = 'active'
  ) THEN RAISE EXCEPTION 'RECURRING_DEPARTMENT_INVALID'; END IF;

  IF nullif(p_rule#>>'{workforce,specificEmployeeId}','') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.employees AS employee
    WHERE employee.id = (p_rule#>>'{workforce,specificEmployeeId}')::uuid
      AND employee.company_id = p_company_id AND employee.status = 'active'
  ) THEN RAISE EXCEPTION 'RECURRING_EMPLOYEE_INVALID'; END IF;

  IF (p_rule#>>'{timeAnchor,kind}') IN ('location_opening','location_closing') AND (
    nullif(p_rule->>'locationId','') IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.location_operating_hours AS hours
      WHERE hours.location_id = (p_rule->>'locationId')::uuid AND hours.company_id = p_company_id
        AND NOT hours.is_closed
    )
  ) THEN RAISE EXCEPTION 'RECURRING_OPERATING_HOURS_REQUIRED'; END IF;
END $$;
ALTER FUNCTION private.validate_recurring_rule_json(uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.validate_recurring_rule_json(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.manage_recurring_task_rule(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_action text,
  p_rule_id uuid DEFAULT NULL,
  p_expected_version integer DEFAULT NULL,
  p_rule jsonb DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL
) RETURNS TABLE(rule_id uuid, version integer, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_rule public.recurring_task_rules; v_id uuid; v_version integer; v_status text; v_event text;
BEGIN
  PERFORM private.assert_recurring_manager(p_actor_profile_id,p_company_id);
  IF p_correlation_id IS NULL OR p_action NOT IN ('create','version','pause','resume','end') THEN
    RAISE EXCEPTION 'RECURRING_RULE_INVALID';
  END IF;
  IF p_action = 'create' THEN
    PERFORM private.validate_recurring_rule_json(p_company_id,p_rule);
    v_id := gen_random_uuid(); v_version := 1; v_status := 'active'; v_event := 'rule.created';
    INSERT INTO public.recurring_task_rules(
      id,company_id,location_id,name,description,status,timezone,current_version,
      created_by_profile_id,updated_by_profile_id
    ) VALUES (
      v_id,p_company_id,nullif(p_rule->>'locationId','')::uuid,p_rule->>'name',
      nullif(p_rule->>'description',''),v_status,p_rule->>'timezone',1,
      p_actor_profile_id,p_actor_profile_id
    );
  ELSE
    SELECT rule.* INTO v_rule FROM public.recurring_task_rules AS rule
    WHERE rule.id=p_rule_id AND rule.company_id=p_company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'RECURRING_RULE_NOT_FOUND'; END IF;
    IF v_rule.current_version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'RECURRING_VERSION_CONFLICT'; END IF;
    v_id:=v_rule.id; v_version:=v_rule.current_version; v_status:=v_rule.status;
    IF p_action='version' THEN
      IF v_status='ended' THEN RAISE EXCEPTION 'RECURRING_RULE_STATE_INVALID'; END IF;
      PERFORM private.validate_recurring_rule_json(p_company_id,p_rule);
      v_version:=v_version+1; v_event:='rule.versioned';
      UPDATE public.recurring_task_rules SET location_id=nullif(p_rule->>'locationId','')::uuid,
        name=p_rule->>'name',description=nullif(p_rule->>'description',''),timezone=p_rule->>'timezone',
        current_version=v_version,updated_by_profile_id=p_actor_profile_id,updated_at=clock_timestamp()
      WHERE id=v_id;
    ELSIF p_action='pause' AND v_status='active' THEN v_status:='paused';v_event:='rule.paused';
    ELSIF p_action='resume' AND v_status='paused' THEN v_status:='active';v_event:='rule.resumed';
    ELSIF p_action='end' AND v_status IN ('active','paused') THEN v_status:='ended';v_event:='rule.ended';
    ELSE RAISE EXCEPTION 'RECURRING_RULE_STATE_INVALID'; END IF;
    IF p_action <> 'version' THEN
      UPDATE public.recurring_task_rules SET status=v_status,updated_by_profile_id=p_actor_profile_id,
        updated_at=clock_timestamp(),ended_at=CASE WHEN v_status='ended' THEN clock_timestamp() ELSE ended_at END
      WHERE id=v_id;
    END IF;
  END IF;

  IF p_action IN ('create','version') THEN
    INSERT INTO public.recurring_task_rule_versions(
      rule_id,company_id,version,recurrence,time_anchor,start_date,end_date,task_template,workforce,
      assignment_mode,reminder_offsets_minutes,created_by_profile_id,correlation_id
    ) VALUES (
      v_id,p_company_id,v_version,p_rule->'recurrence',p_rule->'timeAnchor',
      (p_rule->>'startDate')::date,nullif(p_rule->>'endDate','')::date,p_rule->'taskTemplate',p_rule->'workforce',
      p_rule->>'assignmentMode',
      ARRAY(SELECT value::integer FROM jsonb_array_elements_text(p_rule->'reminderOffsetsMinutes') AS value),
      p_actor_profile_id,p_correlation_id
    );
  END IF;
  INSERT INTO public.recurring_task_audit_events(company_id,rule_id,actor_profile_id,event_type,correlation_id)
  VALUES(p_company_id,v_id,p_actor_profile_id,v_event,p_correlation_id);
  RETURN QUERY SELECT v_id,v_version,v_status;
END $$;
ALTER FUNCTION public.manage_recurring_task_rule(uuid,uuid,text,uuid,integer,jsonb,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.manage_recurring_task_rule(uuid,uuid,text,uuid,integer,jsonb,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manage_recurring_task_rule(uuid,uuid,text,uuid,integer,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.configure_location_operating_hours(
  p_actor_profile_id uuid,p_company_id uuid,p_location_id uuid,p_days jsonb,p_correlation_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_day jsonb;v_seen integer[]:='{}';v_count integer:=0;
BEGIN
  PERFORM private.assert_recurring_manager(p_actor_profile_id,p_company_id);
  IF p_correlation_id IS NULL OR jsonb_typeof(p_days)<>'array' OR jsonb_array_length(p_days)<>7
    OR NOT EXISTS(SELECT 1 FROM public.locations location WHERE location.id=p_location_id
      AND location.company_id=p_company_id AND location.status='active')
  THEN RAISE EXCEPTION 'RECURRING_LOCATION_INVALID';END IF;
  FOR v_day IN SELECT value FROM jsonb_array_elements(p_days) value LOOP
    IF (v_day->>'weekday')::integer NOT BETWEEN 0 AND 6
      OR (v_day->>'weekday')::integer=ANY(v_seen)
      OR (v_day->>'isClosed')::boolean IS NULL
      OR (NOT (v_day->>'isClosed')::boolean AND (
        nullif(v_day->>'opensAt','') IS NULL OR nullif(v_day->>'closesAt','') IS NULL))
    THEN RAISE EXCEPTION 'RECURRING_RULE_INVALID';END IF;
    v_seen:=array_append(v_seen,(v_day->>'weekday')::integer);
    INSERT INTO public.location_operating_hours(
      company_id,location_id,weekday,is_closed,opens_at,closes_at,updated_by_profile_id,updated_at
    ) VALUES(
      p_company_id,p_location_id,(v_day->>'weekday')::integer,(v_day->>'isClosed')::boolean,
      CASE WHEN (v_day->>'isClosed')::boolean THEN NULL ELSE (v_day->>'opensAt')::time END,
      CASE WHEN (v_day->>'isClosed')::boolean THEN NULL ELSE (v_day->>'closesAt')::time END,
      p_actor_profile_id,clock_timestamp()
    )
    ON CONFLICT(location_id,weekday) DO UPDATE SET
      company_id=EXCLUDED.company_id,is_closed=EXCLUDED.is_closed,opens_at=EXCLUDED.opens_at,
      closes_at=EXCLUDED.closes_at,updated_by_profile_id=EXCLUDED.updated_by_profile_id,
      updated_at=EXCLUDED.updated_at;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END $$;
ALTER FUNCTION public.configure_location_operating_hours(uuid,uuid,uuid,jsonb,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.configure_location_operating_hours(uuid,uuid,uuid,jsonb,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configure_location_operating_hours(uuid,uuid,uuid,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.strict_local_to_utc(p_local timestamp,p_timezone text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_utc timestamptz;
BEGIN
  v_utc:=p_local AT TIME ZONE p_timezone;
  IF v_utc AT TIME ZONE p_timezone IS DISTINCT FROM p_local
    OR (v_utc-interval '1 hour') AT TIME ZONE p_timezone = p_local
    OR (v_utc+interval '1 hour') AT TIME ZONE p_timezone = p_local
  THEN RAISE EXCEPTION 'RECURRING_DST_TIME_INVALID'; END IF;
  RETURN v_utc;
END $$;
ALTER FUNCTION private.strict_local_to_utc(timestamp,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.strict_local_to_utc(timestamp,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.recurring_local_occurrence(
  p_rule public.recurring_task_rules,p_version public.recurring_task_rule_versions,p_date date
) RETURNS timestamp LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_time time; v_hours public.location_operating_hours; v_offset integer;
BEGIN
  v_offset:=coalesce((p_version.time_anchor->>'offsetMinutes')::integer,0);
  IF p_version.time_anchor->>'kind'='fixed_time' THEN
    v_time:=(p_version.time_anchor->>'localTime')::time;
  ELSE
    SELECT hours.* INTO v_hours FROM public.location_operating_hours AS hours
    WHERE hours.company_id=p_rule.company_id AND hours.location_id=p_rule.location_id
      AND hours.weekday=extract(dow from p_date)::integer AND NOT hours.is_closed;
    IF NOT FOUND THEN RAISE EXCEPTION 'RECURRING_SCHEDULE_MISSING'; END IF;
    v_time:=CASE WHEN p_version.time_anchor->>'kind'='location_opening' THEN v_hours.opens_at ELSE v_hours.closes_at END;
  END IF;
  RETURN p_date::timestamp + v_time + make_interval(mins=>v_offset);
END $$;
ALTER FUNCTION private.recurring_local_occurrence(public.recurring_task_rules,public.recurring_task_rule_versions,date) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.recurring_local_occurrence(public.recurring_task_rules,public.recurring_task_rule_versions,date)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.recurring_day_matches(p_recurrence jsonb,p_date date)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE p_recurrence->>'kind'
    WHEN 'daily' THEN true
    WHEN 'except_weekdays' THEN NOT (extract(dow from p_date)::integer = ANY(
      ARRAY(SELECT value::integer FROM jsonb_array_elements_text(p_recurrence->'weekdays') AS value)))
    ELSE extract(dow from p_date)::integer = ANY(
      ARRAY(SELECT value::integer FROM jsonb_array_elements_text(p_recurrence->'weekdays') AS value))
  END
$$;
ALTER FUNCTION private.recurring_day_matches(jsonb,date) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.recurring_day_matches(jsonb,date) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_recurring_task_rule(
  p_actor_profile_id uuid,p_company_id uuid,p_rule jsonb,p_limit integer DEFAULT 8
) RETURNS TABLE(local_date date,local_time time,timezone text,due_at timestamptz,reminder_times timestamptz[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_date date; v_found integer:=0; v_local timestamp; v_due timestamptz;
  v_mock_rule public.recurring_task_rules; v_mock_version public.recurring_task_rule_versions;
BEGIN
  PERFORM private.assert_recurring_manager(p_actor_profile_id,p_company_id);
  PERFORM private.validate_recurring_rule_json(p_company_id,p_rule);
  IF p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'RECURRING_RULE_INVALID'; END IF;
  v_mock_rule.company_id:=p_company_id;v_mock_rule.location_id:=nullif(p_rule->>'locationId','')::uuid;
  v_mock_rule.timezone:=p_rule->>'timezone';
  v_mock_version.recurrence:=p_rule->'recurrence';v_mock_version.time_anchor:=p_rule->'timeAnchor';
  v_mock_version.reminder_offsets_minutes:=ARRAY(SELECT value::integer FROM jsonb_array_elements_text(p_rule->'reminderOffsetsMinutes') value);
  v_date:=greatest((p_rule->>'startDate')::date,(clock_timestamp() AT TIME ZONE v_mock_rule.timezone)::date);
  WHILE v_found<p_limit AND v_date<=coalesce(nullif(p_rule->>'endDate','')::date,v_date+366) LOOP
    IF private.recurring_day_matches(v_mock_version.recurrence,v_date) THEN
      v_local:=private.recurring_local_occurrence(v_mock_rule,v_mock_version,v_date);
      v_due:=private.strict_local_to_utc(v_local,v_mock_rule.timezone);
      local_date:=v_local::date;local_time:=v_local::time;timezone:=v_mock_rule.timezone;due_at:=v_due;
      reminder_times:=ARRAY(SELECT v_due-make_interval(mins=>offset_value) FROM unnest(v_mock_version.reminder_offsets_minutes) offset_value);
      RETURN NEXT;v_found:=v_found+1;
    END IF;
    v_date:=v_date+1;
  END LOOP;
END $$;
ALTER FUNCTION public.preview_recurring_task_rule(uuid,uuid,jsonb,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_recurring_task_rule(uuid,uuid,jsonb,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_recurring_task_rule(uuid,uuid,jsonb,integer) TO service_role;

CREATE OR REPLACE FUNCTION private.create_recurring_canonical_task(
  p_occurrence public.recurring_task_occurrences,
  p_rule public.recurring_task_rules,
  p_version public.recurring_task_rule_versions,
  p_employee_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_task_id uuid:=md5(p_occurrence.id::text||':'||p_employee_id::text||':0')::uuid;
  v_template jsonb:=p_version.task_template; v_profile public.profiles;
BEGIN
  INSERT INTO public.tasks(id,company_id,title,description,assigned_employee_id,priority,status,due_date,due_at,location_id,created_by)
  VALUES(v_task_id,p_rule.company_id,v_template->>'title',nullif(v_template->>'description',''),p_employee_id,
    v_template->>'priority','pending',(p_occurrence.due_at AT TIME ZONE p_rule.timezone)::date,p_occurrence.due_at,
    p_rule.location_id,p_rule.created_by_profile_id)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.recurring_task_generated_tasks(occurrence_id,company_id,assigned_employee_id,task_id,evidence_required)
  VALUES(p_occurrence.id,p_rule.company_id,p_employee_id,v_task_id,coalesce((v_template->>'evidenceRequired')::boolean,false))
  ON CONFLICT (occurrence_id,assigned_employee_id,template_position) DO NOTHING;

  IF jsonb_typeof(v_template->'countRequirement')='object' THEN
    INSERT INTO public.task_evidence_count_requirements(
      task_id,company_id,count_required,count_label,canonical_unit,damaged_quantity_requested,allow_decimals,
      employee_instructions,created_by_profile_id,updated_by_profile_id
    ) VALUES(v_task_id,p_rule.company_id,true,v_template#>>'{countRequirement,countLabel}',
      v_template#>>'{countRequirement,unit}',coalesce((v_template#>>'{countRequirement,damagedQuantityRequested}')::boolean,false),
      coalesce((v_template#>>'{countRequirement,allowDecimals}')::boolean,false),
      nullif(v_template#>>'{countRequirement,instructions}',''),p_rule.created_by_profile_id,p_rule.created_by_profile_id)
    ON CONFLICT (task_id) DO NOTHING;
  END IF;

  INSERT INTO public.notification_outbox(company_id,event_key,event_type,aggregate_type,aggregate_id,actor_profile_id)
  VALUES(p_rule.company_id,'recurring.task.assigned:'||v_task_id,'task.assigned','tasks',v_task_id,p_rule.created_by_profile_id)
  ON CONFLICT(company_id,event_key) DO NOTHING;

  SELECT profile.* INTO v_profile FROM public.profiles AS profile
  WHERE profile.company_id=p_rule.company_id AND profile.employee_id=p_employee_id
    AND profile.status='active' AND profile.preferred_language='ar' LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.task_localization_jobs(task_id,company_id,language,source_hash)
    VALUES(v_task_id,p_rule.company_id,'ar',encode(extensions.digest(
      convert_to((v_template->>'title')||E'\n'||coalesce(v_template->>'description',''),'UTF8'),'sha256'),'hex'))
    ON CONFLICT(task_id,language) DO NOTHING;
  END IF;

  INSERT INTO public.recurring_task_reminders(company_id,occurrence_id,task_id,assigned_employee_id,offset_minutes,remind_at)
  SELECT p_rule.company_id,p_occurrence.id,v_task_id,p_employee_id,offset_value,
    p_occurrence.due_at-make_interval(mins=>offset_value)
  FROM unnest(p_version.reminder_offsets_minutes) AS offset_value
  ON CONFLICT(task_id,offset_minutes) DO NOTHING;
  INSERT INTO public.recurring_task_audit_events(company_id,rule_id,occurrence_id,event_type,safe_details)
  VALUES(p_rule.company_id,p_rule.id,p_occurrence.id,'task.created',jsonb_build_object('taskId',v_task_id));
  RETURN v_task_id;
END $$;
ALTER FUNCTION private.create_recurring_canonical_task(
  public.recurring_task_occurrences,public.recurring_task_rules,public.recurring_task_rule_versions,uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.create_recurring_canonical_task(
  public.recurring_task_occurrences,public.recurring_task_rules,public.recurring_task_rule_versions,uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.materialize_recurring_task_occurrences(
  p_batch_limit integer DEFAULT 10,p_horizon_hours integer DEFAULT 24,p_lease_seconds integer DEFAULT 120
) RETURNS TABLE(processed integer,created_tasks integer,unresolved integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_now timestamptz:=clock_timestamp();v_processed integer:=0;v_created integer:=0;v_unresolved integer:=0;
  v_rule public.recurring_task_rules;v_version public.recurring_task_rule_versions;v_date date;v_local timestamp;v_due timestamptz;
  v_occ public.recurring_task_occurrences;v_employee record;v_count integer;v_rotation integer;v_previous integer;
BEGIN
  IF p_batch_limit NOT BETWEEN 1 AND 50 OR p_horizon_hours NOT BETWEEN 1 AND 24 OR p_lease_seconds NOT BETWEEN 30 AND 600
  THEN RAISE EXCEPTION 'RECURRING_WORKER_INPUT_INVALID';END IF;
  FOR v_rule IN SELECT rule.* FROM public.recurring_task_rules rule WHERE rule.status='active' ORDER BY rule.id LOOP
    EXIT WHEN v_processed>=p_batch_limit;
    SELECT version.* INTO v_version FROM public.recurring_task_rule_versions version
    WHERE version.rule_id=v_rule.id AND version.version=v_rule.current_version;
    v_date:=(v_now AT TIME ZONE v_rule.timezone)::date;
    WHILE v_date<=((v_now+make_interval(hours=>p_horizon_hours)) AT TIME ZONE v_rule.timezone)::date LOOP
      EXIT WHEN v_processed>=p_batch_limit;
      IF v_date>=v_version.start_date AND (v_version.end_date IS NULL OR v_date<=v_version.end_date)
        AND private.recurring_day_matches(v_version.recurrence,v_date) THEN
        BEGIN
          v_local:=private.recurring_local_occurrence(v_rule,v_version,v_date);
          v_due:=private.strict_local_to_utc(v_local,v_rule.timezone);
          IF v_due BETWEEN v_now-interval '15 minutes' AND v_now+make_interval(hours=>p_horizon_hours) THEN
            INSERT INTO public.recurring_task_occurrences(rule_id,rule_version,company_id,location_id,local_occurrence_at,timezone,due_at)
            VALUES(v_rule.id,v_version.version,v_rule.company_id,v_rule.location_id,v_local,v_rule.timezone,v_due)
            ON CONFLICT(rule_id,rule_version,local_occurrence_at) DO NOTHING;
            SELECT occurrence.* INTO v_occ FROM public.recurring_task_occurrences occurrence
            WHERE occurrence.rule_id=v_rule.id AND occurrence.rule_version=v_version.version
              AND occurrence.local_occurrence_at=v_local FOR UPDATE;
            IF v_occ.outcome='materialized' OR v_occ.outcome IN ('no_eligible_employee','invalid_schedule','dst_failure') THEN
              INSERT INTO public.recurring_task_audit_events(company_id,rule_id,occurrence_id,event_type)
              VALUES(v_rule.company_id,v_rule.id,v_occ.id,'occurrence.idempotent_replay');
            ELSE
              UPDATE public.recurring_task_occurrences SET outcome='processing',attempt_count=attempt_count+1,
                lease_token=gen_random_uuid(),lease_expires_at=v_now+make_interval(secs=>p_lease_seconds)
              WHERE id=v_occ.id;
              SELECT count(*) INTO v_count FROM public.employees employee
              WHERE employee.company_id=v_rule.company_id AND employee.status='active'
                AND (v_rule.location_id IS NULL OR employee.location_id=v_rule.location_id)
                AND (nullif(v_version.workforce->>'departmentId','') IS NULL OR employee.department_id=(v_version.workforce->>'departmentId')::uuid)
                AND (nullif(v_version.workforce->>'employeeRole','') IS NULL OR lower(employee.role)=lower(v_version.workforce->>'employeeRole'))
                AND (nullif(v_version.workforce->>'specificEmployeeId','') IS NULL OR employee.id=(v_version.workforce->>'specificEmployeeId')::uuid)
                AND EXISTS(SELECT 1 FROM public.shifts shift WHERE shift.company_id=v_rule.company_id
                  AND shift.employee_id=employee.id AND shift.status='scheduled'
                  AND shift.shift_date=v_local::date AND (
                    (shift.end_time>shift.start_time AND v_local::time BETWEEN shift.start_time AND shift.end_time)
                    OR (shift.end_time<=shift.start_time AND (v_local::time>=shift.start_time OR v_local::time<=shift.end_time))
                  ));
              UPDATE public.recurring_task_occurrences SET eligible_count=v_count WHERE id=v_occ.id;
              IF v_count=0 THEN
                UPDATE public.recurring_task_occurrences SET outcome='no_eligible_employee',completed_at=clock_timestamp(),
                  lease_token=NULL,lease_expires_at=NULL,safe_failure_code='NO_ELIGIBLE_EMPLOYEE' WHERE id=v_occ.id;
                INSERT INTO public.recurring_task_audit_events(company_id,rule_id,occurrence_id,event_type)
                VALUES(v_rule.company_id,v_rule.id,v_occ.id,'occurrence.no_eligible_employee');
                INSERT INTO public.notification_outbox(company_id,event_key,event_type,aggregate_type,aggregate_id)
                VALUES(v_rule.company_id,'recurring.no_eligible:'||v_occ.id,'recurring.no_eligible_employee','recurring_task_occurrences',v_occ.id)
                ON CONFLICT(company_id,event_key) DO NOTHING;
                v_unresolved:=v_unresolved+1;
              ELSE
                IF v_version.assignment_mode='one_matching_employee_on_shift' THEN
                  SELECT count(*) INTO v_previous FROM public.recurring_task_occurrences occurrence
                  WHERE occurrence.rule_id=v_rule.id AND occurrence.outcome='materialized' AND occurrence.local_occurrence_at<v_local;
                  v_rotation:=v_previous%v_count;
                ELSE v_rotation:=NULL;END IF;
                FOR v_employee IN SELECT employee.id,row_number() OVER(ORDER BY employee.id)-1 AS position
                  FROM public.employees employee WHERE employee.company_id=v_rule.company_id AND employee.status='active'
                    AND (v_rule.location_id IS NULL OR employee.location_id=v_rule.location_id)
                    AND (nullif(v_version.workforce->>'departmentId','') IS NULL OR employee.department_id=(v_version.workforce->>'departmentId')::uuid)
                    AND (nullif(v_version.workforce->>'employeeRole','') IS NULL OR lower(employee.role)=lower(v_version.workforce->>'employeeRole'))
                    AND (nullif(v_version.workforce->>'specificEmployeeId','') IS NULL OR employee.id=(v_version.workforce->>'specificEmployeeId')::uuid)
                    AND EXISTS(SELECT 1 FROM public.shifts shift WHERE shift.company_id=v_rule.company_id AND shift.employee_id=employee.id
                      AND shift.status='scheduled' AND shift.shift_date=v_local::date AND (
                        (shift.end_time>shift.start_time AND v_local::time BETWEEN shift.start_time AND shift.end_time)
                        OR (shift.end_time<=shift.start_time AND (v_local::time>=shift.start_time OR v_local::time<=shift.end_time))))
                  ORDER BY employee.id
                LOOP
                  IF v_version.assignment_mode<>'one_matching_employee_on_shift' OR v_employee.position=v_rotation THEN
                    PERFORM private.create_recurring_canonical_task(v_occ,v_rule,v_version,v_employee.id);v_created:=v_created+1;
                  END IF;
                END LOOP;
                UPDATE public.recurring_task_occurrences SET outcome='materialized',rotation_index=v_rotation,
                  selected_employee_id=CASE WHEN v_version.assignment_mode='one_matching_employee_on_shift'
                    THEN (SELECT employee_id FROM public.recurring_task_generated_tasks WHERE occurrence_id=v_occ.id LIMIT 1) ELSE NULL END,
                  selection_reason=CASE WHEN v_version.assignment_mode='one_matching_employee_on_shift'
                    THEN 'stable_employee_uuid_order_previous_occurrence_modulo' ELSE v_version.assignment_mode END,
                  created_task_count=(SELECT count(*) FROM public.recurring_task_generated_tasks WHERE occurrence_id=v_occ.id),
                  completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL WHERE id=v_occ.id;
                INSERT INTO public.recurring_task_audit_events(company_id,rule_id,occurrence_id,event_type,safe_details)
                VALUES(v_rule.company_id,v_rule.id,v_occ.id,'occurrence.materialized',jsonb_build_object('eligibleCount',v_count,'rotationIndex',v_rotation));
              END IF;
              v_processed:=v_processed+1;
            END IF;
          END IF;
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
          INSERT INTO public.recurring_task_occurrences(rule_id,rule_version,company_id,location_id,local_occurrence_at,timezone,outcome,safe_failure_code,completed_at)
          VALUES(v_rule.id,v_version.version,v_rule.company_id,v_rule.location_id,
            coalesce(v_local,v_date::timestamp),v_rule.timezone,
            CASE WHEN SQLERRM='RECURRING_DST_TIME_INVALID' THEN 'dst_failure' ELSE 'invalid_schedule' END,
            CASE WHEN SQLERRM='RECURRING_DST_TIME_INVALID' THEN 'DST_TIME_INVALID' ELSE 'OPERATING_HOURS_MISSING' END,clock_timestamp())
          ON CONFLICT(rule_id,rule_version,local_occurrence_at) DO NOTHING;
          v_unresolved:=v_unresolved+1;v_processed:=v_processed+1;
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
            outcome=CASE WHEN public.recurring_task_occurrences.attempt_count+1>=5 THEN 'failed' ELSE 'pending' END,
            safe_failure_code='GENERATION_FAILED_'||SQLSTATE,
            lease_token=NULL,lease_expires_at=NULL,
            completed_at=CASE WHEN public.recurring_task_occurrences.attempt_count+1>=5 THEN clock_timestamp() ELSE NULL END;
          SELECT occurrence.* INTO v_occ FROM public.recurring_task_occurrences occurrence
          WHERE occurrence.rule_id=v_rule.id AND occurrence.rule_version=v_version.version
            AND occurrence.local_occurrence_at=coalesce(v_local,v_date::timestamp);
          INSERT INTO public.recurring_task_audit_events(company_id,rule_id,occurrence_id,event_type,safe_details)
          VALUES(v_rule.company_id,v_rule.id,v_occ.id,'occurrence.failed',
            jsonb_build_object('safeCode','GENERATION_FAILED_'||SQLSTATE,'attempt',v_occ.attempt_count));
          IF v_occ.outcome='failed' THEN
            INSERT INTO public.notification_outbox(company_id,event_key,event_type,aggregate_type,aggregate_id)
            VALUES(v_rule.company_id,'recurring.generation_failed:'||v_occ.id,'recurring.generation_failed',
              'recurring_task_occurrences',v_occ.id)
            ON CONFLICT(company_id,event_key) DO NOTHING;
            v_unresolved:=v_unresolved+1;
          END IF;
          v_processed:=v_processed+1;
        END;
      END IF;
      v_date:=v_date+1;
    END LOOP;
  END LOOP;
  RETURN QUERY SELECT v_processed,v_created,v_unresolved;
END $$;
ALTER FUNCTION public.materialize_recurring_task_occurrences(integer,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.materialize_recurring_task_occurrences(integer,integer,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_recurring_task_occurrences(integer,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.generate_recurring_task_reminder_obligations(p_batch_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_count integer;
BEGIN
  IF p_batch_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'RECURRING_WORKER_INPUT_INVALID';END IF;
  WITH due AS (
    SELECT reminder.id,reminder.company_id,reminder.task_id,reminder.offset_minutes
    FROM public.recurring_task_reminders reminder JOIN public.tasks task ON task.id=reminder.task_id
    WHERE reminder.status='pending' AND reminder.remind_at<=clock_timestamp()
      AND task.status IN ('pending','in_progress') ORDER BY reminder.remind_at LIMIT p_batch_limit FOR UPDATE OF reminder SKIP LOCKED
  ), inserted AS (
    INSERT INTO public.notification_outbox(company_id,event_key,event_type,aggregate_type,aggregate_id)
    SELECT due.company_id,'recurring.reminder:'||due.task_id||':'||due.offset_minutes,
      'recurring.task_reminder','tasks',due.task_id FROM due
    ON CONFLICT(company_id,event_key) DO NOTHING RETURNING event_key
  )
  UPDATE public.recurring_task_reminders reminder SET status='enqueued',enqueued_at=clock_timestamp()
  FROM due WHERE reminder.id=due.id;
  GET DIAGNOSTICS v_count=ROW_COUNT;RETURN v_count;
END $$;
ALTER FUNCTION public.generate_recurring_task_reminder_obligations(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.generate_recurring_task_reminder_obligations(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_recurring_task_reminder_obligations(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.materialize_recurring_task_outbox(p_outbox_id uuid,p_lease_token uuid)
RETURNS TABLE(handled boolean,created_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_outbox public.notification_outbox;v_profile record;v_notification_id uuid;v_count integer:=0;
  v_title text;v_message text;v_route text;v_management boolean;
BEGIN
  SELECT outbox.* INTO v_outbox FROM public.notification_outbox outbox
  WHERE outbox.id=p_outbox_id AND outbox.status='processing' AND outbox.lease_token=p_lease_token
    AND outbox.lease_expires_at>=clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED';END IF;
  IF v_outbox.event_type NOT IN ('recurring.no_eligible_employee','recurring.generation_failed','recurring.task_reminder') THEN
    RETURN QUERY SELECT false,0;RETURN;
  END IF;
  v_management:=v_outbox.event_type IN ('recurring.no_eligible_employee','recurring.generation_failed');
  v_title:=CASE WHEN v_management THEN 'Recurring routine needs attention' ELSE 'Task reminder' END;
  v_message:=CASE v_outbox.event_type
    WHEN 'recurring.no_eligible_employee' THEN 'No eligible employee was found for a scheduled routine.'
    WHEN 'recurring.generation_failed' THEN 'A recurring routine could not be generated after bounded retries.'
    ELSE 'Open HospiBrain to view the assigned task.' END;
  v_route:=CASE WHEN v_management THEN '/dashboard/recurring-routines' ELSE '/dashboard/tasks' END;
  FOR v_profile IN SELECT profile.id,coalesce(preference.in_app_enabled,true) AS in_app_enabled,
      coalesce(preference.push_enabled,false) AS push_enabled
    FROM public.profiles profile
    LEFT JOIN public.notification_preferences preference ON preference.profile_id=profile.id
    WHERE profile.company_id=v_outbox.company_id
    AND profile.status='active' AND (
      (v_management AND profile.role IN ('manager','owner','super_admin'))
      OR (NOT v_management AND EXISTS(SELECT 1 FROM public.tasks task
        WHERE task.id=v_outbox.aggregate_id AND task.company_id=v_outbox.company_id
          AND task.assigned_employee_id=profile.employee_id AND task.status IN ('pending','in_progress')))
    )
    AND CASE WHEN v_management THEN coalesce(preference.task_updates,true)
      ELSE coalesce(preference.due_reminders,true) END
  LOOP
    INSERT INTO public.notifications(company_id,recipient_id,title,message,notification_type,related_entity_type,
      related_entity_id,status,category,route,event_key,is_read)
    VALUES(v_outbox.company_id,v_profile.id,v_title,v_message,v_outbox.event_type,v_outbox.aggregate_type,
      v_outbox.aggregate_id,CASE WHEN v_profile.in_app_enabled THEN 'unread' ELSE 'archived' END,
      'tasks',v_route,v_outbox.event_key,NOT v_profile.in_app_enabled)
    ON CONFLICT(recipient_id,event_key) WHERE event_key IS NOT NULL DO NOTHING RETURNING id INTO v_notification_id;
    IF v_notification_id IS NOT NULL THEN
      v_count:=v_count+1;
      INSERT INTO public.notification_delivery_jobs(notification_id,subscription_id,company_id)
      SELECT v_notification_id,subscription.id,v_outbox.company_id FROM public.push_subscriptions subscription
      WHERE subscription.profile_id=v_profile.id AND subscription.revoked_at IS NULL
        AND v_profile.push_enabled
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  UPDATE public.notification_outbox SET status='completed',lease_token=NULL,lease_expires_at=NULL,
    completed_at=clock_timestamp() WHERE id=v_outbox.id;
  RETURN QUERY SELECT true,v_count;
END $$;
ALTER FUNCTION public.materialize_recurring_task_outbox(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.materialize_recurring_task_outbox(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_recurring_task_outbox(uuid,uuid) TO service_role;

ALTER TABLE public.location_operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_operating_hours FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_rule_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_occurrences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_generated_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_generated_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_reminders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY recurring_rules_management_read ON public.recurring_task_rules FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=auth.uid()
  AND profile.company_id=recurring_task_rules.company_id AND profile.status='active'
  AND profile.role IN ('manager','owner','super_admin')));
CREATE POLICY recurring_versions_management_read ON public.recurring_task_rule_versions FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=auth.uid()
  AND profile.company_id=recurring_task_rule_versions.company_id AND profile.status='active'
  AND profile.role IN ('manager','owner','super_admin')));
CREATE POLICY recurring_occurrences_management_read ON public.recurring_task_occurrences FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=auth.uid()
  AND profile.company_id=recurring_task_occurrences.company_id AND profile.status='active'
  AND profile.role IN ('manager','owner','super_admin')));
CREATE POLICY operating_hours_management_read ON public.location_operating_hours FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=auth.uid()
  AND profile.company_id=location_operating_hours.company_id AND profile.status='active'
  AND profile.role IN ('manager','owner','super_admin')));

REVOKE ALL ON public.location_operating_hours,public.recurring_task_rules,public.recurring_task_rule_versions,
  public.recurring_task_occurrences,public.recurring_task_generated_tasks,public.recurring_task_reminders,
  public.recurring_task_audit_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.location_operating_hours,public.recurring_task_rules,public.recurring_task_rule_versions,
  public.recurring_task_occurrences TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.location_operating_hours,public.recurring_task_rules,
  public.recurring_task_rule_versions,public.recurring_task_occurrences,public.recurring_task_generated_tasks,
  public.recurring_task_reminders,public.recurring_task_audit_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.recurring_task_audit_events_id_seq TO service_role;

COMMENT ON TABLE public.recurring_task_generated_tasks IS
  'Provenance bridge for ordinary public.tasks; occurrence, employee and template position form the deterministic identity.';
COMMENT ON FUNCTION public.materialize_recurring_task_occurrences(integer,integer,integer) IS
  'Bounded deterministic materialization. Revalidates concrete active shifts and never calls an AI provider.';

COMMIT;
