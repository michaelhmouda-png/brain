-- Brain Timeline Foundation v1: shared append-only operational events and observations.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.locations') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('private.can_view_camera_manager(uuid)') IS NULL THEN
    RAISE EXCEPTION 'BRAIN_TIMELINE_FOUNDATION_REQUIRED';
  END IF;
  IF to_regclass('public.brain_timeline_events') IS NOT NULL
     OR to_regclass('public.brain_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'BRAIN_TIMELINE_ALREADY_EXISTS';
  END IF;
END
$preflight$;

CREATE TABLE public.brain_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title text NOT NULL,
  summary text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  confidence numeric,
  occurred_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT brain_timeline_event_type_check
    CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$' AND char_length(event_type) <= 120),
  CONSTRAINT brain_timeline_source_type_check
    CHECK (source_type ~ '^[a-z][a-z0-9_]{0,79}$'),
  CONSTRAINT brain_timeline_title_check
    CHECK (char_length(title) BETWEEN 1 AND 160 AND title = btrim(title)),
  CONSTRAINT brain_timeline_summary_check
    CHECK (char_length(summary) BETWEEN 1 AND 1200 AND summary = btrim(summary)),
  CONSTRAINT brain_timeline_severity_check
    CHECK (severity IN ('info','notice','warning','critical')),
  CONSTRAINT brain_timeline_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT brain_timeline_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192),
  CONSTRAINT brain_timeline_created_after_occurred_check
    CHECK (created_at >= occurred_at - interval '1 day')
);

CREATE UNIQUE INDEX brain_timeline_source_dedup_uidx
  ON public.brain_timeline_events(company_id, event_type, source_type, source_id)
  WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX brain_timeline_correlation_dedup_uidx
  ON public.brain_timeline_events(company_id, event_type, source_type, correlation_id)
  WHERE source_id IS NULL;
CREATE INDEX brain_timeline_company_occurred_idx
  ON public.brain_timeline_events(company_id, occurred_at DESC, id DESC);
CREATE INDEX brain_timeline_location_occurred_idx
  ON public.brain_timeline_events(company_id, location_id, occurred_at DESC, id DESC);
CREATE INDEX brain_timeline_type_occurred_idx
  ON public.brain_timeline_events(company_id, event_type, occurred_at DESC);
CREATE INDEX brain_timeline_source_occurred_idx
  ON public.brain_timeline_events(company_id, source_type, occurred_at DESC);

ALTER TABLE public.brain_timeline_events OWNER TO postgres;

CREATE TABLE public.brain_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timeline_event_id uuid NOT NULL REFERENCES public.brain_timeline_events(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  observation_type text NOT NULL,
  value jsonb NOT NULL,
  description text NOT NULL,
  confidence numeric,
  state text NOT NULL,
  requires_human_review boolean NOT NULL DEFAULT false,
  source_type text NOT NULL,
  source_id uuid,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT brain_observations_type_check
    CHECK (observation_type ~ '^[a-z][a-z0-9_.]{0,119}$'),
  CONSTRAINT brain_observations_value_check
    CHECK (jsonb_typeof(value) IN ('string','number','boolean','null','object','array')
      AND octet_length(value::text) <= 2048),
  CONSTRAINT brain_observations_description_check
    CHECK (char_length(description) BETWEEN 1 AND 800 AND description = btrim(description)),
  CONSTRAINT brain_observations_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT brain_observations_state_check
    CHECK (state IN ('observed','unknown')),
  CONSTRAINT brain_observations_unknown_confidence_check
    CHECK (state <> 'unknown' OR confidence IS NULL OR confidence = 0),
  CONSTRAINT brain_observations_source_type_check
    CHECK (source_type ~ '^[a-z][a-z0-9_]{0,79}$'),
  CONSTRAINT brain_observations_created_after_observed_check
    CHECK (created_at >= observed_at - interval '1 day'),
  CONSTRAINT brain_observations_event_type_unique
    UNIQUE (timeline_event_id, observation_type)
);

CREATE INDEX brain_observations_event_idx
  ON public.brain_observations(timeline_event_id, created_at, id);
CREATE INDEX brain_observations_company_observed_idx
  ON public.brain_observations(company_id, observed_at DESC, id DESC);
CREATE INDEX brain_observations_review_idx
  ON public.brain_observations(company_id, requires_human_review, observed_at DESC)
  WHERE requires_human_review;

ALTER TABLE public.brain_observations OWNER TO postgres;

