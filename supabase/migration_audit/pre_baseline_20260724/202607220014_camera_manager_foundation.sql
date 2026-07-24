-- Camera Manager Phase 1: metadata foundation only. No streaming, discovery, or network calls.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL OR to_regclass('public.locations') IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'CAMERA_MANAGER_FOUNDATION_DEPENDENCY_MISSING';
  END IF;
  IF to_regclass('public.device_gateways') IS NOT NULL OR to_regclass('public.nvr_connections') IS NOT NULL OR to_regclass('public.cameras') IS NOT NULL THEN
    RAISE EXCEPTION 'CAMERA_MANAGER_FOUNDATION_ALREADY_EXISTS';
  END IF;
END $$;

CREATE FUNCTION private.is_valid_camera_local_host(p_value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE
  v_host text;
  v_labels text[];
  v_label text;
  v_parts text[];
  v_part text;
  v_octets integer[] := '{}';
BEGIN
  IF p_value = '' OR length(p_value) > 253 OR p_value IS DISTINCT FROM btrim(p_value)
     OR p_value ~ '[[:space:]]'
     OR position(':' IN p_value) > 0 OR position('/' IN p_value) > 0
     OR position('@' IN p_value) > 0 OR position('?' IN p_value) > 0
     OR position('#' IN p_value) > 0 OR position(E'\\' IN p_value) > 0 THEN
    RETURN false;
  END IF;

  v_host := lower(p_value);
  IF v_host ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' THEN
    v_parts := string_to_array(v_host, '.');
    FOREACH v_part IN ARRAY v_parts LOOP
      IF (length(v_part) > 1 AND left(v_part, 1) = '0') OR v_part::integer > 255 THEN
        RETURN false;
      END IF;
      v_octets := array_append(v_octets, v_part::integer);
    END LOOP;
    IF v_octets[1] IN (0, 127)
       OR (v_octets[1] = 169 AND v_octets[2] = 254)
       OR v_octets[1] >= 224
       OR v_octets = ARRAY[255,255,255,255] THEN
      RETURN false;
    END IF;
    RETURN true;
  END IF;

  -- Numeric dotted input that is not one canonical IPv4 address must never be
  -- reinterpreted as a DNS hostname.
  IF v_host ~ '^[0-9.]+$' THEN RETURN false; END IF;
  IF right(v_host, 1) = '.' THEN v_host := left(v_host, length(v_host) - 1); END IF;
  IF v_host = '' THEN RETURN false; END IF;

  v_labels := string_to_array(v_host, '.');
  FOREACH v_label IN ARRAY v_labels LOOP
    IF v_label = 'localhost' OR length(v_label) NOT BETWEEN 1 AND 63
       OR v_label !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.is_valid_camera_local_host(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_valid_camera_local_host(text) TO authenticated, service_role;

CREATE TABLE public.device_gateways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  gateway_type text NOT NULL CHECK (gateway_type IN ('brain_agent')),
  status text NOT NULL DEFAULT 'unpaired' CHECK (status IN ('unpaired','pairing','online','offline','disabled','error')),
  last_seen_at timestamptz NULL,
  agent_version text NULL CHECK (agent_version IS NULL OR char_length(agent_version) <= 80),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.nvr_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  gateway_id uuid NULL REFERENCES public.device_gateways(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  vendor text NOT NULL CHECK (char_length(btrim(vendor)) BETWEEN 1 AND 80),
  local_host text NOT NULL CONSTRAINT nvr_connections_local_host_valid CHECK (private.is_valid_camera_local_host(local_host)),
  http_port integer NULL CHECK (http_port BETWEEN 1 AND 65535),
  rtsp_port integer NULL CHECK (rtsp_port BETWEEN 1 AND 65535),
  onvif_port integer NULL CHECK (onvif_port BETWEEN 1 AND 65535),
  username_secret_reference text NULL CHECK (username_secret_reference IS NULL OR username_secret_reference ~ '^[A-Za-z0-9][A-Za-z0-9/_-]{2,127}$'),
  password_secret_reference text NULL CHECK (password_secret_reference IS NULL OR password_secret_reference ~ '^[A-Za-z0-9][A-Za-z0-9/_-]{2,127}$'),
  status text NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('unconfigured','configured','offline','online','error')),
  last_tested_at timestamptz NULL,
  last_error_code text NULL CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 80),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  nvr_connection_id uuid NOT NULL REFERENCES public.nvr_connections(id) ON DELETE RESTRICT,
  external_channel_id text NOT NULL CHECK (char_length(btrim(external_channel_id)) BETWEEN 1 AND 120),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  area text NULL CHECK (area IS NULL OR char_length(area) <= 120),
  department text NULL CHECK (department IS NULL OR char_length(department) <= 120),
  stream_profile text NULL CHECK (stream_profile IS NULL OR stream_profile IN ('main','sub')),
  status text NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('unconfigured','offline','online','disabled','error')),
  ai_enabled boolean NOT NULL DEFAULT false,
  task_verification_enabled boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cameras_nvr_channel_unique UNIQUE (nvr_connection_id, external_channel_id)
);

