-- Persist dimensions only after strict JPEG validation in the Agent and upload API.
BEGIN;

ALTER TABLE public.camera_snapshot_artifacts
  ADD COLUMN width integer,
  ADD COLUMN height integer,
  ADD CONSTRAINT camera_snapshot_artifacts_dimensions_check CHECK (
    (width IS NULL AND height IS NULL)
    OR (width BETWEEN 1 AND 16384 AND height BETWEEN 1 AND 16384)
  );

CREATE FUNCTION public.reserve_device_snapshot_upload_v2(
  p_public_agent_id uuid,
  p_credential_hash text,
  p_command_id uuid,
  p_lease_token uuid,
  p_channel_id text,
  p_content_type text,
  p_byte_size integer,
  p_sha256 text,
  p_width integer,
  p_height integer
)
RETURNS TABLE(artifact_id uuid, bucket_id text, storage_path text, duplicate_upload boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_reserved record;
BEGIN
  IF p_width NOT BETWEEN 1 AND 16384 OR p_height NOT BETWEEN 1 AND 16384 THEN
    RAISE EXCEPTION 'SNAPSHOT_DIMENSIONS_INVALID';
  END IF;

  SELECT reserved.* INTO v_reserved
  FROM public.reserve_device_snapshot_upload(
    p_public_agent_id,
    p_credential_hash,
    p_command_id,
    p_lease_token,
    p_channel_id,
    p_content_type,
    p_byte_size,
    p_sha256
  ) AS reserved;
  IF NOT FOUND THEN RAISE EXCEPTION 'SNAPSHOT_RESERVATION_MISSING'; END IF;

  UPDATE public.camera_snapshot_artifacts AS artifact
  SET width = p_width, height = p_height
  WHERE artifact.id = v_reserved.artifact_id
    AND artifact.command_id = p_command_id
    AND artifact.external_channel_id = p_channel_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SNAPSHOT_DIMENSIONS_TARGET_INVALID'; END IF;

  RETURN QUERY SELECT
    v_reserved.artifact_id,
    v_reserved.bucket_id,
    v_reserved.storage_path,
    v_reserved.duplicate_upload;
END
$function$;

CREATE FUNCTION public.get_device_snapshot_artifact_v2(p_artifact_id uuid)
RETURNS TABLE(
  artifact_id uuid,
  bucket_id text,
  storage_path text,
  content_type text,
  byte_size integer,
  width integer,
  height integer,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
DECLARE
  v_authorized record;
BEGIN
  SELECT authorized.* INTO v_authorized
  FROM public.get_device_snapshot_artifact(p_artifact_id) AS authorized;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    artifact.id,
    artifact.bucket_id,
    artifact.storage_path,
    artifact.content_type,
    artifact.byte_size,
    artifact.width,
    artifact.height,
    artifact.expires_at
  FROM public.camera_snapshot_artifacts AS artifact
  WHERE artifact.id = v_authorized.artifact_id
    AND artifact.status = 'ready'
    AND artifact.width IS NOT NULL
    AND artifact.height IS NOT NULL
    AND artifact.expires_at > clock_timestamp();
END
$function$;

ALTER FUNCTION public.reserve_device_snapshot_upload_v2(
  uuid,text,uuid,uuid,text,text,integer,text,integer,integer
) OWNER TO postgres;
ALTER FUNCTION public.get_device_snapshot_artifact_v2(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.reserve_device_snapshot_upload_v2(
  uuid,text,uuid,uuid,text,text,integer,text,integer,integer
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_device_snapshot_artifact_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_device_snapshot_upload_v2(
  uuid,text,uuid,uuid,text,text,integer,text,integer,integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_device_snapshot_artifact_v2(uuid)
  TO authenticated;

COMMIT;