CREATE FUNCTION private.validate_brain_timeline_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_event public.brain_timeline_events%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'BRAIN_TIMELINE_APPEND_ONLY';
  END IF;

  IF TG_TABLE_NAME = 'brain_timeline_events' THEN
    IF NEW.location_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.locations AS location
      WHERE location.id = NEW.location_id
        AND location.company_id = NEW.company_id
        AND location.status = 'active'
    ) THEN
      RAISE EXCEPTION 'BRAIN_TIMELINE_LOCATION_INVALID';
    END IF;
    IF NEW.actor_profile_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = NEW.actor_profile_id
        AND profile.company_id = NEW.company_id
        AND profile.status = 'active'
    ) THEN
      RAISE EXCEPTION 'BRAIN_TIMELINE_ACTOR_INVALID';
    END IF;
    RETURN NEW;
  END IF;

  SELECT event.* INTO v_event
  FROM public.brain_timeline_events AS event
  WHERE event.id = NEW.timeline_event_id;
  IF NOT FOUND
     OR NEW.company_id IS DISTINCT FROM v_event.company_id
     OR NEW.location_id IS DISTINCT FROM v_event.location_id
     OR NEW.source_type IS DISTINCT FROM v_event.source_type
     OR NEW.source_id IS DISTINCT FROM v_event.source_id
     OR NEW.observed_at IS DISTINCT FROM v_event.occurred_at THEN
    RAISE EXCEPTION 'BRAIN_OBSERVATION_CONTEXT_INVALID';
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION private.validate_brain_timeline_context() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.validate_brain_timeline_context()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER brain_timeline_events_validate_context
BEFORE INSERT OR UPDATE OR DELETE ON public.brain_timeline_events
FOR EACH ROW EXECUTE FUNCTION private.validate_brain_timeline_context();

CREATE TRIGGER brain_observations_validate_context
BEFORE INSERT OR UPDATE OR DELETE ON public.brain_observations
FOR EACH ROW EXECUTE FUNCTION private.validate_brain_timeline_context();

CREATE FUNCTION public.persist_brain_timeline_event(
  p_company_id uuid,
  p_location_id uuid,
  p_event_type text,
  p_source_type text,
  p_source_id uuid,
  p_actor_profile_id uuid,
  p_title text,
  p_summary text,
  p_severity text,
  p_confidence numeric,
  p_occurred_at timestamptz,
  p_correlation_id uuid,
  p_metadata jsonb,
  p_observations jsonb
)
RETURNS TABLE(event_id uuid, observation_ids uuid[], deduplicated boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_event public.brain_timeline_events%ROWTYPE;
  v_observation jsonb;
  v_observation_ids uuid[] := ARRAY[]::uuid[];
  v_observation_id uuid;
  v_deduplicated boolean := false;
BEGIN
  IF p_company_id IS NULL OR p_event_type IS NULL OR p_source_type IS NULL
     OR p_actor_profile_id IS NULL OR p_correlation_id IS NULL
     OR p_occurred_at IS NULL OR p_title IS NULL OR p_summary IS NULL
     OR p_metadata IS NULL OR p_observations IS NULL THEN
    RAISE EXCEPTION 'BRAIN_TIMELINE_INPUT_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = p_actor_profile_id
      AND profile.company_id = p_company_id
      AND profile.status = 'active'
      AND profile.role IN ('manager','owner','super_admin')
  ) THEN
    RAISE EXCEPTION 'BRAIN_TIMELINE_ACTOR_FORBIDDEN';
  END IF;
  IF jsonb_typeof(p_metadata) <> 'object'
     OR octet_length(p_metadata::text) > 8192
     OR p_metadata::text ~* '(signed[_-]?url|storage[_-]?path|authorization|credential|password|secret|token|nonce|private[_-]?key)' THEN
    RAISE EXCEPTION 'BRAIN_TIMELINE_METADATA_UNSAFE';
  END IF;
  IF jsonb_typeof(p_observations) <> 'array'
     OR jsonb_array_length(p_observations) > 30 THEN
    RAISE EXCEPTION 'BRAIN_TIMELINE_OBSERVATIONS_INVALID';
  END IF;

  SELECT event.* INTO v_event
  FROM public.brain_timeline_events AS event
  WHERE event.company_id = p_company_id
    AND event.event_type = p_event_type
    AND event.source_type = p_source_type
    AND (
      (p_source_id IS NOT NULL AND event.source_id = p_source_id)
      OR (p_source_id IS NULL AND event.source_id IS NULL AND event.correlation_id = p_correlation_id)
    )
  FOR UPDATE;
  IF FOUND THEN
    v_deduplicated := true;
  ELSE
    BEGIN
      INSERT INTO public.brain_timeline_events (
        company_id, location_id, event_type, source_type, source_id,
        actor_profile_id, title, summary, severity, confidence,
        occurred_at, correlation_id, metadata
      ) VALUES (
        p_company_id, p_location_id, p_event_type, p_source_type, p_source_id,
        p_actor_profile_id, p_title, p_summary, p_severity, p_confidence,
        p_occurred_at, p_correlation_id, p_metadata
      )
      RETURNING * INTO v_event;
    EXCEPTION WHEN unique_violation THEN
      SELECT event.* INTO v_event
      FROM public.brain_timeline_events AS event
      WHERE event.company_id = p_company_id
        AND event.event_type = p_event_type
        AND event.source_type = p_source_type
        AND (
          (p_source_id IS NOT NULL AND event.source_id = p_source_id)
          OR (p_source_id IS NULL AND event.source_id IS NULL AND event.correlation_id = p_correlation_id)
        )
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE;
      END IF;
      v_deduplicated := true;
    END;
  END IF;

  IF v_deduplicated THEN
    IF v_event.location_id IS DISTINCT FROM p_location_id
       OR v_event.title IS DISTINCT FROM p_title
       OR v_event.summary IS DISTINCT FROM p_summary
       OR v_event.severity IS DISTINCT FROM p_severity
       OR v_event.confidence IS DISTINCT FROM p_confidence
       OR v_event.metadata IS DISTINCT FROM p_metadata THEN
      RAISE EXCEPTION 'BRAIN_TIMELINE_IDEMPOTENCY_CONFLICT';
    END IF;
    SELECT coalesce(array_agg(observation.id ORDER BY observation.created_at, observation.id), ARRAY[]::uuid[])
      INTO v_observation_ids
    FROM public.brain_observations AS observation
    WHERE observation.timeline_event_id = v_event.id;
    RETURN QUERY SELECT v_event.id, v_observation_ids, true;
    RETURN;
  END IF;

  FOR v_observation IN SELECT value FROM jsonb_array_elements(p_observations)
  LOOP
    IF jsonb_typeof(v_observation) <> 'object'
       OR NOT (v_observation ?& ARRAY[
         'observationType','value','description','confidence',
         'state','requiresHumanReview'
       ])
       OR (SELECT count(*) FROM jsonb_object_keys(v_observation)) <> 6 THEN
      RAISE EXCEPTION 'BRAIN_TIMELINE_OBSERVATION_SHAPE_INVALID';
    END IF;
    INSERT INTO public.brain_observations (
      timeline_event_id, company_id, location_id, observation_type,
      value, description, confidence, state, requires_human_review,
      source_type, source_id, observed_at
    ) VALUES (
      v_event.id, p_company_id, p_location_id, v_observation->>'observationType',
      v_observation->'value', v_observation->>'description',
      CASE WHEN v_observation->'confidence' = 'null'::jsonb THEN NULL
        ELSE (v_observation->>'confidence')::numeric END,
      v_observation->>'state',
      (v_observation->>'requiresHumanReview')::boolean,
      p_source_type, p_source_id, p_occurred_at
    )
    RETURNING id INTO v_observation_id;
    v_observation_ids := array_append(v_observation_ids, v_observation_id);
  END LOOP;

  RETURN QUERY SELECT v_event.id, v_observation_ids, false;