CREATE TABLE public.device_configuration_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (entity_type IN ('nvr_connection','camera')),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created','updated','deleted')),
  changed_fields text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX device_gateways_company_idx ON public.device_gateways(company_id);
CREATE INDEX device_gateways_location_idx ON public.device_gateways(location_id);
CREATE INDEX device_gateways_status_idx ON public.device_gateways(company_id,status);
CREATE INDEX nvr_connections_company_idx ON public.nvr_connections(company_id);
CREATE INDEX nvr_connections_location_idx ON public.nvr_connections(location_id);
CREATE INDEX nvr_connections_gateway_idx ON public.nvr_connections(gateway_id);
CREATE INDEX nvr_connections_status_idx ON public.nvr_connections(company_id,status);
CREATE INDEX cameras_company_idx ON public.cameras(company_id);
CREATE INDEX cameras_location_idx ON public.cameras(location_id);
CREATE INDEX cameras_nvr_idx ON public.cameras(nvr_connection_id);
CREATE INDEX cameras_status_idx ON public.cameras(company_id,status);
CREATE INDEX cameras_external_channel_idx ON public.cameras(external_channel_id);
CREATE INDEX device_configuration_audit_company_created_idx ON public.device_configuration_audit(company_id,created_at DESC);

CREATE FUNCTION private.validate_device_tenant_relationships() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'device_gateways' THEN
    IF NEW.location_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.locations AS location
      WHERE location.id = NEW.location_id AND location.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'DEVICE_LOCATION_TENANT_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'nvr_connections' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.locations AS location
      WHERE location.id = NEW.location_id AND location.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'DEVICE_LOCATION_TENANT_MISMATCH';
    END IF;
    IF NEW.gateway_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.device_gateways AS gateway
      WHERE gateway.id = NEW.gateway_id
        AND gateway.company_id = NEW.company_id
        AND (gateway.location_id IS NULL OR gateway.location_id = NEW.location_id)
    ) THEN
      RAISE EXCEPTION 'NVR_GATEWAY_TENANT_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'cameras' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.locations AS location
      WHERE location.id = NEW.location_id AND location.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'DEVICE_LOCATION_TENANT_MISMATCH';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.nvr_connections AS nvr
      WHERE nvr.id = NEW.nvr_connection_id
        AND nvr.company_id = NEW.company_id
        AND nvr.location_id = NEW.location_id
    ) THEN
      RAISE EXCEPTION 'CAMERA_NVR_TENANT_MISMATCH';
    END IF;
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_DEVICE_TENANT_TRIGGER_TABLE: %', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.validate_device_tenant_relationships() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER device_gateways_tenant_guard BEFORE INSERT OR UPDATE ON public.device_gateways FOR EACH ROW EXECUTE FUNCTION private.validate_device_tenant_relationships();
CREATE TRIGGER nvr_connections_tenant_guard BEFORE INSERT OR UPDATE ON public.nvr_connections FOR EACH ROW EXECUTE FUNCTION private.validate_device_tenant_relationships();
CREATE TRIGGER cameras_tenant_guard BEFORE INSERT OR UPDATE ON public.cameras FOR EACH ROW EXECUTE FUNCTION private.validate_device_tenant_relationships();

CREATE FUNCTION private.touch_device_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION private.touch_device_updated_at() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER device_gateways_updated_at BEFORE UPDATE ON public.device_gateways FOR EACH ROW EXECUTE FUNCTION private.touch_device_updated_at();
CREATE TRIGGER nvr_connections_updated_at BEFORE UPDATE ON public.nvr_connections FOR EACH ROW EXECUTE FUNCTION private.touch_device_updated_at();
CREATE TRIGGER cameras_updated_at BEFORE UPDATE ON public.cameras FOR EACH ROW EXECUTE FUNCTION private.touch_device_updated_at();

