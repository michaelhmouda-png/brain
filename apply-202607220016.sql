-- Brain Agent Phase 2A: generic outbound agent pairing and heartbeat only.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.device_gateways') IS NULL
     OR to_regclass('public.locations') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('private.can_view_camera_manager(uuid)') IS NULL
     OR to_regprocedure('private.can_administer_camera_manager(uuid)') IS NULL
     OR to_regprocedure('extensions.digest(bytea,text)') IS NULL
     OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'BRAIN_AGENT_PHASE2A_DEPENDENCY_MISSING';
  END IF;
  IF to_regclass('public.device_pairing_requests') IS NOT NULL
     OR to_regclass('public.device_agent_credentials') IS NOT NULL
     OR to_regclass('public.device_agent_audit') IS NOT NULL
     OR to_regclass('public.device_capability_catalog') IS NOT NULL
     OR to_regclass('public.device_gateway_capabilities') IS NOT NULL
     OR to_regclass('public.device_agent_rate_limits') IS NOT NULL THEN
    RAISE EXCEPTION 'BRAIN_AGENT_PHASE2A_ALREADY_EXISTS';
  END IF;
END
$$;

ALTER TABLE public.device_gateways
  ADD COLUMN platform text NULL CHECK (platform IS NULL OR char_length(platform) BETWEEN 1 AND 40),
  ADD COLUMN os_version text NULL CHECK (os_version IS NULL OR char_length(os_version) BETWEEN 1 AND 80),
  ADD COLUMN hostname_label text NULL CHECK (hostname_label IS NULL OR hostname_label ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$'),
  ADD COLUMN paired_at timestamptz NULL,
  ADD CONSTRAINT device_gateways_company_id_id_unique UNIQUE (company_id, id);

CREATE TABLE public.device_pairing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  gateway_id uuid NOT NULL REFERENCES public.device_gateways(id) ON DELETE RESTRICT,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz NULL,
  CONSTRAINT device_pairing_request_expiry CHECK (expires_at > created_at),
  CONSTRAINT device_pairing_request_terminal CHECK (used_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT device_pairing_request_tenant_fk FOREIGN KEY (company_id, gateway_id)
    REFERENCES public.device_gateways(company_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX device_pairing_requests_active_gateway_unique
  ON public.device_pairing_requests(gateway_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX device_pairing_requests_code_hash_unique ON public.device_pairing_requests(code_hash);
CREATE INDEX device_pairing_requests_expiry_idx ON public.device_pairing_requests(expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE public.device_agent_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id uuid NOT NULL REFERENCES public.device_gateways(id) ON DELETE RESTRICT,
  public_agent_id uuid NOT NULL,
  credential_hash text NOT NULL CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  token_version integer NOT NULL DEFAULT 1 CHECK (token_version = 1),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz NULL,
  revoked_by uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  last_authenticated_at timestamptz NULL
);
CREATE UNIQUE INDEX device_agent_credentials_active_gateway_unique
  ON public.device_agent_credentials(gateway_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX device_agent_credentials_active_public_agent_unique
  ON public.device_agent_credentials(public_agent_id) WHERE revoked_at IS NULL;

CREATE TABLE public.device_capability_catalog (
  capability_code text PRIMARY KEY CHECK (capability_code ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  protocol_version integer NOT NULL CHECK (protocol_version > 0),
  risk_class text NOT NULL CHECK (risk_class IN ('core','read','write','sensitive')),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.device_capability_catalog(capability_code, protocol_version, risk_class, enabled)
VALUES ('brain.heartbeat.v1', 1, 'core', true);

CREATE TABLE public.device_gateway_capabilities (
  gateway_id uuid NOT NULL REFERENCES public.device_gateways(id) ON DELETE CASCADE,
  capability_code text NOT NULL REFERENCES public.device_capability_catalog(capability_code) ON DELETE RESTRICT,
  declared_version integer NOT NULL CHECK (declared_version > 0),
  approved boolean NOT NULL DEFAULT false,
  granted_by uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  granted_at timestamptz NULL,
  revoked_at timestamptz NULL,
  last_declared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (gateway_id, capability_code),
  CONSTRAINT device_gateway_capability_grant_state CHECK (
    (approved AND granted_at IS NOT NULL AND revoked_at IS NULL)
    OR (NOT approved)
  )
);

CREATE TABLE public.device_agent_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  gateway_id uuid NOT NULL REFERENCES public.device_gateways(id) ON DELETE RESTRICT,
  actor_profile_id uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'gateway.created','pairing.created','pairing.revoked','agent.paired','agent.revoked',
    'agent.authentication_failed','agent.repair_prepared','capability.unknown_declared'
  )),
  outcome_code text NOT NULL CHECK (outcome_code ~ '^[A-Z0-9_]{2,80}$'),
  event_bucket timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX device_agent_audit_gateway_created_idx ON public.device_agent_audit(gateway_id, created_at DESC);
CREATE UNIQUE INDEX device_agent_audit_unknown_capability_bucket_unique
  ON public.device_agent_audit(gateway_id,event_type,event_bucket)
  WHERE event_type='capability.unknown_declared' AND event_bucket IS NOT NULL;

CREATE TABLE public.device_agent_rate_limits (
  scope text NOT NULL CHECK (scope IN ('pairing','credential','heartbeat')),
  identifier_hash text NOT NULL CHECK (identifier_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  window_resets_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (scope, identifier_hash),
  CONSTRAINT device_agent_rate_window CHECK (window_resets_at > window_started_at)
);
CREATE INDEX device_agent_rate_limits_reset_idx ON public.device_agent_rate_limits(window_resets_at);

ALTER TABLE public.device_pairing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_pairing_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.device_agent_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_agent_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE public.device_capability_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_capability_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE public.device_gateway_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_gateway_capabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.device_agent_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_agent_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE public.device_agent_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_agent_rate_limits FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.device_pairing_requests, public.device_agent_credentials,
  public.device_capability_catalog, public.device_gateway_capabilities,
  public.device_agent_audit, public.device_agent_rate_limits
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.device_pairing_requests, public.device_agent_credentials,
  public.device_capability_catalog, public.device_gateway_capabilities,
  public.device_agent_audit, public.device_agent_rate_limits
TO service_role;

CREATE FUNCTION private.valid_agent_capability_declarations(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_value) <> 'array' THEN false
    WHEN jsonb_array_length(p_value) > 16 OR pg_column_size(p_value) > 2048 THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_value) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'string'
         OR (item.value #>> '{}') !~ '^[a-z][a-z0-9_.-]{2,79}$'
    )
  END
$$;
REVOKE ALL ON FUNCTION private.valid_agent_capability_declarations(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_device_gateway(p_location_id uuid,p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_gateway_id uuid;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';
  IF NOT FOUND OR v_profile.role NOT IN ('owner','super_admin') THEN RAISE EXCEPTION 'GATEWAY_FORBIDDEN'; END IF;
  IF char_length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR NOT EXISTS(
    SELECT 1 FROM public.locations l WHERE l.id=p_location_id AND l.company_id=v_profile.company_id AND l.status='active'
  ) THEN RAISE EXCEPTION 'GATEWAY_INVALID'; END IF;
  INSERT INTO public.device_gateways(company_id,location_id,name,gateway_type,status,created_by)
  VALUES(v_profile.company_id,p_location_id,btrim(p_name),'brain_agent','unpaired',v_profile.id) RETURNING id INTO v_gateway_id;
  INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,actor_profile_id,event_type,outcome_code)
  VALUES(v_profile.company_id,p_location_id,v_gateway_id,v_profile.id,'gateway.created','CREATED');
  RETURN v_gateway_id;
END $$;

CREATE FUNCTION public.create_device_pairing_request(p_gateway_id uuid)
RETURNS TABLE(gateway_id uuid, pairing_code text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_gateway public.device_gateways%ROWTYPE; v_code text; v_expiry timestamptz;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';
  IF NOT FOUND OR v_profile.role NOT IN ('owner','super_admin') THEN RAISE EXCEPTION 'PAIRING_FORBIDDEN'; END IF;
  SELECT * INTO v_gateway FROM public.device_gateways g
    WHERE g.id=p_gateway_id AND g.company_id=v_profile.company_id FOR UPDATE;
  IF NOT FOUND OR v_gateway.location_id IS NULL OR v_gateway.status='disabled' THEN RAISE EXCEPTION 'PAIRING_GATEWAY_UNAVAILABLE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locations l WHERE l.id=v_gateway.location_id AND l.company_id=v_gateway.company_id AND l.status='active') THEN
    RAISE EXCEPTION 'PAIRING_LOCATION_UNAVAILABLE';
  END IF;
  UPDATE public.device_pairing_requests r SET revoked_at=clock_timestamp()
    WHERE r.gateway_id=v_gateway.id AND r.used_at IS NULL AND r.revoked_at IS NULL;
  v_code := encode(extensions.gen_random_bytes(16),'hex'); v_expiry := clock_timestamp()+interval '10 minutes';
  INSERT INTO public.device_pairing_requests(company_id,location_id,gateway_id,code_hash,expires_at,created_by)
  VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,
    encode(extensions.digest(convert_to(v_code,'UTF8'),'sha256'),'hex'),v_expiry,v_profile.id);
  UPDATE public.device_gateways SET status='pairing' WHERE id=v_gateway.id;
  INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,actor_profile_id,event_type,outcome_code)
  VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,v_profile.id,'pairing.created','CREATED');
  RETURN QUERY SELECT v_gateway.id,v_code,v_expiry;
END $$;

CREATE FUNCTION public.revoke_device_pairing_request(p_gateway_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_gateway public.device_gateways%ROWTYPE; v_count integer;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';
  IF NOT FOUND OR v_profile.role NOT IN ('owner','super_admin') THEN RAISE EXCEPTION 'PAIRING_FORBIDDEN'; END IF;
  SELECT * INTO v_gateway FROM public.device_gateways g WHERE g.id=p_gateway_id AND g.company_id=v_profile.company_id FOR UPDATE;
  IF NOT FOUND OR v_gateway.location_id IS NULL THEN RAISE EXCEPTION 'PAIRING_GATEWAY_UNAVAILABLE'; END IF;
  UPDATE public.device_pairing_requests SET revoked_at=clock_timestamp()
    WHERE gateway_id=v_gateway.id AND used_at IS NULL AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count>0 THEN
    UPDATE public.device_gateways SET status='unpaired' WHERE id=v_gateway.id AND status='pairing';
    INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,actor_profile_id,event_type,outcome_code)
    VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,v_profile.id,'pairing.revoked','REVOKED');
  END IF;
  RETURN v_count>0;
END $$;

CREATE FUNCTION public.consume_device_pairing_request(
  p_code_hash text, p_public_agent_id uuid, p_credential_hash text,
  p_agent_version text, p_platform text, p_os_version text, p_hostname_label text,
  p_declared_capabilities jsonb
) RETURNS TABLE(gateway_id uuid, company_id uuid, location_id uuid, approved_capabilities jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.device_pairing_requests%ROWTYPE; v_gateway public.device_gateways%ROWTYPE; v_cap text;
BEGIN
  IF p_code_hash !~ '^[0-9a-f]{64}$' OR p_credential_hash !~ '^[0-9a-f]{64}$'
     OR p_agent_version IS NULL OR p_platform IS NULL
     OR char_length(btrim(p_agent_version)) NOT BETWEEN 1 AND 80
     OR char_length(btrim(p_platform)) NOT BETWEEN 1 AND 40
     OR p_os_version IS NOT NULL AND char_length(btrim(p_os_version)) NOT BETWEEN 1 AND 80
     OR p_hostname_label IS NOT NULL AND p_hostname_label !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$'
     OR private.valid_agent_capability_declarations(p_declared_capabilities) IS NOT TRUE THEN RAISE EXCEPTION 'PAIRING_INVALID'; END IF;
  SELECT * INTO v_request FROM public.device_pairing_requests r
    WHERE r.code_hash=p_code_hash FOR UPDATE;
  IF NOT FOUND OR v_request.used_at IS NOT NULL OR v_request.revoked_at IS NOT NULL OR v_request.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'PAIRING_INVALID';
  END IF;
  SELECT * INTO v_gateway FROM public.device_gateways g WHERE g.id=v_request.gateway_id FOR UPDATE;
  IF NOT FOUND OR v_gateway.company_id<>v_request.company_id OR v_gateway.location_id IS DISTINCT FROM v_request.location_id OR v_gateway.status='disabled'
     OR EXISTS(SELECT 1 FROM public.device_agent_credentials c WHERE c.gateway_id=v_gateway.id AND c.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'PAIRING_INVALID';
  END IF;
  INSERT INTO public.device_agent_credentials(gateway_id,public_agent_id,credential_hash)
  VALUES(v_gateway.id,p_public_agent_id,p_credential_hash);
  UPDATE public.device_pairing_requests SET used_at=clock_timestamp() WHERE id=v_request.id;
  UPDATE public.device_gateways SET status='offline',paired_at=clock_timestamp(),agent_version=btrim(p_agent_version),
    platform=btrim(p_platform),os_version=nullif(btrim(p_os_version),''),hostname_label=nullif(btrim(p_hostname_label),'') WHERE id=v_gateway.id;
  FOR v_cap IN SELECT DISTINCT jsonb_array_elements_text(p_declared_capabilities) LOOP
    IF v_cap='brain.heartbeat.v1' THEN
      INSERT INTO public.device_gateway_capabilities(gateway_id,capability_code,declared_version,approved,granted_by,granted_at)
      VALUES(v_gateway.id,v_cap,1,true,v_request.created_by,clock_timestamp())
      ON CONFLICT(gateway_id,capability_code) DO UPDATE SET declared_version=1,approved=true,
        granted_by=EXCLUDED.granted_by,granted_at=EXCLUDED.granted_at,revoked_at=NULL,last_declared_at=clock_timestamp();
    ELSE
      INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,event_type,outcome_code,event_bucket)
      VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,'capability.unknown_declared','UNKNOWN_CAPABILITIES_IGNORED',date_trunc('hour',clock_timestamp()))
      ON CONFLICT (gateway_id,event_type,event_bucket) WHERE event_type='capability.unknown_declared' AND event_bucket IS NOT NULL DO NOTHING;
    END IF;
  END LOOP;
  INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,event_type,outcome_code)
  VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,'agent.paired','PAIRED');
  RETURN QUERY SELECT v_gateway.id,v_gateway.company_id,v_gateway.location_id,
    coalesce((SELECT jsonb_agg(jsonb_build_object('code',c.capability_code,'version',c.declared_version) ORDER BY c.capability_code)
      FROM public.device_gateway_capabilities c WHERE c.gateway_id=v_gateway.id AND c.approved AND c.revoked_at IS NULL),'[]'::jsonb);
END $$;

CREATE FUNCTION public.authenticate_device_agent_heartbeat(
  p_public_agent_id uuid, p_credential_hash text, p_agent_version text,
  p_platform text, p_os_version text, p_hostname_label text, p_declared_capabilities jsonb
) RETURNS TABLE(gateway_id uuid, company_id uuid, location_id uuid, polling_interval_seconds integer, approved_capabilities jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_credential public.device_agent_credentials%ROWTYPE; v_gateway public.device_gateways%ROWTYPE; v_cap text;
BEGIN
  IF p_credential_hash !~ '^[0-9a-f]{64}$' OR p_agent_version IS NULL OR p_platform IS NULL
     OR private.valid_agent_capability_declarations(p_declared_capabilities) IS NOT TRUE THEN RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED'; END IF;
  SELECT * INTO v_credential FROM public.device_agent_credentials c WHERE c.public_agent_id=p_public_agent_id AND c.revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_credential.revoked_at IS NOT NULL OR v_credential.credential_hash<>p_credential_hash THEN RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED'; END IF;
  SELECT * INTO v_gateway FROM public.device_gateways g WHERE g.id=v_credential.gateway_id FOR UPDATE;
  IF NOT FOUND OR v_gateway.status='disabled' OR v_gateway.location_id IS NULL THEN RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED'; END IF;
  IF char_length(btrim(p_agent_version)) NOT BETWEEN 1 AND 80 OR char_length(btrim(p_platform)) NOT BETWEEN 1 AND 40
     OR p_os_version IS NOT NULL AND char_length(btrim(p_os_version)) NOT BETWEEN 1 AND 80
     OR p_hostname_label IS NOT NULL AND p_hostname_label !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$' THEN RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED'; END IF;
  FOR v_cap IN SELECT DISTINCT jsonb_array_elements_text(p_declared_capabilities) LOOP
    IF v_cap='brain.heartbeat.v1' THEN
      UPDATE public.device_gateway_capabilities SET last_declared_at=clock_timestamp()
      WHERE gateway_id=v_gateway.id AND capability_code=v_cap;
    ELSE
      INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,event_type,outcome_code,event_bucket)
      VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,'capability.unknown_declared','UNKNOWN_CAPABILITIES_IGNORED',date_trunc('hour',clock_timestamp()))
      ON CONFLICT (gateway_id,event_type,event_bucket) WHERE event_type='capability.unknown_declared' AND event_bucket IS NOT NULL DO NOTHING;
    END IF;
  END LOOP;
  UPDATE public.device_agent_credentials SET last_authenticated_at=clock_timestamp() WHERE id=v_credential.id;
  UPDATE public.device_gateways SET last_seen_at=clock_timestamp(),status='online',agent_version=btrim(p_agent_version),
    platform=btrim(p_platform),os_version=nullif(btrim(p_os_version),''),hostname_label=nullif(btrim(p_hostname_label),'') WHERE id=v_gateway.id;
  RETURN QUERY SELECT v_gateway.id,v_gateway.company_id,v_gateway.location_id,60,
    coalesce((SELECT jsonb_agg(jsonb_build_object('code',c.capability_code,'version',c.declared_version) ORDER BY c.capability_code)
      FROM public.device_gateway_capabilities c JOIN public.device_capability_catalog cat ON cat.capability_code=c.capability_code
      WHERE c.gateway_id=v_gateway.id AND c.approved AND c.revoked_at IS NULL AND cat.enabled),'[]'::jsonb);
