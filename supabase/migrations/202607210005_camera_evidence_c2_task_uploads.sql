-- Camera Evidence C2: private, immutable task evidence uploads only.
-- AI visual verification, fixed-camera ingestion, and task completion are later stages.

CREATE TABLE public.task_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  location_id uuid NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  submitted_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  submitted_by_employee_id uuid NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('mobile_camera', 'gallery_upload')),
  status text NOT NULL DEFAULT 'pending_upload'
    CHECK (status IN ('pending_upload', 'upload_failed', 'pending_review')),
  original_storage_path text NOT NULL UNIQUE,
  original_mime_type text NOT NULL
    CHECK (original_mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  original_size_bytes bigint NOT NULL CHECK (original_size_bytes > 0 AND original_size_bytes <= 20971520),
  original_sha256 text NOT NULL CHECK (original_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key uuid NOT NULL,
  uploaded_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (submitted_by_profile_id, idempotency_key),
  UNIQUE (company_id, task_id, original_sha256)
);

CREATE INDEX task_evidence_company_task_created_idx
  ON public.task_evidence (company_id, task_id, created_at DESC);
CREATE INDEX task_evidence_pending_review_idx
  ON public.task_evidence (company_id, created_at)
  WHERE status = 'pending_review';

CREATE TABLE public.task_evidence_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES public.task_evidence(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('upload.prepared', 'upload.failed', 'upload.completed')),
  safe_details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX task_evidence_audit_evidence_created_idx
  ON public.task_evidence_audit (evidence_id, created_at);

ALTER TABLE public.task_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_audit FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.task_evidence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.task_evidence_audit FROM PUBLIC, anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-evidence',
  'task-evidence',
  false,
  20971520,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.prepare_task_evidence_upload(
  p_task_id uuid,
  p_location_id uuid,
  p_source_type text,
  p_original_mime_type text,
  p_original_size_bytes bigint,
  p_original_sha256 text,
  p_idempotency_key uuid
)
RETURNS TABLE (evidence_id uuid, storage_path text, upload_status text, is_duplicate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_task public.tasks%ROWTYPE;
  v_existing public.task_evidence%ROWTYPE;
  v_evidence_id uuid := gen_random_uuid();
  v_extension text;
  v_path text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT pr.* INTO v_profile
    FROM public.profiles AS pr
   WHERE pr.id = auth.uid() AND pr.status = 'active';
  IF NOT FOUND OR v_profile.role NOT IN ('employee', 'manager', 'owner', 'super_admin') OR v_profile.company_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_PROVISIONED';
  END IF;

  SELECT t.* INTO v_task
    FROM public.tasks AS t
   WHERE t.id = p_task_id AND t.company_id = v_profile.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_AVAILABLE'; END IF;

  IF v_profile.role = 'employee' AND (
    v_profile.employee_id IS NULL OR v_task.assigned_employee_id IS DISTINCT FROM v_profile.employee_id
  ) THEN RAISE EXCEPTION 'TASK_NOT_ASSIGNED'; END IF;

  IF v_profile.employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.employees AS emp
     WHERE emp.id = v_profile.employee_id AND emp.company_id = v_profile.company_id
  ) THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_LINK'; END IF;

  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations AS loc
     WHERE loc.id = p_location_id AND loc.company_id = v_profile.company_id
  ) THEN RAISE EXCEPTION 'LOCATION_NOT_AVAILABLE'; END IF;

  IF p_source_type NOT IN ('mobile_camera', 'gallery_upload')
     OR p_original_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
     OR p_original_size_bytes <= 0 OR p_original_size_bytes > 20971520
     OR p_original_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE_METADATA';
  END IF;

  SELECT ev.* INTO v_existing
    FROM public.task_evidence AS ev
   WHERE ev.submitted_by_profile_id = auth.uid() AND ev.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.task_id <> p_task_id OR v_existing.location_id IS DISTINCT FROM p_location_id
       OR v_existing.source_type <> p_source_type OR v_existing.original_mime_type <> p_original_mime_type
       OR v_existing.original_size_bytes <> p_original_size_bytes OR v_existing.original_sha256 <> lower(p_original_sha256) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.original_storage_path, v_existing.status, true;
    RETURN;
  END IF;

  SELECT ev.* INTO v_existing
    FROM public.task_evidence AS ev
   WHERE ev.company_id = v_profile.company_id AND ev.task_id = p_task_id
     AND ev.original_sha256 = lower(p_original_sha256)
     AND ev.submitted_by_profile_id = auth.uid();
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.original_storage_path, v_existing.status, true;
    RETURN;
  END IF;

  v_extension := CASE p_original_mime_type
    WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp'
    WHEN 'image/heic' THEN 'heic' WHEN 'image/heif' THEN 'heif' END;
  v_path := v_profile.company_id::text || '/' || p_task_id::text || '/' || v_evidence_id::text || '/original.' || v_extension;

  INSERT INTO public.task_evidence (
    id, company_id, task_id, location_id, submitted_by_profile_id, submitted_by_employee_id,
    source_type, original_storage_path, original_mime_type, original_size_bytes,
    original_sha256, idempotency_key
  ) VALUES (
    v_evidence_id, v_profile.company_id, p_task_id, p_location_id, v_profile.id, v_profile.employee_id,
    p_source_type, v_path, p_original_mime_type, p_original_size_bytes,
    lower(p_original_sha256), p_idempotency_key
  );
  INSERT INTO public.task_evidence_audit (evidence_id, company_id, actor_profile_id, event_type)
  VALUES (v_evidence_id, v_profile.company_id, v_profile.id, 'upload.prepared');

  RETURN QUERY SELECT v_evidence_id, v_path, 'pending_upload'::text, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_task_evidence_upload(p_evidence_id uuid)
