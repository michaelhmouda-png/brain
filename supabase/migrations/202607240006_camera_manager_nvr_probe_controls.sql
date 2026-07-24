-- Authenticated Camera Manager controls for safe, read-only NVR probes.
-- Local credential presence is represented only by assigned NVR UUIDs reported
-- during an authenticated Agent heartbeat. No credential material is stored.

BEGIN;

CREATE TABLE public.device_nvr_credential_presence (
  nvr_connection_id uuid PRIMARY KEY REFERENCES public.nvr_connections(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  gateway_id uuid NOT NULL REFERENCES public.device_gateways(id) ON DELETE CASCADE,
  reported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT device_nvr_credential_presence_reported_check
    CHECK (reported_at <= clock_timestamp() + interval '1 minute')
);

CREATE INDEX device_nvr_credential_presence_gateway_reported_idx
  ON public.device_nvr_credential_presence(gateway_id, reported_at DESC);

CREATE UNIQUE INDEX device_commands_active_nvr_probe_uidx
  ON public.device_commands(company_id, nvr_connection_id, command_type)
  WHERE status IN ('pending','leased')
    AND command_type IN ('nvr_capability_probe','nvr_health_diagnostics');

ALTER TABLE public.device_nvr_credential_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_nvr_credential_presence FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.device_nvr_credential_presence
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.device_nvr_credential_presence TO service_role;

CREATE FUNCTION private.valid_credentialed_nvr_ids(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
BEGIN
  IF jsonb_typeof(p_value) <> 'array' OR jsonb_array_length(p_value) > 256 THEN
    RETURN false;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
    IF jsonb_typeof(v_item) <> 'string'
       OR v_item #>> '{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;

CREATE FUNCTION public.authenticate_device_agent_heartbeat(
  p_public_agent_id uuid,
  p_credential_hash text,
  p_agent_version text,
  p_platform text,
  p_os_version text,
  p_hostname_label text,
  p_declared_capabilities jsonb,
  p_credentialed_nvr_ids jsonb
)
RETURNS TABLE(
  gateway_id uuid,
  company_id uuid,
  location_id uuid,
  polling_interval_seconds integer,
  approved_capabilities jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_heartbeat record;
BEGIN
  IF private.valid_credentialed_nvr_ids(p_credentialed_nvr_ids) IS NOT TRUE THEN
    RAISE EXCEPTION 'AGENT_CREDENTIAL_PRESENCE_INVALID';
  END IF;

  SELECT heartbeat.* INTO v_heartbeat
  FROM public.authenticate_device_agent_heartbeat(
    p_public_agent_id,
    p_credential_hash,
    p_agent_version,
    p_platform,
    p_os_version,
    p_hostname_label,
    p_declared_capabilities
  ) AS heartbeat;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('credential-presence|' || v_heartbeat.gateway_id::text, 0)
  );

  DELETE FROM public.device_nvr_credential_presence AS presence
  WHERE presence.gateway_id = v_heartbeat.gateway_id;

  INSERT INTO public.device_nvr_credential_presence(
    nvr_connection_id, company_id, location_id, gateway_id, reported_at
  )
  SELECT
    nvr.id, nvr.company_id, nvr.location_id, nvr.gateway_id, clock_timestamp()
  FROM public.nvr_connections AS nvr
  JOIN (
    SELECT DISTINCT (value #>> '{}')::uuid AS nvr_connection_id
    FROM jsonb_array_elements(p_credentialed_nvr_ids)
  ) AS reported ON reported.nvr_connection_id = nvr.id
  WHERE nvr.company_id = v_heartbeat.company_id
    AND nvr.location_id = v_heartbeat.location_id
    AND nvr.gateway_id = v_heartbeat.gateway_id
  ON CONFLICT ON CONSTRAINT device_nvr_credential_presence_pkey DO UPDATE SET
    company_id = EXCLUDED.company_id,
    location_id = EXCLUDED.location_id,
    gateway_id = EXCLUDED.gateway_id,
    reported_at = EXCLUDED.reported_at;

  RETURN QUERY SELECT
    v_heartbeat.gateway_id,
    v_heartbeat.company_id,
    v_heartbeat.location_id,
    v_heartbeat.polling_interval_seconds,
    v_heartbeat.approved_capabilities;
END
$function$;

CREATE FUNCTION private.valid_nvr_probe_result(p_result jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
BEGIN
  IF jsonb_typeof(p_result) <> 'object'
     OR NOT (p_result ?& ARRAY[
       'vendor','model','firmwareVersion','capabilities','healthy','responseTimeMs'
     ])
     OR p_result - ARRAY[
       'vendor','model','firmwareVersion','capabilities','healthy','responseTimeMs'
     ] <> '{}'::jsonb
     OR jsonb_typeof(p_result->'vendor') <> 'string'
     OR char_length(p_result->>'vendor') NOT BETWEEN 1 AND 80
     OR jsonb_typeof(p_result->'model') <> 'string'
     OR char_length(p_result->>'model') NOT BETWEEN 1 AND 80
     OR jsonb_typeof(p_result->'firmwareVersion') <> 'string'
     OR char_length(p_result->>'firmwareVersion') NOT BETWEEN 1 AND 120
     OR jsonb_typeof(p_result->'healthy') <> 'boolean'
     OR jsonb_typeof(p_result->'responseTimeMs') <> 'number'
     OR p_result->>'responseTimeMs' !~ '^[0-9]+$'
     OR (p_result->>'responseTimeMs')::integer NOT BETWEEN 0 AND 60000
     OR jsonb_typeof(p_result->'capabilities') <> 'array'
     OR jsonb_array_length(p_result->'capabilities') > 64 THEN
    RETURN false;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_result->'capabilities') LOOP
    IF jsonb_typeof(v_item) <> 'string'
       OR v_item #>> '{}' !~ '^[a-z][a-z0-9_.-]{1,79}$' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION private.valid_device_command_result(
  p_command_type text,
  p_result jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
BEGIN
  IF jsonb_typeof(p_result) <> 'object' OR octet_length(p_result::text) > 65536 THEN
    RETURN false;
  END IF;
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
  ELSIF p_command_type IN ('nvr_capability_probe','nvr_health_diagnostics') THEN
    RETURN private.valid_nvr_probe_result(p_result);
  ELSIF p_command_type = 'channel_discovery' THEN
    IF NOT (p_result ? 'channels') OR p_result - 'channels' <> '{}'::jsonb
       OR jsonb_typeof(p_result->'channels') <> 'array'
       OR jsonb_array_length(p_result->'channels') > 256 THEN
      RETURN false;
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_result->'channels') LOOP
      IF jsonb_typeof(v_item) <> 'object'
         OR NOT (v_item ?& ARRAY['externalChannelId','name','enabled','status'])
         OR v_item - ARRAY['externalChannelId','name','enabled','status'] <> '{}'::jsonb
         OR jsonb_typeof(v_item->'externalChannelId') <> 'string'
         OR v_item->>'externalChannelId' !~ '^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-6])$'
         OR jsonb_typeof(v_item->'name') <> 'string'
         OR char_length(v_item->>'name') NOT BETWEEN 1 AND 120
         OR jsonb_typeof(v_item->'enabled') <> 'boolean'
         OR v_item->>'status' NOT IN ('online','offline','disabled','error') THEN
        RETURN false;
      END IF;
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

CREATE FUNCTION private.sanitized_nvr_probe_result(
  p_command_type text,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_command_type IN ('nvr_capability_probe','nvr_health_diagnostics')
      AND private.valid_nvr_probe_result(p_result)
    THEN jsonb_build_object(
      'vendor', p_result->'vendor',
      'model', p_result->'model',
      'firmwareVersion', p_result->'firmwareVersion',
      'capabilities', p_result->'capabilities',
      'healthy', p_result->'healthy',
      'responseTimeMs', p_result->'responseTimeMs'
    )
    ELSE NULL
  END
$function$;

CREATE FUNCTION public.get_nvr_probe_control_state(p_nvr_connection_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_nvr public.nvr_connections%ROWTYPE;
  v_gateway public.device_gateways%ROWTYPE;
  v_assignment_compatible boolean := false;
  v_gateway_online boolean := false;
  v_credentials_present boolean := false;
  v_transport_available boolean := false;
  v_reason text;
  v_commands jsonb;
  v_expired_command_id uuid;
BEGIN
  SELECT profile.* INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid() AND profile.status = 'active';
  IF NOT FOUND OR v_profile.company_id IS NULL
     OR v_profile.role NOT IN ('owner','super_admin') THEN
    RAISE EXCEPTION 'NVR_PROBE_FORBIDDEN';
  END IF;

  SELECT nvr.* INTO v_nvr
  FROM public.nvr_connections AS nvr
  WHERE nvr.id = p_nvr_connection_id
    AND nvr.company_id = v_profile.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NVR_PROBE_NOT_FOUND';
  END IF;

  IF v_nvr.gateway_id IS NOT NULL THEN
    SELECT gateway.* INTO v_gateway
    FROM public.device_gateways AS gateway
    WHERE gateway.id = v_nvr.gateway_id
      AND gateway.company_id = v_nvr.company_id;
  END IF;

  v_assignment_compatible := v_gateway.id IS NOT NULL
    AND v_gateway.location_id = v_nvr.location_id;
  v_gateway_online := v_assignment_compatible
    AND v_gateway.status = 'online'
    AND v_gateway.last_seen_at > clock_timestamp() - interval '3 minutes';
  v_credentials_present := v_assignment_compatible AND EXISTS (
    SELECT 1
    FROM public.device_nvr_credential_presence AS presence
    WHERE presence.nvr_connection_id = v_nvr.id
      AND presence.company_id = v_nvr.company_id
      AND presence.location_id = v_nvr.location_id
      AND presence.gateway_id = v_gateway.id
      AND presence.reported_at > clock_timestamp() - interval '3 minutes'
  );
  v_transport_available := v_assignment_compatible AND EXISTS (
    SELECT 1
    FROM public.device_gateway_capabilities AS capability
    JOIN public.device_capability_catalog AS catalog
      ON catalog.capability_code = capability.capability_code
    WHERE capability.gateway_id = v_gateway.id
      AND capability.capability_code = 'brain.command.transport.v1'
      AND capability.approved
      AND capability.revoked_at IS NULL
      AND catalog.enabled
  );

  v_reason := CASE
    WHEN v_nvr.gateway_id IS NULL THEN 'NVR_PROBE_GATEWAY_UNASSIGNED'
    WHEN NOT v_assignment_compatible THEN 'NVR_PROBE_ASSIGNMENT_INCOMPATIBLE'
    WHEN NOT v_gateway_online THEN 'NVR_PROBE_GATEWAY_OFFLINE'
    WHEN NOT v_transport_available THEN 'NVR_PROBE_TRANSPORT_UNAVAILABLE'
    WHEN NOT v_credentials_present THEN 'NVR_PROBE_CREDENTIALS_NOT_REPORTED'
    ELSE NULL
  END;

  FOR v_expired_command_id IN
    SELECT candidate.id
    FROM public.device_commands AS candidate
    WHERE candidate.company_id = v_profile.company_id
      AND candidate.nvr_connection_id = v_nvr.id
      AND candidate.command_type IN ('nvr_capability_probe','nvr_health_diagnostics')
      AND candidate.status IN ('pending','leased')
      AND candidate.expires_at <= clock_timestamp()
  LOOP
    PERFORM *
    FROM public.get_device_command(v_expired_command_id);
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'commandId', command.id,
    'requestId', command.id,
    'commandType', command.command_type,
    'status', command.status,
    'attemptCount', command.attempt_count,
    'safeFailureCode', command.error_code,
    'result', private.sanitized_nvr_probe_result(command.command_type, command.result_payload),
    'createdAt', command.created_at,
    'expiresAt', command.expires_at,
    'completedAt', command.completed_at
  ) ORDER BY command.command_type), '[]'::jsonb)
  INTO v_commands
  FROM (
    SELECT DISTINCT ON (candidate.command_type) candidate.*
    FROM public.device_commands AS candidate
    WHERE candidate.company_id = v_profile.company_id
      AND candidate.nvr_connection_id = v_nvr.id
      AND candidate.command_type IN ('nvr_capability_probe','nvr_health_diagnostics')
    ORDER BY candidate.command_type, candidate.created_at DESC
  ) AS command;

  RETURN jsonb_build_object(
    'nvrConnectionId', v_nvr.id,
    'gatewayId', v_nvr.gateway_id,
    'eligible', v_reason IS NULL,
    'assignmentCompatible', v_assignment_compatible,
    'gatewayOnline', v_gateway_online,
    'credentialsPresent', v_credentials_present,
    'safeUnavailableCode', v_reason,
    'commands', v_commands
  );
END
$function$;

CREATE FUNCTION public.enqueue_nvr_probe_command(
  p_nvr_connection_id uuid,
  p_command_type text,
  p_idempotency_key uuid,
  p_ttl_seconds integer
)
RETURNS TABLE(
  command_id uuid,
  command_status text,
  command_expires_at timestamptz,
  duplicate_request boolean,
  duplicate_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_nvr public.nvr_connections%ROWTYPE;
  v_gateway public.device_gateways%ROWTYPE;
  v_command public.device_commands%ROWTYPE;
  v_enqueued record;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT profile.* INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid() AND profile.status = 'active';
  IF NOT FOUND OR v_profile.company_id IS NULL
     OR v_profile.role NOT IN ('owner','super_admin') THEN
    RAISE EXCEPTION 'NVR_PROBE_FORBIDDEN';
  END IF;
  IF p_command_type NOT IN ('nvr_capability_probe','nvr_health_diagnostics')
     OR p_idempotency_key IS NULL OR p_ttl_seconds NOT BETWEEN 30 AND 600 THEN
    RAISE EXCEPTION 'NVR_PROBE_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_nvr_connection_id::text || '|' || p_command_type, 0)
  );

  SELECT nvr.* INTO v_nvr
  FROM public.nvr_connections AS nvr
  WHERE nvr.id = p_nvr_connection_id
    AND nvr.company_id = v_profile.company_id
    AND nvr.gateway_id IS NOT NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NVR_PROBE_NOT_FOUND';
  END IF;
  SELECT gateway.* INTO v_gateway
  FROM public.device_gateways AS gateway
  WHERE gateway.id = v_nvr.gateway_id
    AND gateway.company_id = v_nvr.company_id
    AND gateway.location_id = v_nvr.location_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NVR_PROBE_ASSIGNMENT_INCOMPATIBLE';
  END IF;
  IF v_gateway.status <> 'online'
     OR v_gateway.last_seen_at <= v_now - interval '3 minutes' THEN
    RAISE EXCEPTION 'NVR_PROBE_GATEWAY_OFFLINE';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.device_nvr_credential_presence AS presence
    WHERE presence.nvr_connection_id = v_nvr.id
      AND presence.company_id = v_nvr.company_id
      AND presence.location_id = v_nvr.location_id
      AND presence.gateway_id = v_gateway.id
      AND presence.reported_at > v_now - interval '3 minutes'
  ) THEN
    RAISE EXCEPTION 'NVR_PROBE_CREDENTIALS_NOT_REPORTED';
  END IF;

  FOR v_command IN
    SELECT candidate.*
    FROM public.device_commands AS candidate
    WHERE candidate.company_id = v_profile.company_id
      AND candidate.nvr_connection_id = v_nvr.id
      AND candidate.command_type = p_command_type
      AND candidate.status IN ('pending','leased')
      AND candidate.expires_at <= v_now
    FOR UPDATE
  LOOP
    UPDATE public.device_command_attempts AS attempt
    SET completed_at = v_now,
      outcome = 'command_expired',
      error_code = 'COMMAND_EXPIRED',
      retryable = false
    WHERE attempt.command_id = v_command.id
      AND attempt.completed_at IS NULL;
    UPDATE public.device_commands AS command
    SET status = 'expired',
      current_lease_token = NULL,
      current_lease_expires_at = NULL,
      error_code = 'COMMAND_EXPIRED',
      completed_at = v_now,
      updated_at = v_now
    WHERE command.id = v_command.id;
    INSERT INTO public.device_command_audit(
      command_id, company_id, location_id, gateway_id,
      actor_kind, event_type, outcome_code
    ) VALUES (
      v_command.id, v_command.company_id, v_command.location_id, v_command.gateway_id,
      'system', 'command.expired', 'COMMAND_EXPIRED'
    );
  END LOOP;

  SELECT candidate.* INTO v_command
  FROM public.device_commands AS candidate
  WHERE candidate.company_id = v_profile.company_id
    AND candidate.nvr_connection_id = v_nvr.id
    AND candidate.command_type = p_command_type
    AND candidate.status IN ('pending','leased')
  ORDER BY candidate.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT
      v_command.id, v_command.status, v_command.expires_at, false, true;
    RETURN;
  END IF;

  SELECT enqueued.* INTO v_enqueued
  FROM public.enqueue_device_command(
    v_gateway.id,
    v_nvr.id,
    p_command_type,
    p_idempotency_key,
    '{}'::jsonb,
    p_ttl_seconds
  ) AS enqueued;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NVR_PROBE_NOT_ENQUEUED';
  END IF;
  RETURN QUERY SELECT
    v_enqueued.command_id,
    v_enqueued.command_status,
    v_enqueued.command_expires_at,
    v_enqueued.duplicate_request,
    false;
END
$function$;

ALTER FUNCTION public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb,jsonb)
  OWNER TO postgres;
ALTER FUNCTION private.valid_credentialed_nvr_ids(jsonb) OWNER TO postgres;
ALTER FUNCTION private.valid_nvr_probe_result(jsonb) OWNER TO postgres;
ALTER FUNCTION private.valid_device_command_result(text,jsonb) OWNER TO postgres;
ALTER FUNCTION private.sanitized_nvr_probe_result(text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.get_nvr_probe_control_state(uuid) OWNER TO postgres;
ALTER FUNCTION public.enqueue_nvr_probe_command(uuid,text,uuid,integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.valid_credentialed_nvr_ids(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.valid_nvr_probe_result(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.valid_device_command_result(text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sanitized_nvr_probe_result(text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_nvr_probe_control_state(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_nvr_probe_command(uuid,text,uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_nvr_probe_control_state(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_nvr_probe_command(uuid,text,uuid,integer)
  TO authenticated;

COMMIT;