END $$;

CREATE FUNCTION public.resolve_device_agent_rate_identity(p_public_agent_id uuid,p_credential_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_credential_id uuid;
BEGIN
  IF p_credential_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT c.id INTO v_credential_id FROM public.device_agent_credentials c
  WHERE c.public_agent_id=p_public_agent_id AND c.credential_hash=p_credential_hash AND c.revoked_at IS NULL;
  RETURN v_credential_id;
END $$;

CREATE FUNCTION public.revoke_device_agent(p_gateway_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_gateway public.device_gateways%ROWTYPE; v_count integer;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';
  IF NOT FOUND OR v_profile.role NOT IN ('owner','super_admin') THEN RAISE EXCEPTION 'AGENT_REVOCATION_FORBIDDEN'; END IF;
  SELECT * INTO v_gateway FROM public.device_gateways g WHERE g.id=p_gateway_id AND g.company_id=v_profile.company_id FOR UPDATE;
  IF NOT FOUND OR v_gateway.location_id IS NULL THEN RAISE EXCEPTION 'AGENT_NOT_FOUND'; END IF;
  UPDATE public.device_agent_credentials SET revoked_at=clock_timestamp(),revoked_by=v_profile.id WHERE gateway_id=v_gateway.id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  UPDATE public.device_gateway_capabilities SET approved=false,revoked_at=clock_timestamp() WHERE gateway_id=v_gateway.id AND approved;
  UPDATE public.device_gateways SET status='disabled' WHERE id=v_gateway.id;
  INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,actor_profile_id,event_type,outcome_code)
  VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,v_profile.id,'agent.revoked',CASE WHEN v_count>0 THEN 'REVOKED' ELSE 'ALREADY_REVOKED' END);
  RETURN v_count>0;
