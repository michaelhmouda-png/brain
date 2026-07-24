-- Vision Service v1: durable, tenant-safe Camera Inspection results for existing private snapshots.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.camera_snapshot_artifacts') IS NULL
     OR to_regclass('public.device_gateways') IS NULL
     OR to_regclass('public.nvr_connections') IS NULL
     OR to_regprocedure('private.can_view_camera_manager(uuid)') IS NULL THEN
    RAISE EXCEPTION 'VISION_SERVICE_CAMERA_FOUNDATION_REQUIRED';
  END IF;
  IF to_regclass('public.camera_inspections') IS NOT NULL THEN
    RAISE EXCEPTION 'VISION_SERVICE_CAMERA_INSPECTION_ALREADY_EXISTS';
  END IF;
END
$preflight$;

CREATE TABLE public.camera_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  nvr_connection_id uuid NOT NULL REFERENCES public.nvr_connections(id) ON DELETE RESTRICT,
  gateway_id uuid NOT NULL REFERENCES public.device_gateways(id) ON DELETE RESTRICT,
  snapshot_artifact_id uuid NOT NULL REFERENCES public.camera_snapshot_artifacts(id) ON DELETE RESTRICT,
  channel_number integer NOT NULL,
  inspection_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  model text,
  result jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  processing_duration_ms integer,
  error_code text,
  correlation_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT camera_inspections_channel_check CHECK (channel_number BETWEEN 1 AND 256),
  CONSTRAINT camera_inspections_version_check CHECK (inspection_version = 'camera_inspection_v1'),
  CONSTRAINT camera_inspections_status_check CHECK (status IN ('pending','succeeded','failed')),
  CONSTRAINT camera_inspections_model_check CHECK (
    model IS NULL OR (char_length(model) BETWEEN 1 AND 160 AND model = btrim(model))
  ),
  CONSTRAINT camera_inspections_warnings_check CHECK (
    jsonb_typeof(warnings) = 'array'
    AND jsonb_array_length(warnings) <= 20
    AND NOT jsonb_path_exists(warnings, '$[*] ? (@.type() != "string")')
  ),
  CONSTRAINT camera_inspections_duration_check CHECK (
    processing_duration_ms IS NULL OR processing_duration_ms >= 0
  ),
  CONSTRAINT camera_inspections_error_code_check CHECK (
    error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,79}$'
  ),
  CONSTRAINT camera_inspections_result_shape_check CHECK (
    result IS NULL OR (
      jsonb_typeof(result) = 'object'
      AND result->>'inspection_version' = 'camera_inspection_v1'
      AND result ?& ARRAY[
        'inspection_version','scene','people','operations',
        'safety','observations','limitations'
      ]
    )
  ),
  CONSTRAINT camera_inspections_terminal_state_check CHECK (
    (
      status = 'pending'
      AND model IS NULL
      AND result IS NULL
      AND processing_duration_ms IS NULL
      AND error_code IS NULL
      AND completed_at IS NULL
    )
    OR (
      status = 'succeeded'
      AND model IS NOT NULL
      AND result IS NOT NULL
      AND processing_duration_ms IS NOT NULL
      AND error_code IS NULL
      AND completed_at IS NOT NULL
      AND completed_at >= created_at
    )
    OR (
      status = 'failed'
      AND result IS NULL
      AND processing_duration_ms IS NOT NULL
      AND error_code IS NOT NULL
      AND completed_at IS NOT NULL
      AND completed_at >= created_at
    )
  ),
  CONSTRAINT camera_inspections_snapshot_version_unique
    UNIQUE (snapshot_artifact_id, inspection_version),
  CONSTRAINT camera_inspections_correlation_unique UNIQUE (correlation_id)
);

CREATE INDEX camera_inspections_company_created_idx
  ON public.camera_inspections(company_id, created_at DESC);
CREATE INDEX camera_inspections_location_created_idx
  ON public.camera_inspections(company_id, location_id, created_at DESC);

ALTER TABLE public.camera_inspections OWNER TO postgres;

CREATE FUNCTION private.validate_camera_inspection_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_snapshot public.camera_snapshot_artifacts%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'CAMERA_INSPECTION_TERMINAL_IMMUTABLE';
    END IF;
    IF NEW.status NOT IN ('succeeded','failed') THEN
      RAISE EXCEPTION 'CAMERA_INSPECTION_TRANSITION_INVALID';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.location_id IS DISTINCT FROM OLD.location_id
       OR NEW.nvr_connection_id IS DISTINCT FROM OLD.nvr_connection_id
       OR NEW.gateway_id IS DISTINCT FROM OLD.gateway_id
       OR NEW.snapshot_artifact_id IS DISTINCT FROM OLD.snapshot_artifact_id
       OR NEW.channel_number IS DISTINCT FROM OLD.channel_number
       OR NEW.inspection_version IS DISTINCT FROM OLD.inspection_version
       OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'CAMERA_INSPECTION_CONTEXT_IMMUTABLE';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'pending' THEN
    RAISE EXCEPTION 'CAMERA_INSPECTION_MUST_START_PENDING';
  END IF;

  SELECT artifact.* INTO v_snapshot
  FROM public.camera_snapshot_artifacts AS artifact
  WHERE artifact.id = NEW.snapshot_artifact_id
    AND artifact.company_id = NEW.company_id
    AND artifact.location_id = NEW.location_id
    AND artifact.nvr_connection_id = NEW.nvr_connection_id
    AND artifact.gateway_id = NEW.gateway_id
    AND artifact.external_channel_id = NEW.channel_number::text
    AND artifact.bucket_id = 'camera-snapshots'
    AND artifact.content_type = 'image/jpeg'
    AND artifact.status = 'ready'
    AND artifact.width IS NOT NULL
    AND artifact.height IS NOT NULL
    AND artifact.expires_at > clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAMERA_INSPECTION_SNAPSHOT_CONTEXT_INVALID';
  END IF;

  SELECT profile.* INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = NEW.created_by
    AND profile.company_id = NEW.company_id
    AND profile.status = 'active'
    AND profile.role IN ('manager','owner','super_admin');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAMERA_INSPECTION_ACTOR_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.locations AS location
    WHERE location.id = NEW.location_id
      AND location.company_id = NEW.company_id
      AND location.status = 'active'
  ) THEN
    RAISE EXCEPTION 'CAMERA_INSPECTION_LOCATION_INVALID';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION private.validate_camera_inspection_context() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.validate_camera_inspection_context()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER camera_inspections_validate_context
BEFORE INSERT OR UPDATE ON public.camera_inspections
FOR EACH ROW
EXECUTE FUNCTION private.validate_camera_inspection_context();

ALTER TABLE public.camera_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camera_inspections FORCE ROW LEVEL SECURITY;

CREATE POLICY camera_inspections_management_select
ON public.camera_inspections
FOR SELECT
TO authenticated
USING (private.can_view_camera_manager(camera_inspections.company_id));

REVOKE ALL ON TABLE public.camera_inspections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.camera_inspections TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.camera_inspections TO service_role;

COMMIT;
