-- Restore the authenticated Camera Manager column privileges that its RLS
-- policies and API routes require. The frozen baseline remains unchanged.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.nvr_connections') IS NULL
     OR to_regclass('public.cameras') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'nvr_connections'
         AND policyname = 'nvr_connections_owner_insert'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'cameras'
         AND policyname = 'cameras_management_update'
     ) THEN
    RAISE EXCEPTION 'CAMERA_MANAGER_RLS_FOUNDATION_REQUIRED';
  END IF;
END
$preflight$;

GRANT SELECT(
  id,company_id,location_id,gateway_id,name,vendor,local_host,http_port,
  rtsp_port,onvif_port,status,last_tested_at,created_at,updated_at
) ON public.nvr_connections TO authenticated;

GRANT INSERT(
  company_id,location_id,gateway_id,name,vendor,local_host,http_port,rtsp_port,
  onvif_port,username_secret_reference,password_secret_reference,status,created_by
) ON public.nvr_connections TO authenticated;

GRANT UPDATE(
  location_id,gateway_id,name,vendor,local_host,http_port,rtsp_port,onvif_port,
  username_secret_reference,password_secret_reference,status
) ON public.nvr_connections TO authenticated;

GRANT SELECT(
  id,company_id,location_id,nvr_connection_id,external_channel_id,name,area,
  department,stream_profile,status,ai_enabled,task_verification_enabled,
  last_seen_at,created_at,updated_at
) ON public.cameras TO authenticated;

GRANT UPDATE(
  name,area,department,ai_enabled,task_verification_enabled
) ON public.cameras TO authenticated;

COMMIT;
