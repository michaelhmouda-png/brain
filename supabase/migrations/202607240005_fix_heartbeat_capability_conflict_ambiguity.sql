-- Preserve heartbeat semantics while qualifying the capability upsert conflict target.
BEGIN;

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
      ON CONFLICT ON CONSTRAINT device_gateway_capabilities_pkey DO UPDATE SET
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

ALTER FUNCTION public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb)
TO service_role;

COMMIT;