END $$;

CREATE FUNCTION public.prepare_device_gateway_repair(p_gateway_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_gateway public.device_gateways%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';
  IF NOT FOUND OR v_profile.role NOT IN ('owner','super_admin') THEN RAISE EXCEPTION 'AGENT_REPAIR_FORBIDDEN'; END IF;
  SELECT * INTO v_gateway FROM public.device_gateways g
    WHERE g.id=p_gateway_id AND g.company_id=v_profile.company_id FOR UPDATE;
  IF NOT FOUND OR v_gateway.location_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.locations l WHERE l.id=v_gateway.location_id AND l.company_id=v_profile.company_id AND l.status='active'
  ) THEN RAISE EXCEPTION 'AGENT_NOT_FOUND'; END IF;
  UPDATE public.device_agent_credentials SET revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_by=coalesce(revoked_by,v_profile.id)
    WHERE gateway_id=v_gateway.id AND revoked_at IS NULL;
  UPDATE public.device_pairing_requests SET revoked_at=clock_timestamp()
    WHERE gateway_id=v_gateway.id AND used_at IS NULL AND revoked_at IS NULL;
  UPDATE public.device_gateway_capabilities SET approved=false,revoked_at=coalesce(revoked_at,clock_timestamp())
    WHERE gateway_id=v_gateway.id AND (approved OR revoked_at IS NULL);
  UPDATE public.device_gateways SET status='unpaired',last_seen_at=NULL,paired_at=NULL,
    agent_version=NULL,platform=NULL,os_version=NULL,hostname_label=NULL WHERE id=v_gateway.id;
  INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,actor_profile_id,event_type,outcome_code)
  VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,v_profile.id,'agent.repair_prepared','PREPARED');
  RETURN true;