END
$function$;

ALTER FUNCTION public.persist_brain_timeline_event(
  uuid,uuid,text,text,uuid,uuid,text,text,text,numeric,timestamptz,uuid,jsonb,jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.persist_brain_timeline_event(
  uuid,uuid,text,text,uuid,uuid,text,text,text,numeric,timestamptz,uuid,jsonb,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_brain_timeline_event(
  uuid,uuid,text,text,uuid,uuid,text,text,text,numeric,timestamptz,uuid,jsonb,jsonb
) TO service_role;

ALTER TABLE public.brain_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_timeline_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brain_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_observations FORCE ROW LEVEL SECURITY;

CREATE POLICY brain_timeline_management_select
ON public.brain_timeline_events
FOR SELECT TO authenticated
USING (
  private.can_view_camera_manager(brain_timeline_events.company_id)
  AND (
    brain_timeline_events.location_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.locations AS location
      WHERE location.id = brain_timeline_events.location_id
        AND location.company_id = brain_timeline_events.company_id
        AND location.status = 'active'
    )
  )
);

CREATE POLICY brain_observations_management_select
ON public.brain_observations
FOR SELECT TO authenticated
USING (
  private.can_view_camera_manager(brain_observations.company_id)
  AND EXISTS (
    SELECT 1 FROM public.brain_timeline_events AS event
    WHERE event.id = brain_observations.timeline_event_id
      AND event.company_id = brain_observations.company_id
      AND event.location_id IS NOT DISTINCT FROM brain_observations.location_id
  )
);

REVOKE ALL ON TABLE public.brain_timeline_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.brain_observations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.brain_timeline_events TO authenticated;
GRANT SELECT ON TABLE public.brain_observations TO authenticated;
GRANT SELECT ON TABLE public.brain_timeline_events TO service_role;
GRANT SELECT ON TABLE public.brain_observations TO service_role;

COMMIT;