CREATE FUNCTION private.audit_device_configuration() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_company_id uuid; v_entity_id uuid; v_fields text[] := '{}';
BEGIN
  IF TG_OP='DELETE' THEN v_company_id:=OLD.company_id; v_entity_id:=OLD.id;
  ELSE v_company_id:=NEW.company_id; v_entity_id:=NEW.id; END IF;
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='cameras' THEN
    IF OLD.name IS DISTINCT FROM NEW.name THEN v_fields:=array_append(v_fields,'name'); END IF;
    IF OLD.area IS DISTINCT FROM NEW.area THEN v_fields:=array_append(v_fields,'area'); END IF;
    IF OLD.department IS DISTINCT FROM NEW.department THEN v_fields:=array_append(v_fields,'department'); END IF;
    IF OLD.ai_enabled IS DISTINCT FROM NEW.ai_enabled THEN v_fields:=array_append(v_fields,'ai_enabled'); END IF;
    IF OLD.task_verification_enabled IS DISTINCT FROM NEW.task_verification_enabled THEN v_fields:=array_append(v_fields,'task_verification_enabled'); END IF;
  END IF;
  INSERT INTO public.device_configuration_audit(company_id,actor_profile_id,entity_type,entity_id,action,changed_fields)
  VALUES(v_company_id,auth.uid(),CASE WHEN TG_TABLE_NAME='cameras' THEN 'camera' ELSE 'nvr_connection' END,v_entity_id,
    CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END,v_fields);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_device_configuration() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER nvr_connections_audit AFTER INSERT OR UPDATE OR DELETE ON public.nvr_connections FOR EACH ROW EXECUTE FUNCTION private.audit_device_configuration();
CREATE TRIGGER cameras_audit AFTER INSERT OR UPDATE OR DELETE ON public.cameras FOR EACH ROW EXECUTE FUNCTION private.audit_device_configuration();

ALTER TABLE public.device_gateways ENABLE ROW LEVEL SECURITY; ALTER TABLE public.device_gateways FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nvr_connections ENABLE ROW LEVEL SECURITY; ALTER TABLE public.nvr_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cameras ENABLE ROW LEVEL SECURITY; ALTER TABLE public.cameras FORCE ROW LEVEL SECURITY;
ALTER TABLE public.device_configuration_audit ENABLE ROW LEVEL SECURITY; ALTER TABLE public.device_configuration_audit FORCE ROW LEVEL SECURITY;

CREATE FUNCTION private.can_view_camera_manager(p_company_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = auth.uid() AND profile.status = 'active'
      AND profile.company_id = p_company_id
      AND profile.role IN ('manager','owner','super_admin')
  )
$$;
CREATE FUNCTION private.can_administer_camera_manager(p_company_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = auth.uid() AND profile.status = 'active'
      AND profile.company_id = p_company_id
      AND profile.role IN ('owner','super_admin')
  )
$$;
REVOKE ALL ON FUNCTION private.can_view_camera_manager(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_administer_camera_manager(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_view_camera_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_administer_camera_manager(uuid) TO authenticated;

CREATE POLICY nvr_connections_management_select ON public.nvr_connections FOR SELECT TO authenticated USING (private.can_view_camera_manager(nvr_connections.company_id));
CREATE POLICY nvr_connections_owner_insert ON public.nvr_connections FOR INSERT TO authenticated WITH CHECK (created_by=auth.uid() AND private.can_administer_camera_manager(nvr_connections.company_id));
CREATE POLICY nvr_connections_owner_update ON public.nvr_connections FOR UPDATE TO authenticated USING (private.can_administer_camera_manager(nvr_connections.company_id)) WITH CHECK (private.can_administer_camera_manager(nvr_connections.company_id));
CREATE POLICY nvr_connections_owner_delete ON public.nvr_connections FOR DELETE TO authenticated USING (private.can_administer_camera_manager(nvr_connections.company_id));
CREATE POLICY cameras_management_select ON public.cameras FOR SELECT TO authenticated USING (private.can_view_camera_manager(cameras.company_id));
CREATE POLICY cameras_management_update ON public.cameras FOR UPDATE TO authenticated USING (private.can_view_camera_manager(cameras.company_id)) WITH CHECK (private.can_view_camera_manager(cameras.company_id));

REVOKE ALL ON public.device_gateways,public.nvr_connections,public.cameras,public.device_configuration_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,company_id,location_id,gateway_id,name,vendor,local_host,http_port,rtsp_port,onvif_port,status,last_tested_at,created_at,updated_at) ON public.nvr_connections TO authenticated;
GRANT INSERT(company_id,location_id,gateway_id,name,vendor,local_host,http_port,rtsp_port,onvif_port,username_secret_reference,password_secret_reference,status,created_by) ON public.nvr_connections TO authenticated;
GRANT UPDATE(location_id,gateway_id,name,vendor,local_host,http_port,rtsp_port,onvif_port,username_secret_reference,password_secret_reference,status) ON public.nvr_connections TO authenticated;
GRANT DELETE ON public.nvr_connections TO authenticated;
GRANT SELECT(id,company_id,location_id,nvr_connection_id,external_channel_id,name,area,department,stream_profile,status,ai_enabled,task_verification_enabled,last_seen_at,created_at,updated_at) ON public.cameras TO authenticated;
GRANT UPDATE(name,area,department,ai_enabled,task_verification_enabled) ON public.cameras TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.device_gateways,public.nvr_connections,public.cameras TO service_role;
GRANT SELECT,INSERT ON public.device_configuration_audit TO service_role;

COMMIT;
