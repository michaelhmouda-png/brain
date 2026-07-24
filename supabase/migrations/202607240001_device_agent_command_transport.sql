-- Device Agent command transport.
-- Forward-only migration after the frozen 202607240000 current-state baseline.
-- The transport is intentionally limited to safe read-only commands. It does not
-- implement an NVR vendor adapter, credential retrieval, PTZ, mutation, or reboot.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.device_gateways') IS NULL
     OR to_regclass('public.device_agent_credentials') IS NULL
     OR to_regclass('public.device_gateway_capabilities') IS NULL
     OR to_regclass('public.nvr_connections') IS NULL
     OR to_regprocedure('public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'DEVICE_COMMAND_BASELINE_REQUIRED';
  END IF;
  IF to_regclass('public.device_commands') IS NOT NULL
     OR to_regclass('public.device_command_attempts') IS NOT NULL
     OR to_regclass('public.device_command_audit') IS NOT NULL THEN
    RAISE EXCEPTION 'DEVICE_COMMAND_TRANSPORT_ALREADY_EXISTS';
  END IF;
END
$preflight$;

INSERT INTO public.device_capability_catalog(capability_code, protocol_version, risk_class, enabled)
VALUES ('brain.command.transport.v1', 1, 'read_only', true);

CREATE TABLE public.device_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  gateway_id uuid NOT NULL REFERENCES public.device_gateways(id) ON DELETE RESTRICT,
  nvr_connection_id uuid REFERENCES public.nvr_connections(id) ON DELETE RESTRICT,
  command_type text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  max_attempts integer NOT NULL DEFAULT 3,
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  current_lease_token uuid,
  current_lease_expires_at timestamptz,
  result_payload jsonb,
  error_code text,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT device_commands_type_check CHECK (
    command_type IN ('agent_health','network_reachability','nvr_capability_probe','channel_discovery','snapshot_request')
  ),
  CONSTRAINT device_commands_target_check CHECK (
    (command_type = 'agent_health' AND nvr_connection_id IS NULL)
    OR (command_type <> 'agent_health' AND nvr_connection_id IS NOT NULL)
  ),
  CONSTRAINT device_commands_status_check CHECK (status IN ('pending','leased','succeeded','failed','expired')),
  CONSTRAINT device_commands_fingerprint_check CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT device_commands_request_size_check CHECK (
    jsonb_typeof(request_payload) = 'object' AND octet_length(request_payload::text) <= 8192
  ),
  CONSTRAINT device_commands_result_size_check CHECK (
    result_payload IS NULL
    OR (jsonb_typeof(result_payload) = 'object' AND octet_length(result_payload::text) <= 65536)
  ),
  CONSTRAINT device_commands_attempts_check CHECK (
    max_attempts BETWEEN 1 AND 5 AND attempt_count BETWEEN 0 AND max_attempts
  ),
  CONSTRAINT device_commands_expiry_check CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '10 minutes'
  ),
  CONSTRAINT device_commands_lease_shape_check CHECK (
    (status = 'leased' AND current_lease_token IS NOT NULL AND current_lease_expires_at IS NOT NULL)
    OR (status <> 'leased' AND current_lease_expires_at IS NULL)
  ),
  CONSTRAINT device_commands_terminal_shape_check CHECK (
    (status IN ('succeeded','failed','expired') AND completed_at IS NOT NULL)
    OR (status IN ('pending','leased') AND completed_at IS NULL)
  ),
  CONSTRAINT device_commands_error_code_check CHECK (
    error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{2,79}$'
  ),
  CONSTRAINT device_commands_company_idempotency_unique UNIQUE(company_id, idempotency_key)
);

