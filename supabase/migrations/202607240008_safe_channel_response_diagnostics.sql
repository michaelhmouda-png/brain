-- Safe structural diagnostics for fixed, read-only Dahua channel-list responses.
BEGIN;

CREATE FUNCTION private.valid_channel_discovery_diagnostic(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
  v_known jsonb;
BEGIN
  IF jsonb_typeof(p_value) <> 'object'
     OR NOT (p_value ?& ARRAY[
       'httpStatus','contentType','responseByteLength','responseLineCount',
       'responseFormat','sanitizedKeys','sections','repeatedChannelLikeRecords',
       'knownFields','parserBranch','safeParseFailureCode','responseTimeMs','requestId'
     ])
     OR p_value - ARRAY[
       'httpStatus','contentType','responseByteLength','responseLineCount',
       'responseFormat','sanitizedKeys','sections','repeatedChannelLikeRecords',
       'knownFields','parserBranch','safeParseFailureCode','responseTimeMs','requestId'
     ] <> '{}'::jsonb
     OR jsonb_typeof(p_value->'httpStatus') <> 'number'
     OR p_value->>'httpStatus' !~ '^[0-9]+$'
     OR (p_value->>'httpStatus')::integer NOT BETWEEN 100 AND 599
     OR p_value->>'contentType' NOT IN (
       'text/plain','application/json','text/html','application/octet-stream','unknown'
     )
     OR jsonb_typeof(p_value->'responseByteLength') <> 'number'
     OR p_value->>'responseByteLength' !~ '^[0-9]+$'
     OR (p_value->>'responseByteLength')::integer NOT BETWEEN 0 AND 1048576
     OR jsonb_typeof(p_value->'responseLineCount') <> 'number'
     OR p_value->>'responseLineCount' !~ '^[0-9]+$'
     OR (p_value->>'responseLineCount')::integer NOT BETWEEN 0 AND 1048576
     OR p_value->>'responseFormat' NOT IN (
       'key_value_lines','json','xml','html','unknown_text','binary'
     )
     OR jsonb_typeof(p_value->'sanitizedKeys') <> 'array'
     OR jsonb_array_length(p_value->'sanitizedKeys') > 64
     OR jsonb_typeof(p_value->'sections') <> 'array'
     OR jsonb_array_length(p_value->'sections') > 16
     OR jsonb_typeof(p_value->'repeatedChannelLikeRecords') <> 'number'
     OR p_value->>'repeatedChannelLikeRecords' !~ '^[0-9]+$'
     OR (p_value->>'repeatedChannelLikeRecords')::integer NOT BETWEEN 0 AND 256
     OR p_value->>'parserBranch' NOT IN (
       'result_records_v1','no_supported_records','unknown_response'
     )
     OR NOT (
       jsonb_typeof(p_value->'safeParseFailureCode') = 'null'
       OR p_value->>'safeParseFailureCode' IN (
         'NO_SUPPORTED_CHANNEL_RECORDS','UNKNOWN_CHANNEL_RESPONSE_FORMAT'
       )
     )
     OR jsonb_typeof(p_value->'responseTimeMs') <> 'number'
     OR p_value->>'responseTimeMs' !~ '^[0-9]+$'
     OR (p_value->>'responseTimeMs')::integer NOT BETWEEN 0 AND 60000
     OR p_value->>'requestId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_value->'sanitizedKeys') LOOP
    IF jsonb_typeof(v_item) <> 'string'
       OR v_item #>> '{}' !~ '^[A-Za-z][A-Za-z0-9]{0,63}$'
       OR v_item #>> '{}' ~* '(password|username|address|ip|mac|serial|url|uri|token|credential)' THEN
      RETURN false;
    END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_value->'sections') LOOP
    IF jsonb_typeof(v_item) <> 'string'
       OR v_item #>> '{}' NOT IN ('result[*]','table.All[*]','table.Channel[*]') THEN
      RETURN false;
    END IF;
  END LOOP;

  v_known := p_value->'knownFields';
  IF jsonb_typeof(v_known) <> 'object'
     OR NOT (v_known ?& ARRAY[
       'uniqueChannel','deviceName','channelName','name','enabled',
       'connectionState','state','resolution','codec'
     ])
     OR v_known - ARRAY[
       'uniqueChannel','deviceName','channelName','name','enabled',
       'connectionState','state','resolution','codec'
     ] <> '{}'::jsonb THEN
    RETURN false;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_each(v_known) LOOP
    IF jsonb_typeof(v_item) <> 'boolean' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION private.valid_device_command_request(
  p_command_type text,
  p_payload jsonb
)
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
  ELSIF p_command_type = 'channel_discovery' THEN
    RETURN p_payload = '{}'::jsonb
      OR (
        p_payload ? 'diagnostic'
        AND p_payload - 'diagnostic' = '{}'::jsonb
        AND p_payload->'diagnostic' = 'true'::jsonb
      );
  ELSIF p_command_type IN (
    'agent_health','nvr_capability_probe','nvr_health_diagnostics'
  ) THEN
    RETURN p_payload = '{}'::jsonb;
  END IF;
  RETURN false;
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
    RETURN p_result ?& ARRAY['reachable','portKind','latencyMs','resolution','safeFailureCode']
      AND p_result - ARRAY['reachable','portKind','latencyMs','resolution','safeFailureCode'] = '{}'::jsonb
      AND jsonb_typeof(p_result->'reachable') = 'boolean'
      AND p_result->>'portKind' IN ('http','rtsp','onvif')
      AND jsonb_typeof(p_result->'latencyMs') = 'number'
      AND p_result->>'latencyMs' ~ '^[0-9]+$'
      AND (p_result->>'latencyMs')::integer BETWEEN 0 AND 60000
      AND p_result->>'resolution' IN (
        'literal_private_ipv4','literal_private_ipv6',
        'resolved_private_ipv4','resolved_private_ipv6'
      )
      AND (
        (p_result->>'reachable' = 'true' AND jsonb_typeof(p_result->'safeFailureCode') = 'null')
        OR
        (p_result->>'reachable' = 'false'
          AND p_result->>'safeFailureCode' IN (
            'NETWORK_UNREACHABLE','CONNECTION_REFUSED','CONNECTION_TIMEOUT'
          ))
      );
  ELSIF p_command_type IN ('nvr_capability_probe','nvr_health_diagnostics') THEN
    RETURN private.valid_nvr_probe_result(p_result);
  ELSIF p_command_type = 'channel_discovery' THEN
    IF NOT (p_result ?& ARRAY['channels','diagnostic'])
       OR p_result - ARRAY['channels','diagnostic'] <> '{}'::jsonb
       OR jsonb_typeof(p_result->'channels') <> 'array'
       OR jsonb_array_length(p_result->'channels') > 256
       OR private.valid_channel_discovery_diagnostic(p_result->'diagnostic') IS NOT TRUE THEN
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

CREATE OR REPLACE FUNCTION private.apply_dahua_command_result()
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

  IF NEW.command_type = 'channel_discovery'
     AND NEW.result_payload#>>'{diagnostic,requestId}' IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'DAHUA_CHANNEL_DIAGNOSTIC_REQUEST_INVALID';
  END IF;
  IF NEW.command_type = 'channel_discovery'
     AND NEW.request_payload = '{"diagnostic":true}'::jsonb THEN
    RETURN NEW;
  END IF;

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

ALTER FUNCTION private.valid_channel_discovery_diagnostic(jsonb) OWNER TO postgres;
ALTER FUNCTION private.valid_device_command_request(text,jsonb) OWNER TO postgres;
ALTER FUNCTION private.valid_device_command_result(text,jsonb) OWNER TO postgres;
ALTER FUNCTION private.apply_dahua_command_result() OWNER TO postgres;

REVOKE ALL ON FUNCTION private.valid_channel_discovery_diagnostic(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.valid_device_command_request(text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.valid_device_command_result(text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.apply_dahua_command_result()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
