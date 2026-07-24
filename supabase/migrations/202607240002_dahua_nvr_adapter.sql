-- Dahua NVR adapter persistence and result application.
-- All NVR I/O remains on the paired outbound venue agent.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.device_commands') IS NULL
     OR to_regclass('public.device_command_attempts') IS NULL
     OR to_regprocedure('public.complete_device_command(uuid,text,uuid,text,uuid,text,jsonb,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'DEVICE_COMMAND_TRANSPORT_REQUIRED';
  END IF;
  IF to_regclass('public.camera_snapshot_artifacts') IS NOT NULL
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'camera-snapshots') THEN
    RAISE EXCEPTION 'DAHUA_ADAPTER_ALREADY_EXISTS';
  END IF;
END
$preflight$;

ALTER TABLE public.device_commands
  DROP CONSTRAINT device_commands_type_check;
ALTER TABLE public.device_commands
  ADD CONSTRAINT device_commands_type_check CHECK (
    command_type IN (
      'agent_health','network_reachability','nvr_capability_probe',
      'nvr_health_diagnostics','channel_discovery','snapshot_request'
    )
  );

CREATE TABLE public.camera_snapshot_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL UNIQUE REFERENCES public.device_commands(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  gateway_id uuid NOT NULL REFERENCES public.device_gateways(id) ON DELETE RESTRICT,
  nvr_connection_id uuid NOT NULL REFERENCES public.nvr_connections(id) ON DELETE RESTRICT,
  external_channel_id text NOT NULL,
  bucket_id text NOT NULL DEFAULT 'camera-snapshots',
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ready_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '15 minutes'),
  CONSTRAINT camera_snapshot_artifacts_channel_check CHECK (external_channel_id ~ '^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-6])$'),
  CONSTRAINT camera_snapshot_artifacts_bucket_check CHECK (bucket_id = 'camera-snapshots'),
  CONSTRAINT camera_snapshot_artifacts_path_check CHECK (
    storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
  ),
  CONSTRAINT camera_snapshot_artifacts_content_check CHECK (
    content_type = 'image/jpeg' AND byte_size BETWEEN 4 AND 5242880 AND sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT camera_snapshot_artifacts_status_check CHECK (
    (status = 'pending' AND ready_at IS NULL)
    OR (status = 'ready' AND ready_at IS NOT NULL)
  ),
  CONSTRAINT camera_snapshot_artifacts_expiry_check CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '15 minutes'
  )
);

CREATE INDEX camera_snapshot_artifacts_company_created_idx
  ON public.camera_snapshot_artifacts(company_id, created_at DESC);
CREATE INDEX camera_snapshot_artifacts_expiry_idx
  ON public.camera_snapshot_artifacts(expires_at);

ALTER TABLE public.camera_snapshot_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camera_snapshot_artifacts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.camera_snapshot_artifacts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.camera_snapshot_artifacts TO service_role;

INSERT INTO storage.buckets
  (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types, type)
VALUES
  ('camera-snapshots', 'camera-snapshots', false, false, 5242880, ARRAY['image/jpeg']::text[], 'STANDARD');

