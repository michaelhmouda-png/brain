-- Camera Manager Phase 1 corrective migration: make the shared tenant trigger
-- table-safe. The original 202607220014 migration is already deployed and must
-- not be reapplied; existing triggers automatically use this replacement.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('private.validate_device_tenant_relationships()') IS NULL THEN
    RAISE EXCEPTION 'CAMERA_MANAGER_TENANT_TRIGGER_FUNCTION_MISSING';
  END IF;

  IF to_regclass('public.device_gateways') IS NULL
     OR to_regclass('public.nvr_connections') IS NULL
     OR to_regclass('public.cameras') IS NULL THEN
    RAISE EXCEPTION 'CAMERA_MANAGER_TENANT_TRIGGER_TABLE_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trg
    JOIN pg_class AS rel ON rel.oid = trg.tgrelid
    JOIN pg_namespace AS rel_ns ON rel_ns.oid = rel.relnamespace
    JOIN pg_proc AS proc ON proc.oid = trg.tgfoid
    JOIN pg_namespace AS proc_ns ON proc_ns.oid = proc.pronamespace
    WHERE NOT trg.tgisinternal
      AND rel_ns.nspname = 'public'
      AND rel.relname = 'device_gateways'
      AND trg.tgname = 'device_gateways_tenant_guard'
      AND proc_ns.nspname = 'private'
      AND proc.proname = 'validate_device_tenant_relationships'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trg
    JOIN pg_class AS rel ON rel.oid = trg.tgrelid
    JOIN pg_namespace AS rel_ns ON rel_ns.oid = rel.relnamespace
    JOIN pg_proc AS proc ON proc.oid = trg.tgfoid
    JOIN pg_namespace AS proc_ns ON proc_ns.oid = proc.pronamespace
    WHERE NOT trg.tgisinternal
      AND rel_ns.nspname = 'public'
      AND rel.relname = 'nvr_connections'
      AND trg.tgname = 'nvr_connections_tenant_guard'
      AND proc_ns.nspname = 'private'
      AND proc.proname = 'validate_device_tenant_relationships'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trg
    JOIN pg_class AS rel ON rel.oid = trg.tgrelid
    JOIN pg_namespace AS rel_ns ON rel_ns.oid = rel.relnamespace
    JOIN pg_proc AS proc ON proc.oid = trg.tgfoid
    JOIN pg_namespace AS proc_ns ON proc_ns.oid = proc.pronamespace
    WHERE NOT trg.tgisinternal
      AND rel_ns.nspname = 'public'
      AND rel.relname = 'cameras'
      AND trg.tgname = 'cameras_tenant_guard'
      AND proc_ns.nspname = 'private'
      AND proc.proname = 'validate_device_tenant_relationships'
  ) THEN
    RAISE EXCEPTION 'CAMERA_MANAGER_TENANT_TRIGGER_BINDING_MISSING';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION private.validate_device_tenant_relationships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
END
$$;

REVOKE ALL ON FUNCTION private.validate_device_tenant_relationships()
FROM PUBLIC, anon, authenticated;

COMMIT;