END $$;

CREATE FUNCTION public.admit_device_agent_request(p_scope text,p_identifier_hash text,p_limit integer,p_window_seconds integer)
RETURNS TABLE(admitted boolean,retry_after_seconds integer,resulting_count integer,window_resets_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.device_agent_rate_limits%ROWTYPE; v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_scope NOT IN ('pairing','credential','heartbeat') OR p_identifier_hash !~ '^[0-9a-f]{64}$'
     OR p_limit NOT BETWEEN 1 AND 1000 OR p_window_seconds NOT BETWEEN 1 AND 3600 THEN RAISE EXCEPTION 'RATE_LIMIT_INVALID'; END IF;
  INSERT INTO public.device_agent_rate_limits AS limits(scope,identifier_hash,window_started_at,window_resets_at,request_count)
  VALUES(p_scope,p_identifier_hash,v_now,v_now+make_interval(secs=>p_window_seconds),1)
  ON CONFLICT(scope,identifier_hash) DO UPDATE SET
    window_started_at=CASE WHEN limits.window_resets_at<=v_now THEN v_now ELSE limits.window_started_at END,
    window_resets_at=CASE WHEN limits.window_resets_at<=v_now THEN v_now+make_interval(secs=>p_window_seconds) ELSE limits.window_resets_at END,
    request_count=CASE WHEN limits.window_resets_at<=v_now THEN 1 ELSE limits.request_count+1 END
  RETURNING limits.* INTO v_row;
  IF substr(p_identifier_hash,1,2)='00' THEN
    DELETE FROM public.device_agent_rate_limits stale
    WHERE stale.ctid IN (
      SELECT candidate.ctid FROM public.device_agent_rate_limits candidate
      WHERE candidate.window_resets_at < v_now-interval '1 hour' ORDER BY candidate.window_resets_at LIMIT 100
    );
  END IF;
  RETURN QUERY SELECT v_row.request_count<=p_limit,
    CASE WHEN v_row.request_count<=p_limit THEN 0 ELSE greatest(1,ceil(extract(epoch FROM v_row.window_resets_at-v_now))::integer) END,
    v_row.request_count,v_row.window_resets_at;
END $$;

REVOKE ALL ON FUNCTION public.create_device_gateway(uuid,text), public.create_device_pairing_request(uuid), public.revoke_device_pairing_request(uuid),
  public.consume_device_pairing_request(text,uuid,text,text,text,text,text,jsonb),
  public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb),
  public.resolve_device_agent_rate_identity(uuid,text),
  public.revoke_device_agent(uuid), public.prepare_device_gateway_repair(uuid), public.admit_device_agent_request(text,text,integer,integer)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_device_gateway(uuid,text), public.create_device_pairing_request(uuid), public.revoke_device_pairing_request(uuid), public.revoke_device_agent(uuid), public.prepare_device_gateway_repair(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_device_pairing_request(text,uuid,text,text,text,text,text,jsonb),
  public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb),
  public.resolve_device_agent_rate_identity(uuid,text),
  public.admit_device_agent_request(text,text,integer,integer) TO service_role;

COMMIT;
