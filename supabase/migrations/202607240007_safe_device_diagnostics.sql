-- Safe, bounded Device Agent diagnostics for read-only NVR operations.
BEGIN;

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

CREATE FUNCTION private.valid_device_safe_diagnostic(
  p_command_id uuid,
  p_error_code text,
  p_diagnostic jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
  SELECT jsonb_typeof(p_diagnostic) = 'object'
    AND p_diagnostic ?& ARRAY[
      'safeErrorCode','httpStatus','operation','responseTimeMs','requestId'
    ]
    AND p_diagnostic - ARRAY[
      'safeErrorCode','httpStatus','operation','responseTimeMs','requestId'
    ] = '{}'::jsonb
    AND p_diagnostic->>'safeErrorCode' = p_error_code
    AND p_diagnostic->>'safeErrorCode' IN (
      'NETWORK_UNREACHABLE','CONNECTION_REFUSED','CONNECTION_TIMEOUT',
      'TLS_OR_PROTOCOL_MISMATCH','HTTP_UNAUTHORIZED','HTTP_FORBIDDEN',
      'HTTP_NOT_FOUND','DIGEST_AUTH_FAILED','MALFORMED_DAHUA_RESPONSE',
      'RESPONSE_LIMIT_EXCEEDED','NVR_REQUEST_FAILED'
    )
    AND (
      jsonb_typeof(p_diagnostic->'httpStatus') = 'null'
      OR (
        jsonb_typeof(p_diagnostic->'httpStatus') = 'number'
        AND p_diagnostic->>'httpStatus' ~ '^[0-9]+$'
        AND (p_diagnostic->>'httpStatus')::integer BETWEEN 100 AND 599
      )
    )
    AND p_diagnostic->>'operation' IN (
      'system_info','current_time','camera_inventory','snapshot'
    )
    AND jsonb_typeof(p_diagnostic->'responseTimeMs') = 'number'
    AND p_diagnostic->>'responseTimeMs' ~ '^[0-9]+$'
    AND (p_diagnostic->>'responseTimeMs')::integer BETWEEN 0 AND 60000
    AND p_diagnostic->>'requestId' = p_command_id::text
$function$;

CREATE FUNCTION public.complete_device_command_v2(
  p_public_agent_id uuid,
  p_credential_hash text,
  p_command_id uuid,
  p_command_type text,
  p_lease_token uuid,
  p_outcome text,
  p_result_payload jsonb,
  p_error_code text,
  p_retryable boolean,
  p_diagnostic_payload jsonb
)
RETURNS TABLE(command_id uuid, command_status text, duplicate_delivery boolean, next_attempt_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_agent record;
  v_completed record;
  v_attempt public.device_command_attempts%ROWTYPE;
BEGIN
  IF p_diagnostic_payload IS NOT NULL
     AND (
       p_outcome <> 'failed'
       OR private.valid_device_safe_diagnostic(
         p_command_id, p_error_code, p_diagnostic_payload
       ) IS NOT TRUE
     ) THEN
    RAISE EXCEPTION 'DEVICE_COMMAND_DIAGNOSTIC_INVALID';
  END IF;

  SELECT completed.* INTO v_completed
  FROM public.complete_device_command(
    p_public_agent_id,
    p_credential_hash,
    p_command_id,
    p_command_type,
    p_lease_token,
    p_outcome,
    p_result_payload,
    p_error_code,
    p_retryable
  ) AS completed;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEVICE_COMMAND_COMPLETION_MISSING';
  END IF;

  IF p_diagnostic_payload IS NOT NULL THEN
    SELECT agent.* INTO v_agent
    FROM private.resolve_device_command_agent(
      p_public_agent_id, p_credential_hash
    ) AS agent;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DEVICE_COMMAND_AGENT_UNAVAILABLE';
    END IF;

    SELECT attempt.* INTO v_attempt
    FROM public.device_command_attempts AS attempt
    JOIN public.device_commands AS command ON command.id = attempt.command_id
    WHERE attempt.command_id = p_command_id
      AND attempt.lease_token = p_lease_token
      AND attempt.credential_id = v_agent.credential_id
      AND command.gateway_id = v_agent.gateway_id
      AND command.company_id = v_agent.company_id
      AND command.location_id = v_agent.location_id
      AND command.command_type = p_command_type
    FOR UPDATE OF attempt;
    IF NOT FOUND OR v_attempt.completed_at IS NULL
       OR v_attempt.error_code IS DISTINCT FROM p_error_code THEN
      RAISE EXCEPTION 'DEVICE_COMMAND_DIAGNOSTIC_TARGET_INVALID';
    END IF;
    IF v_attempt.result_payload IS NOT NULL
       AND v_attempt.result_payload IS DISTINCT FROM p_diagnostic_payload THEN
      RAISE EXCEPTION 'DEVICE_COMMAND_DIAGNOSTIC_CONFLICT';
    END IF;

    UPDATE public.device_command_attempts AS attempt
    SET result_payload = p_diagnostic_payload
    WHERE attempt.id = v_attempt.id
      AND attempt.result_payload IS NULL;

    IF v_completed.command_status = 'failed' THEN
      UPDATE public.device_commands AS command
      SET result_payload = p_diagnostic_payload
      WHERE command.id = p_command_id;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_completed.command_id,
    v_completed.command_status,
    v_completed.duplicate_delivery,
    v_completed.next_attempt_at;
END
$function$;

ALTER FUNCTION private.valid_device_command_result(text,jsonb) OWNER TO postgres;
ALTER FUNCTION private.valid_device_safe_diagnostic(uuid,text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.complete_device_command_v2(
  uuid,text,uuid,text,uuid,text,jsonb,text,boolean,jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.valid_device_safe_diagnostic(uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_device_command_v2(
  uuid,text,uuid,text,uuid,text,jsonb,text,boolean,jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_device_command_v2(
  uuid,text,uuid,text,uuid,text,jsonb,text,boolean,jsonb
) TO service_role;

COMMIT;