CREATE TABLE public.device_command_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL REFERENCES public.device_commands(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL,
  credential_id uuid NOT NULL REFERENCES public.device_agent_credentials(id) ON DELETE RESTRICT,
  lease_token uuid NOT NULL UNIQUE,
  leased_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  outcome text NOT NULL DEFAULT 'leased',
  completion_fingerprint text,
  result_payload jsonb,
  error_code text,
  retryable boolean,
  CONSTRAINT device_command_attempts_number_check CHECK (attempt_number BETWEEN 1 AND 5),
  CONSTRAINT device_command_attempts_lease_check CHECK (lease_expires_at > leased_at),
  CONSTRAINT device_command_attempts_outcome_check CHECK (
    outcome IN ('leased','succeeded','retry_scheduled','failed','lease_expired','command_expired')
  ),
  CONSTRAINT device_command_attempts_completion_shape_check CHECK (
    (outcome = 'leased' AND completed_at IS NULL AND completion_fingerprint IS NULL)
    OR (outcome <> 'leased' AND completed_at IS NOT NULL)
  ),
  CONSTRAINT device_command_attempts_fingerprint_check CHECK (
    completion_fingerprint IS NULL OR completion_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT device_command_attempts_result_size_check CHECK (
    result_payload IS NULL
    OR (jsonb_typeof(result_payload) = 'object' AND octet_length(result_payload::text) <= 65536)
  ),
  CONSTRAINT device_command_attempts_error_code_check CHECK (
    error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{2,79}$'
  ),
  CONSTRAINT device_command_attempts_command_number_unique UNIQUE(command_id, attempt_number)
);

CREATE TABLE public.device_command_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL REFERENCES public.device_commands(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  gateway_id uuid NOT NULL REFERENCES public.device_gateways(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  credential_id uuid REFERENCES public.device_agent_credentials(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  outcome_code text NOT NULL,
  attempt_number integer,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT device_command_audit_actor_check CHECK (
    (actor_kind = 'profile' AND actor_profile_id IS NOT NULL AND credential_id IS NULL)
    OR (actor_kind = 'agent' AND actor_profile_id IS NULL AND credential_id IS NOT NULL)
    OR (actor_kind = 'system' AND actor_profile_id IS NULL AND credential_id IS NULL)
  ),
  CONSTRAINT device_command_audit_event_check CHECK (
    event_type IN ('command.enqueued','command.leased','command.completed','command.retry_scheduled',
      'command.lease_expired','command.expired','command.duplicate_completion')
  ),
  CONSTRAINT device_command_audit_outcome_check CHECK (outcome_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  CONSTRAINT device_command_audit_attempt_check CHECK (attempt_number IS NULL OR attempt_number BETWEEN 1 AND 5),
  CONSTRAINT device_command_audit_details_check CHECK (
    jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 2048
  )
);

CREATE INDEX device_commands_gateway_queue_idx
  ON public.device_commands(gateway_id, available_at, created_at)
  WHERE status = 'pending';
CREATE INDEX device_commands_gateway_lease_idx
  ON public.device_commands(gateway_id, current_lease_expires_at)
  WHERE status = 'leased';
CREATE INDEX device_commands_company_created_idx
  ON public.device_commands(company_id, created_at DESC);
CREATE INDEX device_commands_nvr_created_idx
  ON public.device_commands(nvr_connection_id, created_at DESC)
  WHERE nvr_connection_id IS NOT NULL;
CREATE INDEX device_command_attempts_command_idx
  ON public.device_command_attempts(command_id, attempt_number DESC);
CREATE INDEX device_command_audit_command_created_idx
  ON public.device_command_audit(command_id, created_at);
CREATE INDEX device_command_audit_company_created_idx
  ON public.device_command_audit(company_id, created_at DESC);

ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE public.device_command_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_command_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.device_command_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_command_audit FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.device_commands, public.device_command_attempts, public.device_command_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.device_commands, public.device_command_attempts, public.device_command_audit
  TO service_role;

CREATE FUNCTION private.valid_device_command_request(p_command_type text, p_payload jsonb)
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
      AND p_payload->>'channelId' ~ '^[A-Za-z0-9._:-]{1,80}$';
  ELSIF p_command_type IN ('agent_health','nvr_capability_probe','channel_discovery') THEN
    RETURN p_payload = '{}'::jsonb;
  END IF;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;

CREATE FUNCTION private.valid_device_command_result(p_command_type text, p_result jsonb)
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
  ELSIF p_command_type = 'nvr_capability_probe' THEN
    IF NOT (p_result ?& ARRAY['vendor','capabilities'])
       OR p_result - ARRAY['vendor','capabilities'] <> '{}'::jsonb
       OR jsonb_typeof(p_result->'vendor') <> 'string'
       OR char_length(p_result->>'vendor') NOT BETWEEN 1 AND 80
       OR jsonb_typeof(p_result->'capabilities') <> 'array'
       OR jsonb_array_length(p_result->'capabilities') > 64 THEN
      RETURN false;
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_result->'capabilities') LOOP
      IF jsonb_typeof(v_item) <> 'string' OR v_item #>> '{}' !~ '^[a-z][a-z0-9_.-]{1,79}$' THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF p_command_type = 'channel_discovery' THEN
    IF NOT (p_result ? 'channels')
       OR p_result - 'channels' <> '{}'::jsonb
       OR jsonb_typeof(p_result->'channels') <> 'array'
       OR jsonb_array_length(p_result->'channels') > 256 THEN
      RETURN false;
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_result->'channels') LOOP
      IF jsonb_typeof(v_item) <> 'object'
         OR NOT (v_item ?& ARRAY['externalChannelId','name','enabled'])
         OR v_item - ARRAY['externalChannelId','name','enabled'] <> '{}'::jsonb
         OR jsonb_typeof(v_item->'externalChannelId') <> 'string'
         OR v_item->>'externalChannelId' !~ '^[A-Za-z0-9._:-]{1,80}$'
         OR jsonb_typeof(v_item->'name') <> 'string'
         OR char_length(v_item->>'name') NOT BETWEEN 1 AND 120
         OR jsonb_typeof(v_item->'enabled') <> 'boolean' THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  ELSIF p_command_type = 'snapshot_request' THEN
    RETURN p_result ?& ARRAY['artifactId','contentType','capturedAt']
      AND p_result - ARRAY['artifactId','contentType','capturedAt'] = '{}'::jsonb
      AND p_result->>'artifactId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND p_result->>'contentType' IN ('image/jpeg','image/webp')
      AND jsonb_typeof(p_result->'capturedAt') = 'string'
      AND char_length(p_result->>'capturedAt') BETWEEN 1 AND 40;
  END IF;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;

CREATE FUNCTION private.resolve_device_command_agent(p_public_agent_id uuid, p_credential_hash text)
RETURNS TABLE(credential_id uuid, gateway_id uuid, company_id uuid, location_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
  SELECT credential.id, gateway.id, gateway.company_id, gateway.location_id
  FROM public.device_agent_credentials AS credential
  JOIN public.device_gateways AS gateway ON gateway.id = credential.gateway_id
  WHERE credential.public_agent_id = p_public_agent_id
    AND credential.credential_hash = p_credential_hash
    AND credential.revoked_at IS NULL
    AND gateway.status <> 'disabled'
    AND gateway.location_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.device_gateway_capabilities AS capability
      JOIN public.device_capability_catalog AS catalog
        ON catalog.capability_code = capability.capability_code
      WHERE capability.gateway_id = gateway.id
        AND capability.capability_code = 'brain.command.transport.v1'
        AND capability.approved
        AND capability.revoked_at IS NULL
        AND catalog.enabled
    )
$function$;

CREATE FUNCTION public.enqueue_device_command(
  p_gateway_id uuid,
  p_nvr_connection_id uuid,
  p_command_type text,
  p_idempotency_key uuid,
  p_request_payload jsonb,
  p_ttl_seconds integer
)
RETURNS TABLE(command_id uuid, command_status text, command_expires_at timestamptz, duplicate_request boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_gateway public.device_gateways%ROWTYPE;
  v_nvr public.nvr_connections%ROWTYPE;
  v_command public.device_commands%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_fingerprint text;
  v_inserted boolean := false;
BEGIN
  SELECT profile.* INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid() AND profile.status = 'active';
  IF NOT FOUND OR v_profile.company_id IS NULL OR v_profile.role NOT IN ('manager','owner','super_admin') THEN
    RAISE EXCEPTION 'DEVICE_COMMAND_FORBIDDEN';
  END IF;
  IF p_idempotency_key IS NULL OR p_ttl_seconds NOT BETWEEN 30 AND 600
     OR private.valid_device_command_request(p_command_type, p_request_payload) IS NOT TRUE THEN
    RAISE EXCEPTION 'DEVICE_COMMAND_INVALID';
  END IF;

  SELECT gateway.* INTO v_gateway
  FROM public.device_gateways AS gateway
  WHERE gateway.id = p_gateway_id
    AND gateway.company_id = v_profile.company_id
    AND gateway.location_id IS NOT NULL
    AND gateway.status <> 'disabled'
  FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.locations AS location
    WHERE location.id = v_gateway.location_id
      AND location.company_id = v_gateway.company_id
      AND location.status = 'active'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.device_agent_credentials AS credential
    WHERE credential.gateway_id = v_gateway.id AND credential.revoked_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.device_gateway_capabilities AS capability
    JOIN public.device_capability_catalog AS catalog
      ON catalog.capability_code = capability.capability_code
    WHERE capability.gateway_id = v_gateway.id
      AND capability.capability_code = 'brain.command.transport.v1'
      AND capability.approved
      AND capability.revoked_at IS NULL
      AND catalog.enabled
  ) THEN
    RAISE EXCEPTION 'DEVICE_COMMAND_GATEWAY_UNAVAILABLE';
  END IF;

  IF p_command_type = 'agent_health' THEN
    IF p_nvr_connection_id IS NOT NULL THEN RAISE EXCEPTION 'DEVICE_COMMAND_TARGET_INVALID'; END IF;
  ELSE
    SELECT nvr.* INTO v_nvr
    FROM public.nvr_connections AS nvr
    WHERE nvr.id = p_nvr_connection_id
      AND nvr.company_id = v_gateway.company_id
      AND nvr.location_id = v_gateway.location_id
      AND nvr.gateway_id = v_gateway.id
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_COMMAND_TARGET_INVALID'; END IF;
  END IF;

  v_fingerprint := encode(extensions.digest(convert_to(
    p_gateway_id::text || '|' || coalesce(p_nvr_connection_id::text,'') || '|' ||
    p_command_type || '|' || p_request_payload::text, 'UTF8'
  ), 'sha256'), 'hex');

  INSERT INTO public.device_commands(
    company_id, location_id, gateway_id, nvr_connection_id, command_type,
    idempotency_key, request_payload, request_fingerprint, expires_at, created_by
  ) VALUES (
    v_gateway.company_id, v_gateway.location_id, v_gateway.id, p_nvr_connection_id, p_command_type,
    p_idempotency_key, p_request_payload, v_fingerprint, v_now + make_interval(secs => p_ttl_seconds), v_profile.id
  )
  ON CONFLICT(company_id, idempotency_key) DO NOTHING
  RETURNING * INTO v_command;
  v_inserted := FOUND;

  IF NOT v_inserted THEN
    SELECT command.* INTO v_command
    FROM public.device_commands AS command
    WHERE command.company_id = v_profile.company_id
      AND command.idempotency_key = p_idempotency_key;
    IF NOT FOUND OR v_command.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'DEVICE_COMMAND_IDEMPOTENCY_CONFLICT';
    END IF;
  ELSE
    INSERT INTO public.device_command_audit(
      command_id, company_id, location_id, gateway_id, actor_kind, actor_profile_id,
      event_type, outcome_code
    ) VALUES (
      v_command.id, v_command.company_id, v_command.location_id, v_command.gateway_id,
      'profile', v_profile.id, 'command.enqueued', 'ENQUEUED'
    );
  END IF;

  RETURN QUERY SELECT v_command.id, v_command.status, v_command.expires_at, NOT v_inserted;
END
$function$;

CREATE FUNCTION public.get_device_command(p_command_id uuid)
RETURNS TABLE(
  command_id uuid,
  command_type text,
  command_status text,
  attempt_count integer,
  result_payload jsonb,
  error_code text,
  created_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_command public.device_commands%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT profile.* INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid() AND profile.status = 'active';
  IF NOT FOUND OR v_profile.company_id IS NULL OR v_profile.role NOT IN ('manager','owner','super_admin') THEN
    RAISE EXCEPTION 'DEVICE_COMMAND_FORBIDDEN';
  END IF;
  SELECT command.* INTO v_command
  FROM public.device_commands AS command
  WHERE command.id = p_command_id AND command.company_id = v_profile.company_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_command.status IN ('pending','leased') AND v_command.expires_at <= v_now THEN
    UPDATE public.device_command_attempts AS attempt
    SET completed_at = v_now, outcome = 'command_expired', error_code = 'COMMAND_EXPIRED', retryable = false
    WHERE attempt.command_id = v_command.id AND attempt.completed_at IS NULL;
    UPDATE public.device_commands AS command
    SET status = 'expired', current_lease_expires_at = NULL, error_code = 'COMMAND_EXPIRED',
      completed_at = v_now, updated_at = v_now
    WHERE command.id = v_command.id
    RETURNING * INTO v_command;
    INSERT INTO public.device_command_audit(
      command_id, company_id, location_id, gateway_id, actor_kind, event_type, outcome_code
    ) VALUES (
      v_command.id, v_command.company_id, v_command.location_id, v_command.gateway_id,
      'system', 'command.expired', 'COMMAND_EXPIRED'
    );
  END IF;

  RETURN QUERY SELECT v_command.id, v_command.command_type, v_command.status, v_command.attempt_count,
    v_command.result_payload, v_command.error_code, v_command.created_at, v_command.expires_at, v_command.completed_at;
END
$function$;

CREATE FUNCTION public.claim_device_commands(
  p_public_agent_id uuid,
  p_credential_hash text,
  p_limit integer
)
RETURNS TABLE(
  command_id uuid,
  command_type text,
  nvr_connection_id uuid,
  request_payload jsonb,
  target jsonb,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_number integer,
  command_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_agent record;
  v_command public.device_commands%ROWTYPE;
  v_attempt public.device_command_attempts%ROWTYPE;
  v_nvr public.nvr_connections%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_lease_token uuid;
  v_lease_expires_at timestamptz;
  v_next_status text;
  v_error_code text;
BEGIN
  IF p_credential_hash !~ '^[0-9a-f]{64}$' OR p_limit NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'DEVICE_COMMAND_AGENT_UNAVAILABLE';
  END IF;
  SELECT agent.* INTO v_agent
  FROM private.resolve_device_command_agent(p_public_agent_id, p_credential_hash) AS agent;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_COMMAND_AGENT_UNAVAILABLE'; END IF;

  FOR v_command IN
    SELECT command.*
    FROM public.device_commands AS command
    WHERE command.gateway_id = v_agent.gateway_id
      AND command.status = 'leased'
      AND command.current_lease_expires_at <= v_now
    ORDER BY command.current_lease_expires_at
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT attempt.* INTO v_attempt
    FROM public.device_command_attempts AS attempt
    WHERE attempt.command_id = v_command.id
      AND attempt.lease_token = v_command.current_lease_token
    FOR UPDATE;
    IF v_command.expires_at <= v_now THEN
      v_next_status := 'expired'; v_error_code := 'COMMAND_EXPIRED';
    ELSIF v_command.attempt_count >= v_command.max_attempts THEN
      v_next_status := 'failed'; v_error_code := 'MAX_ATTEMPTS_EXCEEDED';
    ELSE
      v_next_status := 'pending'; v_error_code := 'LEASE_EXPIRED';
    END IF;
    UPDATE public.device_command_attempts AS attempt
    SET completed_at = v_now,
      outcome = CASE WHEN v_next_status = 'expired' THEN 'command_expired' ELSE 'lease_expired' END,
      error_code = v_error_code,
      retryable = v_next_status = 'pending'
    WHERE attempt.id = v_attempt.id AND attempt.completed_at IS NULL;
    UPDATE public.device_commands AS command
    SET status = v_next_status,
      available_at = CASE WHEN v_next_status = 'pending' THEN v_now ELSE command.available_at END,
      current_lease_expires_at = NULL,
      error_code = v_error_code,
      completed_at = CASE WHEN v_next_status IN ('failed','expired') THEN v_now ELSE NULL END,
      updated_at = v_now
    WHERE command.id = v_command.id;
    INSERT INTO public.device_command_audit(
      command_id, company_id, location_id, gateway_id, actor_kind, credential_id,
      event_type, outcome_code, attempt_number
    ) VALUES (
      v_command.id, v_command.company_id, v_command.location_id, v_command.gateway_id,
      'agent', v_agent.credential_id, 'command.lease_expired', v_error_code, v_command.attempt_count
    );
  END LOOP;

  FOR v_command IN
    SELECT command.*
    FROM public.device_commands AS command
    WHERE command.gateway_id = v_agent.gateway_id
      AND command.status = 'pending'
      AND command.expires_at <= v_now
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.device_commands AS command
    SET status = 'expired', error_code = 'COMMAND_EXPIRED', completed_at = v_now, updated_at = v_now
    WHERE command.id = v_command.id;
    INSERT INTO public.device_command_audit(
      command_id, company_id, location_id, gateway_id, actor_kind, event_type, outcome_code
    ) VALUES (
      v_command.id, v_command.company_id, v_command.location_id, v_command.gateway_id,
      'system', 'command.expired', 'COMMAND_EXPIRED'
    );
  END LOOP;

  UPDATE public.device_agent_credentials AS credential
  SET last_authenticated_at = v_now
  WHERE credential.id = v_agent.credential_id;
  UPDATE public.device_gateways AS gateway
  SET last_seen_at = v_now, status = 'online', updated_at = v_now
  WHERE gateway.id = v_agent.gateway_id;

  FOR v_command IN
    SELECT command.*
    FROM public.device_commands AS command
    WHERE command.gateway_id = v_agent.gateway_id
      AND command.company_id = v_agent.company_id
      AND command.location_id = v_agent.location_id
      AND command.status = 'pending'
      AND command.available_at <= v_now
      AND command.expires_at > v_now
      AND command.attempt_count < command.max_attempts
    ORDER BY command.available_at, command.created_at, command.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  LOOP
    v_lease_token := gen_random_uuid();
    v_lease_expires_at := least(v_now + interval '45 seconds', v_command.expires_at);
    UPDATE public.device_commands AS command
    SET status = 'leased', attempt_count = command.attempt_count + 1,
      current_lease_token = v_lease_token, current_lease_expires_at = v_lease_expires_at,
      error_code = NULL, updated_at = v_now
    WHERE command.id = v_command.id
    RETURNING * INTO v_command;
    INSERT INTO public.device_command_attempts(
      command_id, attempt_number, credential_id, lease_token, leased_at, lease_expires_at
    ) VALUES (
      v_command.id, v_command.attempt_count, v_agent.credential_id, v_lease_token, v_now, v_lease_expires_at
    );
    INSERT INTO public.device_command_audit(
      command_id, company_id, location_id, gateway_id, actor_kind, credential_id,
      event_type, outcome_code, attempt_number
    ) VALUES (
      v_command.id, v_command.company_id, v_command.location_id, v_command.gateway_id,
      'agent', v_agent.credential_id, 'command.leased', 'LEASED', v_command.attempt_count
    );

    IF v_command.nvr_connection_id IS NULL THEN
      target := NULL;
    ELSE
      SELECT nvr.* INTO v_nvr
      FROM public.nvr_connections AS nvr
      WHERE nvr.id = v_command.nvr_connection_id
        AND nvr.company_id = v_agent.company_id
        AND nvr.location_id = v_agent.location_id
        AND nvr.gateway_id = v_agent.gateway_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_COMMAND_TARGET_DRIFT'; END IF;
      target := jsonb_build_object(
        'vendor', v_nvr.vendor,
        'localHost', v_nvr.local_host,
        'httpPort', v_nvr.http_port,
        'rtspPort', v_nvr.rtsp_port,
        'onvifPort', v_nvr.onvif_port
      );
    END IF;
    command_id := v_command.id;
    command_type := v_command.command_type;
    nvr_connection_id := v_command.nvr_connection_id;
    request_payload := v_command.request_payload;
    lease_token := v_lease_token;
    lease_expires_at := v_lease_expires_at;
    attempt_number := v_command.attempt_count;
    command_expires_at := v_command.expires_at;
    RETURN NEXT;
  END LOOP;
END
$function$;

CREATE FUNCTION public.complete_device_command(
  p_public_agent_id uuid,
  p_credential_hash text,
  p_command_id uuid,
  p_command_type text,
  p_lease_token uuid,
  p_outcome text,
  p_result_payload jsonb,
  p_error_code text,
  p_retryable boolean
)
RETURNS TABLE(command_id uuid, command_status text, duplicate_delivery boolean, next_attempt_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_agent record;
  v_command public.device_commands%ROWTYPE;
  v_attempt public.device_command_attempts%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_fingerprint text;
  v_backoff_seconds integer;
  v_next_attempt_at timestamptz;
  v_attempt_outcome text;
  v_outcome_code text;
BEGIN
  IF p_credential_hash !~ '^[0-9a-f]{64}$'
     OR p_outcome NOT IN ('succeeded','failed')
     OR p_retryable IS NULL
     OR p_result_payload IS NULL
     OR octet_length(p_result_payload::text) > 65536
     OR (p_outcome = 'succeeded' AND (
       p_retryable OR p_error_code IS NOT NULL
       OR private.valid_device_command_result(p_command_type, p_result_payload) IS NOT TRUE
     ))
     OR (p_outcome = 'failed' AND (
       p_result_payload <> '{}'::jsonb
       OR p_error_code IS NULL
       OR p_error_code !~ '^[A-Z][A-Z0-9_]{2,79}$'
     )) THEN
    RAISE EXCEPTION 'DEVICE_COMMAND_COMPLETION_INVALID';
  END IF;
  SELECT agent.* INTO v_agent
  FROM private.resolve_device_command_agent(p_public_agent_id, p_credential_hash) AS agent;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_COMMAND_AGENT_UNAVAILABLE'; END IF;
  SELECT command.* INTO v_command
  FROM public.device_commands AS command
  WHERE command.id = p_command_id
    AND command.gateway_id = v_agent.gateway_id
    AND command.company_id = v_agent.company_id
    AND command.location_id = v_agent.location_id
    AND command.command_type = p_command_type
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_COMMAND_NOT_FOUND'; END IF;
  SELECT attempt.* INTO v_attempt
  FROM public.device_command_attempts AS attempt
  WHERE attempt.command_id = v_command.id
    AND attempt.lease_token = p_lease_token
    AND attempt.credential_id = v_agent.credential_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_COMMAND_LEASE_INVALID'; END IF;

  v_fingerprint := encode(extensions.digest(convert_to(
    p_outcome || '|' || p_command_type || '|' || p_result_payload::text || '|' ||
    coalesce(p_error_code,'') || '|' || p_retryable::text, 'UTF8'
  ), 'sha256'), 'hex');
  IF v_attempt.completed_at IS NOT NULL THEN
    IF v_attempt.completion_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'DEVICE_COMMAND_COMPLETION_CONFLICT';
    END IF;
    INSERT INTO public.device_command_audit(
      command_id, company_id, location_id, gateway_id, actor_kind, credential_id,
      event_type, outcome_code, attempt_number
    ) VALUES (
      v_command.id, v_command.company_id, v_command.location_id, v_command.gateway_id,
      'agent', v_agent.credential_id, 'command.duplicate_completion', 'DUPLICATE_IGNORED', v_attempt.attempt_number
    );
    RETURN QUERY SELECT v_command.id, v_command.status, true,
      CASE WHEN v_command.status = 'pending' THEN v_command.available_at ELSE NULL END;
    RETURN;
  END IF;
  IF v_command.status <> 'leased'
     OR v_command.current_lease_token IS DISTINCT FROM p_lease_token
     OR v_attempt.lease_expires_at <= v_now
     OR v_command.expires_at <= v_now THEN
    RAISE EXCEPTION 'DEVICE_COMMAND_LEASE_EXPIRED';
  END IF;

  IF p_outcome = 'succeeded' THEN
    v_attempt_outcome := 'succeeded'; v_outcome_code := 'SUCCEEDED';
    UPDATE public.device_command_attempts AS attempt
    SET completed_at = v_now, outcome = 'succeeded', completion_fingerprint = v_fingerprint,
      result_payload = p_result_payload, error_code = NULL, retryable = false
    WHERE attempt.id = v_attempt.id;
    UPDATE public.device_commands AS command
    SET status = 'succeeded', current_lease_expires_at = NULL, result_payload = p_result_payload,
      error_code = NULL, completed_at = v_now, updated_at = v_now
    WHERE command.id = v_command.id
    RETURNING * INTO v_command;
  ELSE
    v_backoff_seconds := least(30, (2 ^ greatest(0, v_attempt.attempt_number - 1))::integer);
    v_next_attempt_at := v_now + make_interval(secs => v_backoff_seconds);
    IF p_retryable
       AND v_command.attempt_count < v_command.max_attempts
       AND v_next_attempt_at < v_command.expires_at THEN
      v_attempt_outcome := 'retry_scheduled'; v_outcome_code := 'RETRY_SCHEDULED';
      UPDATE public.device_command_attempts AS attempt
      SET completed_at = v_now, outcome = 'retry_scheduled', completion_fingerprint = v_fingerprint,
        result_payload = NULL, error_code = p_error_code, retryable = true
      WHERE attempt.id = v_attempt.id;
      UPDATE public.device_commands AS command
      SET status = 'pending', available_at = v_next_attempt_at, current_lease_token = NULL,
        current_lease_expires_at = NULL, result_payload = NULL, error_code = p_error_code,
        updated_at = v_now
      WHERE command.id = v_command.id
      RETURNING * INTO v_command;
    ELSE
      v_attempt_outcome := 'failed';
      v_outcome_code := CASE WHEN v_command.attempt_count >= v_command.max_attempts
        THEN 'MAX_ATTEMPTS_EXCEEDED' ELSE p_error_code END;
      v_next_attempt_at := NULL;
      UPDATE public.device_command_attempts AS attempt
      SET completed_at = v_now, outcome = 'failed', completion_fingerprint = v_fingerprint,
        result_payload = NULL, error_code = p_error_code, retryable = p_retryable
      WHERE attempt.id = v_attempt.id;
      UPDATE public.device_commands AS command
      SET status = 'failed', current_lease_expires_at = NULL, result_payload = NULL,
        error_code = v_outcome_code, completed_at = v_now, updated_at = v_now
      WHERE command.id = v_command.id
      RETURNING * INTO v_command;
    END IF;
  END IF;

  INSERT INTO public.device_command_audit(
    command_id, company_id, location_id, gateway_id, actor_kind, credential_id,
    event_type, outcome_code, attempt_number
  ) VALUES (
    v_command.id, v_command.company_id, v_command.location_id, v_command.gateway_id,
    'agent', v_agent.credential_id,
    CASE WHEN v_attempt_outcome = 'retry_scheduled' THEN 'command.retry_scheduled' ELSE 'command.completed' END,
    v_outcome_code, v_attempt.attempt_number
  );
  RETURN QUERY SELECT v_command.id, v_command.status, false, v_next_attempt_at;
END
$function$;

ALTER TABLE public.device_agent_rate_limits
  DROP CONSTRAINT device_agent_rate_limits_scope_check;
ALTER TABLE public.device_agent_rate_limits
  ADD CONSTRAINT device_agent_rate_limits_scope_check
  CHECK (scope IN ('pairing','credential','heartbeat','command'));

CREATE OR REPLACE FUNCTION public.admit_device_agent_request(
  p_scope text,
  p_identifier_hash text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS TABLE(admitted boolean, retry_after_seconds integer, resulting_count integer, window_resets_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.device_agent_rate_limits%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_scope NOT IN ('pairing','credential','heartbeat','command')
     OR p_identifier_hash !~ '^[0-9a-f]{64}$'
     OR p_limit NOT BETWEEN 1 AND 1000
     OR p_window_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID';
  END IF;
  INSERT INTO public.device_agent_rate_limits AS limits(
    scope, identifier_hash, window_started_at, window_resets_at, request_count
  ) VALUES (
    p_scope, p_identifier_hash, v_now, v_now + make_interval(secs => p_window_seconds), 1
  )
  ON CONFLICT(scope, identifier_hash) DO UPDATE SET
    window_started_at = CASE WHEN limits.window_resets_at <= v_now THEN v_now ELSE limits.window_started_at END,
    window_resets_at = CASE WHEN limits.window_resets_at <= v_now
      THEN v_now + make_interval(secs => p_window_seconds) ELSE limits.window_resets_at END,
    request_count = CASE WHEN limits.window_resets_at <= v_now THEN 1 ELSE limits.request_count + 1 END
  RETURNING limits.* INTO v_row;
  IF substr(p_identifier_hash, 1, 2) = '00' THEN
    DELETE FROM public.device_agent_rate_limits AS stale
    WHERE stale.ctid IN (
      SELECT candidate.ctid
      FROM public.device_agent_rate_limits AS candidate
      WHERE candidate.window_resets_at < v_now - interval '1 hour'
      ORDER BY candidate.window_resets_at
      LIMIT 100
    );
  END IF;
  RETURN QUERY SELECT v_row.request_count <= p_limit,
    CASE WHEN v_row.request_count <= p_limit THEN 0
      ELSE greatest(1, ceil(extract(epoch FROM v_row.window_resets_at - v_now))::integer) END,
    v_row.request_count, v_row.window_resets_at;
END
$function$;

CREATE OR REPLACE FUNCTION public.authenticate_device_agent_heartbeat(
  p_public_agent_id uuid,
  p_credential_hash text,
  p_agent_version text,
  p_platform text,
  p_os_version text,
  p_hostname_label text,
  p_declared_capabilities jsonb
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
  v_credential public.device_agent_credentials%ROWTYPE;
  v_gateway public.device_gateways%ROWTYPE;
  v_cap text;
  v_event_bucket timestamptz;
BEGIN
  IF p_credential_hash !~ '^[0-9a-f]{64}$'
     OR p_agent_version IS NULL
     OR p_platform IS NULL
     OR private.valid_agent_capability_declarations(p_declared_capabilities) IS NOT TRUE THEN
    RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED';
  END IF;
  SELECT credential_row.* INTO v_credential
  FROM public.device_agent_credentials AS credential_row
  WHERE credential_row.public_agent_id = p_public_agent_id
    AND credential_row.revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_credential.credential_hash <> p_credential_hash THEN
    RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED';
  END IF;
  SELECT gateway_row.* INTO v_gateway
  FROM public.device_gateways AS gateway_row
  WHERE gateway_row.id = v_credential.gateway_id
  FOR UPDATE;
  IF NOT FOUND OR v_gateway.status = 'disabled' OR v_gateway.location_id IS NULL THEN
    RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED';
  END IF;
  IF char_length(btrim(p_agent_version)) NOT BETWEEN 1 AND 80
     OR char_length(btrim(p_platform)) NOT BETWEEN 1 AND 40
     OR p_os_version IS NOT NULL AND char_length(btrim(p_os_version)) NOT BETWEEN 1 AND 80
     OR p_hostname_label IS NOT NULL AND p_hostname_label !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$' THEN
    RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED';
  END IF;
  FOR v_cap IN SELECT DISTINCT jsonb_array_elements_text(p_declared_capabilities) LOOP
    IF v_cap IN ('brain.heartbeat.v1','brain.command.transport.v1') THEN
      INSERT INTO public.device_gateway_capabilities(
        gateway_id, capability_code, declared_version, approved, granted_at, revoked_at, last_declared_at
      ) VALUES (
        v_gateway.id, v_cap, 1, true, clock_timestamp(), NULL, clock_timestamp()
      )
      ON CONFLICT(gateway_id, capability_code) DO UPDATE SET
        declared_version = 1, last_declared_at = clock_timestamp();
    ELSE
      v_event_bucket := date_trunc('hour', clock_timestamp());
      BEGIN
        INSERT INTO public.device_agent_audit(
          company_id, location_id, gateway_id, event_type, outcome_code, event_bucket
        )
        SELECT v_gateway.company_id, v_gateway.location_id, v_gateway.id,
          'capability.unknown_declared', 'UNKNOWN_CAPABILITIES_IGNORED', v_event_bucket
        WHERE NOT EXISTS (
          SELECT 1 FROM public.device_agent_audit AS audit_row
          WHERE audit_row.gateway_id = v_gateway.id
            AND audit_row.event_type = 'capability.unknown_declared'
            AND audit_row.event_bucket = v_event_bucket
        );
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;
  END LOOP;
  UPDATE public.device_agent_credentials AS credential_row
  SET last_authenticated_at = clock_timestamp()
  WHERE credential_row.id = v_credential.id;
  UPDATE public.device_gateways AS gateway_row
  SET last_seen_at = clock_timestamp(), status = 'online', agent_version = btrim(p_agent_version),
    platform = btrim(p_platform), os_version = nullif(btrim(p_os_version), ''),
    hostname_label = nullif(btrim(p_hostname_label), '')
  WHERE gateway_row.id = v_gateway.id;
  RETURN QUERY SELECT v_gateway.id, v_gateway.company_id, v_gateway.location_id, 60,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'code', capability_row.capability_code, 'version', capability_row.declared_version
      ) ORDER BY capability_row.capability_code)
      FROM public.device_gateway_capabilities AS capability_row
      JOIN public.device_capability_catalog AS catalog_row
        ON catalog_row.capability_code = capability_row.capability_code
      WHERE capability_row.gateway_id = v_gateway.id
        AND capability_row.approved
        AND capability_row.revoked_at IS NULL
        AND catalog_row.enabled
    ), '[]'::jsonb);
END
$function$;

REVOKE ALL ON FUNCTION private.valid_device_command_request(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.valid_device_command_result(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.resolve_device_command_agent(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_device_command(uuid,uuid,text,uuid,jsonb,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_device_command(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_device_commands(uuid,text,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_device_command(uuid,text,uuid,text,uuid,text,jsonb,text,boolean) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.enqueue_device_command(uuid,uuid,text,uuid,jsonb,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_device_command(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_device_commands(uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_device_command(uuid,text,uuid,text,uuid,text,jsonb,text,boolean) TO service_role;

COMMIT;