RETURNS TABLE (storage_path text, expected_mime_type text, expected_size_bytes bigint, expected_sha256 text, upload_status text)
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE
AS $$
  SELECT ev.original_storage_path, ev.original_mime_type, ev.original_size_bytes, ev.original_sha256, ev.status
    FROM public.task_evidence AS ev
    JOIN public.profiles AS pr ON pr.id = auth.uid()
   WHERE ev.id = p_evidence_id AND ev.submitted_by_profile_id = auth.uid()
     AND pr.status = 'active' AND pr.company_id = ev.company_id;
$$;

CREATE OR REPLACE FUNCTION public.complete_task_evidence_upload(p_evidence_id uuid, p_verified_sha256 text)
RETURNS TABLE (evidence_id uuid, task_id uuid, evidence_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_evidence public.task_evidence%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles AS pr WHERE pr.id = auth.uid() AND pr.status = 'active') THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_PROVISIONED';
  END IF;
  SELECT ev.* INTO v_evidence FROM public.task_evidence AS ev
   WHERE ev.id = p_evidence_id AND ev.submitted_by_profile_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_NOT_AVAILABLE'; END IF;
  IF v_evidence.status = 'pending_review' THEN
    RETURN QUERY SELECT v_evidence.id, v_evidence.task_id, v_evidence.status; RETURN;
  END IF;
  IF lower(p_verified_sha256) <> v_evidence.original_sha256 THEN RAISE EXCEPTION 'EVIDENCE_HASH_MISMATCH'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects AS obj
     WHERE obj.bucket_id = 'task-evidence' AND obj.name = v_evidence.original_storage_path
  ) THEN RAISE EXCEPTION 'EVIDENCE_OBJECT_MISSING'; END IF;

  UPDATE public.task_evidence AS ev SET status = 'pending_review', uploaded_at = clock_timestamp()
   WHERE ev.id = v_evidence.id;
  INSERT INTO public.task_evidence_audit (evidence_id, company_id, actor_profile_id, event_type)
  VALUES (v_evidence.id, v_evidence.company_id, auth.uid(), 'upload.completed');
  RETURN QUERY SELECT v_evidence.id, v_evidence.task_id, 'pending_review'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_task_evidence_upload(p_evidence_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_evidence public.task_evidence%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles AS pr WHERE pr.id = auth.uid() AND pr.status = 'active') THEN RETURN; END IF;
  SELECT ev.* INTO v_evidence FROM public.task_evidence AS ev
   WHERE ev.id = p_evidence_id AND ev.submitted_by_profile_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_evidence.status = 'pending_review' THEN RETURN; END IF;
  UPDATE public.task_evidence AS ev SET status = 'upload_failed' WHERE ev.id = v_evidence.id;
  INSERT INTO public.task_evidence_audit (evidence_id, company_id, actor_profile_id, event_type, safe_details)
  VALUES (v_evidence.id, v_evidence.company_id, auth.uid(), 'upload.failed', '{"retryable":true}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_task_evidence_access(p_evidence_id uuid)
RETURNS TABLE (storage_path text)
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE
AS $$
  SELECT ev.original_storage_path
    FROM public.task_evidence AS ev
    JOIN public.tasks AS t ON t.id = ev.task_id AND t.company_id = ev.company_id
    JOIN public.profiles AS pr ON pr.id = auth.uid() AND pr.status = 'active' AND pr.company_id = ev.company_id
   WHERE ev.id = p_evidence_id AND ev.status = 'pending_review'
     AND (pr.role IN ('manager', 'owner', 'super_admin')
       OR (pr.role = 'employee' AND pr.employee_id IS NOT NULL
         AND (ev.submitted_by_profile_id = pr.id OR t.assigned_employee_id = pr.employee_id)));
$$;

REVOKE ALL ON FUNCTION public.prepare_task_evidence_upload(uuid, uuid, text, text, bigint, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_task_evidence_upload(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_task_evidence_upload(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fail_task_evidence_upload(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_task_evidence_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_task_evidence_upload(uuid, uuid, text, text, bigint, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_task_evidence_upload(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_task_evidence_upload(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_task_evidence_upload(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_task_evidence_access(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.can_upload_task_evidence_object(p_name text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_evidence AS ev
    JOIN public.profiles AS pr ON pr.id = auth.uid()
    WHERE ev.original_storage_path = p_name AND ev.submitted_by_profile_id = auth.uid()
      AND ev.status IN ('pending_upload', 'upload_failed')
      AND pr.status = 'active' AND pr.company_id = ev.company_id
  );
$$;

CREATE OR REPLACE FUNCTION private.can_read_task_evidence_object(p_name text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_evidence AS ev
    JOIN public.tasks AS t ON t.id = ev.task_id AND t.company_id = ev.company_id
    JOIN public.profiles AS pr ON pr.id = auth.uid() AND pr.status = 'active' AND pr.company_id = ev.company_id
    WHERE ev.original_storage_path = p_name
      AND (pr.role IN ('manager', 'owner', 'super_admin')
        OR (pr.role = 'employee' AND pr.employee_id IS NOT NULL
          AND (ev.submitted_by_profile_id = pr.id OR t.assigned_employee_id = pr.employee_id)))
  );
$$;

REVOKE ALL ON FUNCTION private.can_upload_task_evidence_object(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_read_task_evidence_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_upload_task_evidence_object(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_task_evidence_object(text) TO authenticated;

DROP POLICY IF EXISTS task_evidence_original_insert ON storage.objects;
CREATE POLICY task_evidence_original_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'task-evidence' AND private.can_upload_task_evidence_object(name)
);

DROP POLICY IF EXISTS task_evidence_original_select ON storage.objects;
CREATE POLICY task_evidence_original_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'task-evidence' AND private.can_read_task_evidence_object(name)
);

-- No authenticated UPDATE or DELETE policies are created for task-evidence objects.
-- Originals therefore cannot be overwritten or deleted through normal client access.