CREATE OR REPLACE FUNCTION private.valid_device_command_request(p_command_type text, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
BEGIN
  IF jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::text) > 8192 THEN
    RETURN false;
  END IF;
  IF p_command_type = 'network_reachability' THEN
    RETURN p_payload ?& ARRAY['portKind','timeoutMs']
      AND p_payload - ARRAY['portKind','timeoutMs'] = '{}'::jsonb
      AND p_payload->>'portKind' IN ('http','rtsp','onvif')
      AND jsonb_typeof(p_payload->'timeoutMs') = 'number'
      AND p_payload->>'timeoutMs' ~ '^[0-9]+$'
      AND (p_payload->>'timeoutMs')::integer BETWEEN 250 AND 10000;
  ELSIF p_command_type = 'snapshot_request' THEN
    RETURN p_payload ? 'channelId'
      AND p_payload - 'channelId' = '{}'::jsonb
      AND jsonb_typeof(p_payload->'channelId') = 'string'
      AND p_payload->>'channelId' ~ '^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-6])$';
  ELSIF p_command_type IN (
    'agent_health','nvr_capability_probe','nvr_health_diagnostics','channel_discovery'
  ) THEN
    RETURN p_payload = '{}'::jsonb;
  END IF;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION private.valid_device_command_result(p_command_type text, p_result jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
BEGIN
  IF jsonb_typeof(p_result) <> 'object' OR octet_length(p_result::text) > 65536 THEN RETURN false; END IF;
  IF p_command_type = 'agent_health' THEN
    RETURN p_result ?& ARRAY['agentVersion','platform','uptimeSeconds']
      AND p_result - ARRAY['agentVersion','platform','uptimeSeconds'] = '{}'::jsonb
      AND jsonb_typeof(p_result->'agentVersion') = 'string'
      AND char_length(p_result->>'agentVersion') BETWEEN 1 AND 80
      AND jsonb_typeof(p_result->'platform') = 'string'
      AND char_length(p_result->>'platform') BETWEEN 1 AND 40
      AND jsonb_typeof(p_result->'uptimeSeconds') = 'number'
      AND p_result->>'uptimeSeconds' ~ '^[0-9]+$'
      AND (p_result->>'uptimeSeconds')::integer BETWEEN 0 AND 31536000;
  ELSIF p_command_type = 'network_reachability' THEN
    RETURN p_result ?& ARRAY['reachable','portKind','latencyMs']
      AND p_result - ARRAY['reachable','portKind','latencyMs'] = '{}'::jsonb
      AND jsonb_typeof(p_result->'reachable') = 'boolean'
      AND p_result->>'portKind' IN ('http','rtsp','onvif')
      AND jsonb_typeof(p_result->'latencyMs') = 'number'
      AND p_result->>'latencyMs' ~ '^[0-9]+$'
      AND (p_result->>'latencyMs')::integer BETWEEN 0 AND 60000;
  ELSIF p_command_type = 'nvr_capability_probe' THEN
    IF NOT (p_result ?& ARRAY['vendor','capabilities'])
       OR p_result - ARRAY['vendor','capabilities'] <> '{}'::jsonb
       OR jsonb_typeof(p_result->'vendor') <> 'string'
       OR char_length(p_result->>'vendor') NOT BETWEEN 1 AND 80
       OR jsonb_typeof(p_result->'capabilities') <> 'array'
       OR jsonb_array_length(p_result->'capabilities') > 64 THEN RETURN false; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_result->'capabilities') LOOP
      IF jsonb_typeof(v_item) <> 'string' OR v_item #>> '{}' !~ '^[a-z][a-z0-9_.-]{1,79}$' THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF p_command_type = 'nvr_health_diagnostics' THEN
    RETURN p_result ?& ARRAY['healthy','vendor','model','softwareVersion','deviceTime','latencyMs']
      AND p_result - ARRAY['healthy','vendor','model','softwareVersion','deviceTime','latencyMs'] = '{}'::jsonb
      AND jsonb_typeof(p_result->'healthy') = 'boolean'
      AND jsonb_typeof(p_result->'vendor') = 'string' AND char_length(p_result->>'vendor') BETWEEN 1 AND 80
      AND jsonb_typeof(p_result->'model') = 'string' AND char_length(p_result->>'model') BETWEEN 1 AND 80
      AND jsonb_typeof(p_result->'softwareVersion') = 'string' AND char_length(p_result->>'softwareVersion') BETWEEN 1 AND 120
      AND jsonb_typeof(p_result->'deviceTime') = 'string' AND char_length(p_result->>'deviceTime') BETWEEN 1 AND 40
      AND jsonb_typeof(p_result->'latencyMs') = 'number' AND p_result->>'latencyMs' ~ '^[0-9]+$'
      AND (p_result->>'latencyMs')::integer BETWEEN 0 AND 60000;
  ELSIF p_command_type = 'channel_discovery' THEN
    IF NOT (p_result ? 'channels') OR p_result - 'channels' <> '{}'::jsonb
       OR jsonb_typeof(p_result->'channels') <> 'array'
       OR jsonb_array_length(p_result->'channels') > 256 THEN RETURN false; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_result->'channels') LOOP
      IF jsonb_typeof(v_item) <> 'object'
         OR NOT (v_item ?& ARRAY['externalChannelId','name','enabled','status'])
         OR v_item - ARRAY['externalChannelId','name','enabled','status'] <> '{}'::jsonb
         OR jsonb_typeof(v_item->'externalChannelId') <> 'string'
         OR v_item->>'externalChannelId' !~ '^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-6])$'
         OR jsonb_typeof(v_item->'name') <> 'string'
         OR char_length(v_item->>'name') NOT BETWEEN 1 AND 120
         OR jsonb_typeof(v_item->'enabled') <> 'boolean'
         OR v_item->>'status' NOT IN ('online','offline','disabled','error') THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF p_command_type = 'snapshot_request' THEN
    RETURN p_result ?& ARRAY['artifactId','contentType','capturedAt']
      AND p_result - ARRAY['artifactId','contentType','capturedAt'] = '{}'::jsonb
      AND p_result->>'artifactId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND p_result->>'contentType' = 'image/jpeg'
      AND jsonb_typeof(p_result->'capturedAt') = 'string'
      AND char_length(p_result->>'capturedAt') BETWEEN 1 AND 40;
  END IF;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;

ALTER TABLE public.device_command_audit
  DROP CONSTRAINT device_command_audit_event_check;
ALTER TABLE public.device_command_audit
  ADD CONSTRAINT device_command_audit_event_check CHECK (
    event_type IN (
      'command.enqueued','command.leased','command.completed','command.retry_scheduled',
      'command.lease_expired','command.expired','command.duplicate_completion',
      'snapshot.reserved','snapshot.ready'
    )
  );

CREATE FUNCTION public.reserve_device_snapshot_upload(
  p_public_agent_id uuid,
  p_credential_hash text,
  p_command_id uuid,
  p_lease_token uuid,
  p_channel_id text,
  p_content_type text,
  p_byte_size integer,
  p_sha256 text
)
RETURNS TABLE(artifact_id uuid, bucket_id text, storage_path text, duplicate_upload boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_agent record;
  v_command public.device_commands%ROWTYPE;
  v_artifact public.camera_snapshot_artifacts%ROWTYPE;
  v_inserted boolean := false;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_credential_hash !~ '^[0-9a-f]{64}$'
     OR p_channel_id !~ '^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-6])$'
     OR p_content_type <> 'image/jpeg'
     OR p_byte_size NOT BETWEEN 4 AND 5242880
     OR p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'SNAPSHOT_UPLOAD_INVALID'; END IF;
  SELECT agent.* INTO v_agent
  FROM private.resolve_device_command_agent(p_public_agent_id, p_credential_hash) AS agent;
  IF NOT FOUND THEN RAISE EXCEPTION 'SNAPSHOT_AGENT_UNAVAILABLE'; END IF;
  SELECT command.* INTO v_command
  FROM public.device_commands AS command
  WHERE command.id = p_command_id
    AND command.gateway_id = v_agent.gateway_id
    AND command.company_id = v_agent.company_id
    AND command.location_id = v_agent.location_id
    AND command.command_type = 'snapshot_request'
    AND command.status = 'leased'
    AND command.current_lease_token = p_lease_token
    AND command.current_lease_expires_at > v_now
    AND command.expires_at > v_now
  FOR UPDATE;
  IF NOT FOUND OR v_command.request_payload->>'channelId' <> p_channel_id THEN
    RAISE EXCEPTION 'SNAPSHOT_LEASE_INVALID';
  END IF;

  v_artifact.id := gen_random_uuid();
  v_artifact.storage_path := v_command.company_id::text || '/' || v_command.location_id::text || '/' ||
    v_command.id::text || '/' || v_artifact.id::text || '.jpg';
  INSERT INTO public.camera_snapshot_artifacts(
    id, command_id, company_id, location_id, gateway_id, nvr_connection_id,
    external_channel_id, storage_path, content_type, byte_size, sha256
  ) VALUES (
    v_artifact.id, v_command.id, v_command.company_id, v_command.location_id, v_command.gateway_id,
    v_command.nvr_connection_id, p_channel_id, v_artifact.storage_path, p_content_type, p_byte_size, p_sha256
  )
  ON CONFLICT(command_id) DO NOTHING
  RETURNING * INTO v_artifact;
  v_inserted := FOUND;
  IF NOT v_inserted THEN
    SELECT artifact.* INTO v_artifact
    FROM public.camera_snapshot_artifacts AS artifact
    WHERE artifact.command_id = v_command.id
    FOR UPDATE;
    IF NOT FOUND OR v_artifact.external_channel_id <> p_channel_id
       OR v_artifact.content_type <> p_content_type THEN RAISE EXCEPTION 'SNAPSHOT_UPLOAD_CONFLICT'; END IF;
    IF v_artifact.status = 'pending' THEN
      UPDATE public.camera_snapshot_artifacts AS artifact
      SET byte_size = p_byte_size, sha256 = p_sha256
      WHERE artifact.id = v_artifact.id
      RETURNING * INTO v_artifact;
    ELSIF v_artifact.byte_size <> p_byte_size OR v_artifact.sha256 <> p_sha256 THEN
      UPDATE public.camera_snapshot_artifacts AS artifact
      SET byte_size = p_byte_size, sha256 = p_sha256, status = 'pending', ready_at = NULL
      WHERE artifact.id = v_artifact.id
      RETURNING * INTO v_artifact;
    END IF;
  ELSE
    INSERT INTO public.device_command_audit(
      command_id, company_id, location_id, gateway_id, actor_kind, credential_id,
      event_type, outcome_code, attempt_number
    ) VALUES (
      v_command.id, v_command.company_id, v_command.location_id, v_command.gateway_id,
      'agent', v_agent.credential_id, 'snapshot.reserved', 'RESERVED', v_command.attempt_count
    );
  END IF;
  RETURN QUERY SELECT v_artifact.id, v_artifact.bucket_id, v_artifact.storage_path, NOT v_inserted;
END
$function$;

CREATE FUNCTION public.finalize_device_snapshot_upload(
  p_public_agent_id uuid,
  p_credential_hash text,
  p_command_id uuid,
  p_lease_token uuid,
  p_artifact_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_agent record;
  v_command public.device_commands%ROWTYPE;
  v_artifact public.camera_snapshot_artifacts%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT agent.* INTO v_agent
  FROM private.resolve_device_command_agent(p_public_agent_id, p_credential_hash) AS agent;
  IF NOT FOUND THEN RAISE EXCEPTION 'SNAPSHOT_AGENT_UNAVAILABLE'; END IF;
  SELECT command.* INTO v_command
  FROM public.device_commands AS command
  WHERE command.id = p_command_id AND command.gateway_id = v_agent.gateway_id
    AND command.company_id = v_agent.company_id AND command.location_id = v_agent.location_id
    AND command.command_type = 'snapshot_request' AND command.status = 'leased'
    AND command.current_lease_token = p_lease_token
    AND command.current_lease_expires_at > v_now AND command.expires_at > v_now
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SNAPSHOT_LEASE_INVALID'; END IF;
  SELECT artifact.* INTO v_artifact
  FROM public.camera_snapshot_artifacts AS artifact
  WHERE artifact.id = p_artifact_id AND artifact.command_id = v_command.id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SNAPSHOT_ARTIFACT_INVALID'; END IF;
  IF v_artifact.status = 'ready' THEN RETURN true; END IF;
  UPDATE public.camera_snapshot_artifacts AS artifact
  SET status = 'ready', ready_at = v_now
  WHERE artifact.id = v_artifact.id;
  INSERT INTO public.device_command_audit(
    command_id, company_id, location_id, gateway_id, actor_kind, credential_id,
    event_type, outcome_code, attempt_number
  ) VALUES (
    v_command.id, v_command.company_id, v_command.location_id, v_command.gateway_id,
    'agent', v_agent.credential_id, 'snapshot.ready', 'READY', v_command.attempt_count
  );
  RETURN true;
END
$function$;

CREATE FUNCTION public.get_device_snapshot_artifact(p_artifact_id uuid)
RETURNS TABLE(artifact_id uuid, bucket_id text, storage_path text, content_type text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT profile.* INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid() AND profile.status = 'active';
  IF NOT FOUND OR v_profile.company_id IS NULL
     OR v_profile.role NOT IN ('manager','owner','super_admin') THEN RAISE EXCEPTION 'SNAPSHOT_FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT artifact.id, artifact.bucket_id, artifact.storage_path, artifact.content_type, artifact.expires_at
  FROM public.camera_snapshot_artifacts AS artifact
  WHERE artifact.id = p_artifact_id
    AND artifact.company_id = v_profile.company_id
    AND artifact.status = 'ready'
    AND artifact.expires_at > clock_timestamp();
END
$function$;

CREATE OR REPLACE FUNCTION private.audit_device_configuration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_id uuid;
  v_entity_id uuid;
  v_actor_profile_id uuid := auth.uid();
  v_command_setting text;
  v_fields text[] := '{}';
BEGIN
  IF v_actor_profile_id IS NULL THEN
    v_command_setting := current_setting('app.device_command_id', true);
    IF v_command_setting ~ '^[0-9a-f-]{36}$' THEN
      SELECT command.created_by INTO v_actor_profile_id
      FROM public.device_commands AS command
      WHERE command.id = v_command_setting::uuid AND command.status = 'succeeded';
    END IF;
  END IF;
  IF v_actor_profile_id IS NULL THEN RAISE EXCEPTION 'CONFIGURATION_AUDIT_ACTOR_REQUIRED'; END IF;
  IF TG_OP = 'DELETE' THEN v_company_id := OLD.company_id; v_entity_id := OLD.id;
  ELSE v_company_id := NEW.company_id; v_entity_id := NEW.id; END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'cameras' THEN
    IF OLD.name IS DISTINCT FROM NEW.name THEN v_fields := array_append(v_fields, 'name'); END IF;
    IF OLD.area IS DISTINCT FROM NEW.area THEN v_fields := array_append(v_fields, 'area'); END IF;
    IF OLD.department IS DISTINCT FROM NEW.department THEN v_fields := array_append(v_fields, 'department'); END IF;
    IF OLD.ai_enabled IS DISTINCT FROM NEW.ai_enabled THEN v_fields := array_append(v_fields, 'ai_enabled'); END IF;
    IF OLD.task_verification_enabled IS DISTINCT FROM NEW.task_verification_enabled THEN
      v_fields := array_append(v_fields, 'task_verification_enabled');
    END IF;
  END IF;
  INSERT INTO public.device_configuration_audit(
    company_id, actor_profile_id, entity_type, entity_id, action, changed_fields
  ) VALUES (
    v_company_id, v_actor_profile_id,
    CASE WHEN TG_TABLE_NAME = 'cameras' THEN 'camera' ELSE 'nvr_connection' END,
    v_entity_id,
    CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END,
    v_fields
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

CREATE FUNCTION private.apply_dahua_command_result()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_nvr public.nvr_connections%ROWTYPE;
  v_channel jsonb;
  v_discovered_ids text[] := '{}';
  v_artifact_id uuid;
BEGIN
  IF OLD.status = 'succeeded' OR NEW.status <> 'succeeded' THEN RETURN NEW; END IF;
  IF NEW.command_type NOT IN ('channel_discovery','snapshot_request','nvr_health_diagnostics','nvr_capability_probe') THEN
    RETURN NEW;
  END IF;
  SELECT nvr.* INTO v_nvr
  FROM public.nvr_connections AS nvr
  WHERE nvr.id = NEW.nvr_connection_id
    AND nvr.company_id = NEW.company_id
    AND nvr.location_id = NEW.location_id
    AND nvr.gateway_id = NEW.gateway_id
    AND lower(btrim(nvr.vendor)) = 'dahua'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DAHUA_RESULT_TARGET_INVALID'; END IF;
  PERFORM set_config('app.device_command_id', NEW.id::text, true);

  IF NEW.command_type = 'snapshot_request' THEN
    v_artifact_id := (NEW.result_payload->>'artifactId')::uuid;
    IF NOT EXISTS (
      SELECT 1 FROM public.camera_snapshot_artifacts AS artifact
      WHERE artifact.id = v_artifact_id AND artifact.command_id = NEW.id
        AND artifact.nvr_connection_id = v_nvr.id AND artifact.status = 'ready'
        AND artifact.expires_at > clock_timestamp()
    ) THEN RAISE EXCEPTION 'SNAPSHOT_RESULT_INVALID'; END IF;
  ELSIF NEW.command_type = 'channel_discovery' THEN
    FOR v_channel IN SELECT value FROM jsonb_array_elements(NEW.result_payload->'channels') LOOP
      v_discovered_ids := array_append(v_discovered_ids, v_channel->>'externalChannelId');
      INSERT INTO public.cameras(
        company_id, location_id, nvr_connection_id, external_channel_id, name, status, last_seen_at
      ) VALUES (
        NEW.company_id, NEW.location_id, v_nvr.id, v_channel->>'externalChannelId',
        v_channel->>'name', v_channel->>'status',
        CASE WHEN v_channel->>'status' = 'online' THEN clock_timestamp() ELSE NULL END
      )
      ON CONFLICT(nvr_connection_id, external_channel_id) DO UPDATE SET
        name = CASE WHEN cameras.status = 'unconfigured' THEN EXCLUDED.name ELSE cameras.name END,
        status = EXCLUDED.status,
        last_seen_at = CASE WHEN EXCLUDED.status = 'online' THEN clock_timestamp() ELSE cameras.last_seen_at END,
        updated_at = clock_timestamp();
    END LOOP;
    UPDATE public.cameras AS camera
    SET status = 'offline', updated_at = clock_timestamp()
    WHERE camera.nvr_connection_id = v_nvr.id
      AND NOT (camera.external_channel_id = ANY(v_discovered_ids))
      AND camera.status <> 'disabled';
  END IF;

  UPDATE public.nvr_connections AS nvr
  SET status = 'online', last_tested_at = clock_timestamp(), last_error_code = NULL,
    updated_at = clock_timestamp()
  WHERE nvr.id = v_nvr.id;
  RETURN NEW;
END
$function$;

CREATE TRIGGER device_commands_apply_dahua_result
AFTER UPDATE OF status ON public.device_commands
FOR EACH ROW
WHEN (NEW.status = 'succeeded')
EXECUTE FUNCTION private.apply_dahua_command_result();

REVOKE ALL ON FUNCTION public.reserve_device_snapshot_upload(uuid,text,uuid,uuid,text,text,integer,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_device_snapshot_upload(uuid,text,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_device_snapshot_artifact(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.apply_dahua_command_result()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.reserve_device_snapshot_upload(uuid,text,uuid,uuid,text,text,integer,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_device_snapshot_upload(uuid,text,uuid,uuid,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_device_snapshot_artifact(uuid)
  TO authenticated;

COMMIT;
