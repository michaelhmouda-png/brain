/*
 * Camera Evidence C5: immutable multi-photo submissions and structured task counts.
 *
 * This is additive to C2-C4. public.task_evidence remains the compatibility anchor
 * for durable C3 jobs and the atomic C4 review/task-completion transaction.
 */
BEGIN;

ALTER TABLE public.task_evidence
  ADD COLUMN c5_submission_id uuid;

ALTER TABLE public.task_evidence
  DROP CONSTRAINT task_evidence_company_id_task_id_original_sha256_key;

CREATE UNIQUE INDEX task_evidence_legacy_company_task_sha256_uidx
  ON public.task_evidence (company_id, task_id, original_sha256)
  WHERE c5_submission_id IS NULL;

CREATE TABLE public.task_evidence_count_requirements (
  task_id uuid PRIMARY KEY REFERENCES public.tasks(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  count_required boolean NOT NULL DEFAULT true CHECK (count_required),
  count_label text NOT NULL CHECK (length(btrim(count_label)) BETWEEN 1 AND 120),
  canonical_unit text NOT NULL CHECK (canonical_unit ~ '^[a-z][a-z0-9_-]{0,31}$'),
  damaged_quantity_requested boolean NOT NULL DEFAULT false,
  allow_decimals boolean NOT NULL DEFAULT false,
  employee_instructions text CHECK (
    employee_instructions IS NULL OR length(employee_instructions) <= 1000
  ),
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (company_id, task_id)
);

CREATE TABLE public.task_evidence_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL UNIQUE REFERENCES public.task_evidence(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  submitted_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  submitted_by_employee_id uuid REFERENCES public.employees(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (
    source_type IN ('mobile_camera', 'gallery_upload', 'mixed_capture')
  ),
  status text NOT NULL DEFAULT 'uploading' CHECK (
    status IN (
      'uploading',
      'upload_failed',
      'finalized',
      'queued',
      'processing',
      'ai_verified',
      'ai_rejected',
      'needs_human_review',
      'verification_failed',
      'human_approved',
      'human_rejected'
    )
  ),
  item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 10),
  total_size_bytes bigint NOT NULL CHECK (
    total_size_bytes > 0 AND total_size_bytes <= 104857600
  ),
  idempotency_key uuid NOT NULL,
  count_requirement_version integer,
  submitted_quantity numeric(14,3) CHECK (
    submitted_quantity IS NULL OR submitted_quantity BETWEEN 0 AND 1000000000
  ),
  submitted_unit text CHECK (
    submitted_unit IS NULL OR submitted_unit ~ '^[a-z][a-z0-9_-]{0,31}$'
  ),
  damaged_quantity numeric(14,3) CHECK (
    damaged_quantity IS NULL
    OR (
      damaged_quantity >= 0
      AND submitted_quantity IS NOT NULL
      AND damaged_quantity <= submitted_quantity
    )
  ),
  location_details text CHECK (location_details IS NULL OR length(location_details) <= 500),
  employee_notes text CHECK (employee_notes IS NULL OR length(employee_notes) <= 1000),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (submitted_by_profile_id, idempotency_key),
  CHECK (
    (count_requirement_version IS NULL)
      = (submitted_quantity IS NULL AND submitted_unit IS NULL)
  ),
  CHECK (
    (status IN ('uploading', 'upload_failed') AND finalized_at IS NULL)
    OR
    (status NOT IN ('uploading', 'upload_failed') AND finalized_at IS NOT NULL)
  )
);

ALTER TABLE public.task_evidence
  ADD CONSTRAINT task_evidence_c5_submission_id_fkey
  FOREIGN KEY (c5_submission_id)
  REFERENCES public.task_evidence_submissions(id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX task_evidence_c5_submission_id_uidx
  ON public.task_evidence (c5_submission_id)
  WHERE c5_submission_id IS NOT NULL;

CREATE TABLE public.task_evidence_items (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES public.task_evidence_submissions(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES public.task_evidence(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 10),
  source_type text NOT NULL CHECK (source_type IN ('mobile_camera', 'gallery_upload')),
  status text NOT NULL DEFAULT 'pending_upload'
    CHECK (status IN ('pending_upload', 'upload_failed', 'verified')),
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (
    mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
  ),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (submission_id, ordinal),
  UNIQUE (submission_id, sha256),
  UNIQUE (submission_id, id),
  CHECK ((status = 'verified') = (uploaded_at IS NOT NULL))
);

CREATE TABLE public.task_evidence_item_derivatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.task_evidence_submissions(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES public.task_evidence_items(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES public.task_evidence(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  derivative_type text NOT NULL CHECK (derivative_type = 'ai_jpeg_preview'),
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type = 'image/jpeg'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  generator text NOT NULL CHECK (length(generator) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (item_id, derivative_type)
);

CREATE TABLE public.task_evidence_submission_results (
  attempt_id uuid PRIMARY KEY
    REFERENCES public.task_evidence_verification_attempts(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES public.task_evidence_submissions(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES public.task_evidence(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  schema_version integer NOT NULL CHECK (schema_version = 2),
  full_area_covered boolean,
  submitted_quantity numeric(14,3),
  observed_quantity numeric(14,3) CHECK (
    observed_quantity IS NULL OR observed_quantity BETWEEN 0 AND 1000000000
  ),
  observed_quantity_confidence numeric(4,3) CHECK (
    observed_quantity_confidence IS NULL
    OR observed_quantity_confidence BETWEEN 0 AND 1
  ),
  count_comparison text NOT NULL CHECK (
    count_comparison IN ('matches', 'mismatch', 'cannot_verify', 'not_applicable')
  ),
  per_image_observations jsonb NOT NULL CHECK (jsonb_typeof(per_image_observations) = 'array'),
  complete_set_observations jsonb NOT NULL CHECK (
    jsonb_typeof(complete_set_observations) = 'array'
  ),
  missing_view_concerns jsonb NOT NULL CHECK (jsonb_typeof(missing_view_concerns) = 'array'),
  duplicate_view_concerns jsonb NOT NULL CHECK (
    jsonb_typeof(duplicate_view_concerns) = 'array'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (submission_id, attempt_id)
);

CREATE TABLE public.task_evidence_submission_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.task_evidence_submissions(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES public.task_evidence(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('human', 'system')),
  event_type text NOT NULL CHECK (
    event_type IN (
      'submission.prepared',
      'item.prepared',
      'item.upload_completed',
      'item.upload_failed',
      'submission.finalized',
      'verification.queued',
      'verification.started',
      'verification.completed',
      'verification.failed',
      'review.approved',
      'review.rejected',
      'task.completion_requested',
      'task.completed',
      'notification.requested'
    )
  ),
  item_id uuid REFERENCES public.task_evidence_items(id) ON DELETE RESTRICT,
  safe_details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(safe_details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX task_evidence_submissions_company_task_created_idx
  ON public.task_evidence_submissions (company_id, task_id, created_at DESC);
CREATE INDEX task_evidence_submissions_review_idx
  ON public.task_evidence_submissions (company_id, created_at DESC)
  WHERE status IN (
    'ai_verified', 'ai_rejected', 'needs_human_review',
    'verification_failed', 'human_approved', 'human_rejected'
  );
CREATE INDEX task_evidence_items_submission_ordinal_idx
  ON public.task_evidence_items (submission_id, ordinal);
CREATE INDEX task_evidence_submission_results_evidence_idx
  ON public.task_evidence_submission_results (evidence_id, created_at DESC);
CREATE INDEX task_evidence_submission_audit_submission_created_idx
  ON public.task_evidence_submission_audit (submission_id, created_at);

ALTER TABLE public.task_evidence_count_requirements OWNER TO postgres;
ALTER TABLE public.task_evidence_submissions OWNER TO postgres;
ALTER TABLE public.task_evidence_items OWNER TO postgres;
ALTER TABLE public.task_evidence_item_derivatives OWNER TO postgres;
ALTER TABLE public.task_evidence_submission_results OWNER TO postgres;
ALTER TABLE public.task_evidence_submission_audit OWNER TO postgres;

ALTER TABLE public.task_evidence_count_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_count_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_item_derivatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_item_derivatives FORCE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_submission_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_submission_results FORCE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_submission_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_submission_audit FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.task_evidence_count_requirements,
  public.task_evidence_submissions,
  public.task_evidence_items,
  public.task_evidence_item_derivatives,
  public.task_evidence_submission_results,
  public.task_evidence_submission_audit
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.task_evidence_count_requirements,
  public.task_evidence_submissions,
  public.task_evidence_items,
  public.task_evidence_item_derivatives,
  public.task_evidence_submission_results,
  public.task_evidence_submission_audit
TO service_role;

CREATE OR REPLACE FUNCTION private.reject_c5_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'C5_APPEND_ONLY_MUTATION_FORBIDDEN' USING ERRCODE = '42501';
END
$function$;

ALTER FUNCTION private.reject_c5_append_only_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_c5_append_only_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER task_evidence_submission_audit_append_only
  BEFORE UPDATE OR DELETE ON public.task_evidence_submission_audit
  FOR EACH ROW EXECUTE FUNCTION private.reject_c5_append_only_mutation();

CREATE TRIGGER task_evidence_submission_results_append_only
  BEFORE UPDATE OR DELETE ON public.task_evidence_submission_results
  FOR EACH ROW EXECUTE FUNCTION private.reject_c5_append_only_mutation();

CREATE TRIGGER task_evidence_item_derivatives_append_only
  BEFORE UPDATE OR DELETE ON public.task_evidence_item_derivatives
  FOR EACH ROW EXECUTE FUNCTION private.reject_c5_append_only_mutation();

CREATE OR REPLACE FUNCTION private.protect_c5_submission_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'C5_SUBMISSION_DELETE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.evidence_id IS DISTINCT FROM OLD.evidence_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.location_id IS DISTINCT FROM OLD.location_id
     OR NEW.submitted_by_profile_id IS DISTINCT FROM OLD.submitted_by_profile_id
     OR NEW.submitted_by_employee_id IS DISTINCT FROM OLD.submitted_by_employee_id
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.item_count IS DISTINCT FROM OLD.item_count
     OR NEW.total_size_bytes IS DISTINCT FROM OLD.total_size_bytes
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.count_requirement_version IS DISTINCT FROM OLD.count_requirement_version
     OR NEW.submitted_quantity IS DISTINCT FROM OLD.submitted_quantity
     OR NEW.submitted_unit IS DISTINCT FROM OLD.submitted_unit
     OR NEW.damaged_quantity IS DISTINCT FROM OLD.damaged_quantity
     OR NEW.location_details IS DISTINCT FROM OLD.location_details
     OR NEW.employee_notes IS DISTINCT FROM OLD.employee_notes
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'C5_SUBMISSION_CONTEXT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION private.protect_c5_submission_context() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.protect_c5_submission_context()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER task_evidence_submissions_context_immutable
  BEFORE UPDATE OR DELETE ON public.task_evidence_submissions
  FOR EACH ROW EXECUTE FUNCTION private.protect_c5_submission_context();

CREATE OR REPLACE FUNCTION private.protect_c5_evidence_item_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'C5_EVIDENCE_ITEM_DELETE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.submission_id IS DISTINCT FROM OLD.submission_id
     OR NEW.evidence_id IS DISTINCT FROM OLD.evidence_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'C5_EVIDENCE_ITEM_CONTEXT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION private.protect_c5_evidence_item_context() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.protect_c5_evidence_item_context()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER task_evidence_items_context_immutable
  BEFORE UPDATE OR DELETE ON public.task_evidence_items
  FOR EACH ROW EXECUTE FUNCTION private.protect_c5_evidence_item_context();

CREATE OR REPLACE FUNCTION private.c5_evidence_extension(p_mime_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT CASE p_mime_type
    WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp'
    WHEN 'image/heic' THEN 'heic'
    WHEN 'image/heif' THEN 'heif'
  END
$function$;

ALTER FUNCTION private.c5_evidence_extension(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.c5_evidence_extension(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_task_evidence_submission(
  p_task_id uuid,
  p_location_id uuid,
  p_source_type text,
  p_items jsonb,
  p_submitted_count jsonb,
  p_idempotency_key uuid
)
RETURNS TABLE (
  submission_id uuid,
  evidence_id uuid,
  submission_status text,
  items jsonb,
  is_duplicate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_task public.tasks%ROWTYPE;
  v_requirement public.task_evidence_count_requirements%ROWTYPE;
  v_existing public.task_evidence_submissions%ROWTYPE;
  v_submission_id uuid := gen_random_uuid();
  v_evidence_id uuid := gen_random_uuid();
  v_item jsonb;
  v_item_id uuid;
  v_ordinal integer;
  v_mime text;
  v_size bigint;
  v_hash text;
  v_path text;
  v_first_path text;
  v_first_mime text;
  v_first_size bigint;
  v_first_hash text;
  v_total_size bigint := 0;
  v_item_count integer;
  v_quantity numeric;
  v_unit text;
  v_damaged numeric;
  v_location_details text;
  v_notes text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  SELECT profile.*
  INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.status = 'active'
  FOR UPDATE;

  IF NOT FOUND
     OR v_profile.company_id IS NULL
     OR v_profile.role NOT IN ('employee', 'manager', 'owner', 'super_admin') THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_PROVISIONED' USING ERRCODE = '42501';
  END IF;

  SELECT task.*
  INTO v_task
  FROM public.tasks AS task
  WHERE task.id = p_task_id
    AND task.company_id = v_profile.company_id
    AND task.status IN ('pending', 'in_progress')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_AVAILABLE' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'employee'
     AND (
       v_profile.employee_id IS NULL
       OR v_task.assigned_employee_id IS DISTINCT FROM v_profile.employee_id
     ) THEN
    RAISE EXCEPTION 'TASK_NOT_ASSIGNED' USING ERRCODE = '42501';
  END IF;

  IF v_profile.employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.employees AS employee
    WHERE employee.id = v_profile.employee_id
      AND employee.company_id = v_profile.company_id
      AND employee.status = 'active'
  ) THEN
    RAISE EXCEPTION 'INVALID_EMPLOYEE_LINK' USING ERRCODE = '42501';
  END IF;

  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.locations AS location
    WHERE location.id = p_location_id
      AND location.company_id = v_profile.company_id
      AND location.status = 'active'
  ) THEN
    RAISE EXCEPTION 'LOCATION_NOT_AVAILABLE' USING ERRCODE = '42501';
  END IF;

  IF p_source_type NOT IN ('mobile_camera', 'gallery_upload', 'mixed_capture')
     OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE_METADATA' USING ERRCODE = '22023';
  END IF;

  v_item_count := jsonb_array_length(p_items);
  IF v_item_count < 1 OR v_item_count > 10 THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE_ITEM_COUNT' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_profile.id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := (v_item ->> 'itemId')::uuid;
    v_ordinal := (v_item ->> 'ordinal')::integer;
    v_mime := v_item ->> 'mimeType';
    v_size := (v_item ->> 'sizeBytes')::bigint;
    v_hash := lower(v_item ->> 'sha256');

    IF v_ordinal < 1
       OR v_ordinal > v_item_count
       OR v_mime NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
       OR v_size <= 0
       OR v_size > 20971520
       OR v_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'INVALID_EVIDENCE_ITEM' USING ERRCODE = '22023';
    END IF;
    IF v_item ->> 'sourceType' NOT IN ('mobile_camera', 'gallery_upload') THEN
      RAISE EXCEPTION 'INVALID_EVIDENCE_ITEM_SOURCE' USING ERRCODE = '22023';
    END IF;

    v_total_size := v_total_size + v_size;
    v_path := v_profile.company_id::text || '/' || v_task.id::text || '/'
      || v_submission_id::text || '/' || v_item_id::text || '/original.'
      || private.c5_evidence_extension(v_mime);

    IF v_ordinal = 1 THEN
      v_first_path := v_path;
      v_first_mime := v_mime;
      v_first_size := v_size;
      v_first_hash := v_hash;
    END IF;
  END LOOP;

  IF v_total_size > 104857600
     OR v_first_path IS NULL
     OR (
       SELECT count(DISTINCT (value ->> 'ordinal')::integer)
       FROM jsonb_array_elements(p_items)
     ) <> v_item_count
     OR (
       SELECT count(DISTINCT lower(value ->> 'sha256'))
       FROM jsonb_array_elements(p_items)
     ) <> v_item_count
     OR (
       SELECT count(DISTINCT (value ->> 'itemId')::uuid)
       FROM jsonb_array_elements(p_items)
     ) <> v_item_count
     OR (
       p_source_type = 'mobile_camera'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_items)
         WHERE value ->> 'sourceType' <> 'mobile_camera'
       )
     )
     OR (
       p_source_type = 'gallery_upload'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_items)
         WHERE value ->> 'sourceType' <> 'gallery_upload'
       )
     )
     OR (
       p_source_type = 'mixed_capture'
       AND (
         NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(p_items)
           WHERE value ->> 'sourceType' = 'mobile_camera'
         )
         OR NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(p_items)
           WHERE value ->> 'sourceType' = 'gallery_upload'
         )
       )
     ) THEN
    RAISE EXCEPTION 'DUPLICATE_OR_OVERSIZE_EVIDENCE_ITEM' USING ERRCODE = '22023';
  END IF;

  SELECT requirement.*
  INTO v_requirement
  FROM public.task_evidence_count_requirements AS requirement
  WHERE requirement.task_id = v_task.id
    AND requirement.company_id = v_task.company_id;

  IF FOUND THEN
    IF p_submitted_count IS NULL OR jsonb_typeof(p_submitted_count) <> 'object' THEN
      RAISE EXCEPTION 'COUNT_REQUIRED' USING ERRCODE = '22023';
    END IF;
    v_quantity := (p_submitted_count ->> 'quantity')::numeric;
    v_unit := p_submitted_count ->> 'unit';
    v_damaged := nullif(p_submitted_count ->> 'damagedQuantity', '')::numeric;
    v_location_details := nullif(btrim(p_submitted_count ->> 'locationDetails'), '');
    v_notes := nullif(btrim(p_submitted_count ->> 'notes'), '');

    IF v_quantity::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_damaged::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_quantity < 0
       OR v_quantity > 1000000000
       OR v_unit IS DISTINCT FROM v_requirement.canonical_unit
       OR (NOT v_requirement.allow_decimals AND trunc(v_quantity) <> v_quantity)
       OR (
         NOT v_requirement.damaged_quantity_requested
         AND v_damaged IS NOT NULL
       )
       OR v_damaged < 0
       OR v_damaged > v_quantity
       OR length(coalesce(v_location_details, '')) > 500
       OR length(coalesce(v_notes, '')) > 1000 THEN
      RAISE EXCEPTION 'INVALID_SUBMITTED_COUNT' USING ERRCODE = '22023';
    END IF;
  ELSIF p_submitted_count IS NOT NULL THEN
    RAISE EXCEPTION 'COUNT_NOT_CONFIGURED' USING ERRCODE = '22023';
  END IF;

  SELECT submission.*
  INTO v_existing
  FROM public.task_evidence_submissions AS submission
  WHERE submission.submitted_by_profile_id = v_profile.id
    AND submission.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.task_id <> p_task_id
       OR v_existing.location_id IS DISTINCT FROM p_location_id
       OR v_existing.source_type <> p_source_type
       OR v_existing.item_count <> v_item_count
       OR v_existing.total_size_bytes <> v_total_size
       OR v_existing.count_requirement_version IS DISTINCT FROM v_requirement.version
       OR v_existing.submitted_quantity IS DISTINCT FROM v_quantity
       OR v_existing.submitted_unit IS DISTINCT FROM v_unit
       OR v_existing.damaged_quantity IS DISTINCT FROM v_damaged
       OR v_existing.location_details IS DISTINCT FROM v_location_details
       OR v_existing.employee_notes IS DISTINCT FROM v_notes
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_items) AS requested(value)
         LEFT JOIN public.task_evidence_items AS stored
           ON stored.submission_id = v_existing.id
          AND stored.id = (requested.value ->> 'itemId')::uuid
          AND stored.ordinal = (requested.value ->> 'ordinal')::integer
          AND stored.source_type = requested.value ->> 'sourceType'
          AND stored.mime_type = requested.value ->> 'mimeType'
          AND stored.size_bytes = (requested.value ->> 'sizeBytes')::bigint
          AND stored.sha256 = lower(requested.value ->> 'sha256')
         WHERE stored.id IS NULL
       ) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
    END IF;

    RETURN QUERY
    SELECT
      v_existing.id,
      v_existing.evidence_id,
      v_existing.status,
      coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'itemId', item.id,
              'ordinal', item.ordinal,
              'sourceType', item.source_type,
              'status', item.status,
              'storagePath', item.storage_path,
              'mimeType', item.mime_type,
              'sizeBytes', item.size_bytes,
              'sha256', item.sha256
            )
            ORDER BY item.ordinal
          )
          FROM public.task_evidence_items AS item
          WHERE item.submission_id = v_existing.id
        ),
        '[]'::jsonb
      ),
      true;
    RETURN;
  END IF;

  INSERT INTO public.task_evidence (
    id,
    c5_submission_id,
    company_id,
    task_id,
    location_id,
    submitted_by_profile_id,
    submitted_by_employee_id,
    source_type,
    status,
    original_storage_path,
    original_mime_type,
    original_size_bytes,
    original_sha256,
    idempotency_key
  ) VALUES (
    v_evidence_id,
    v_submission_id,
    v_profile.company_id,
    v_task.id,
    p_location_id,
    v_profile.id,
    v_profile.employee_id,
    CASE WHEN p_source_type = 'mixed_capture' THEN 'gallery_upload' ELSE p_source_type END,
    'pending_upload',
    v_first_path,
    v_first_mime,
    v_first_size,
    v_first_hash,
    p_idempotency_key
  );

  INSERT INTO public.task_evidence_submissions (
    id,
    evidence_id,
    company_id,
    task_id,
    location_id,
    submitted_by_profile_id,
    submitted_by_employee_id,
    source_type,
    item_count,
    total_size_bytes,
    idempotency_key,
    count_requirement_version,
    submitted_quantity,
    submitted_unit,
    damaged_quantity,
    location_details,
    employee_notes
  ) VALUES (
    v_submission_id,
    v_evidence_id,
    v_profile.company_id,
    v_task.id,
    p_location_id,
    v_profile.id,
    v_profile.employee_id,
    p_source_type,
    v_item_count,
    v_total_size,
    p_idempotency_key,
    v_requirement.version,
    v_quantity,
    v_unit,
    v_damaged,
    v_location_details,
    v_notes
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := (v_item ->> 'itemId')::uuid;
    v_ordinal := (v_item ->> 'ordinal')::integer;
    v_mime := v_item ->> 'mimeType';
    v_size := (v_item ->> 'sizeBytes')::bigint;
    v_hash := lower(v_item ->> 'sha256');
    v_path := v_profile.company_id::text || '/' || v_task.id::text || '/'
      || v_submission_id::text || '/' || v_item_id::text || '/original.'
      || private.c5_evidence_extension(v_mime);

    INSERT INTO public.task_evidence_items (
      id,
      submission_id,
      evidence_id,
      company_id,
      ordinal,
      source_type,
      storage_path,
      mime_type,
      size_bytes,
      sha256
    ) VALUES (
      v_item_id,
      v_submission_id,
      v_evidence_id,
      v_profile.company_id,
      v_ordinal,
      v_item ->> 'sourceType',
      v_path,
      v_mime,
      v_size,
      v_hash
    );

    INSERT INTO public.task_evidence_submission_audit (
      submission_id,
      evidence_id,
      company_id,
      actor_profile_id,
      actor_type,
      event_type,
      item_id,
      safe_details
    ) VALUES (
      v_submission_id,
      v_evidence_id,
      v_profile.company_id,
      v_profile.id,
      'human',
      'item.prepared',
      v_item_id,
      jsonb_build_object('ordinal', v_ordinal)
    );
  END LOOP;

  INSERT INTO public.task_evidence_audit (
    evidence_id,
    company_id,
    actor_profile_id,
    event_type,
    safe_details
  ) VALUES (
    v_evidence_id,
    v_profile.company_id,
    v_profile.id,
    'upload.prepared',
    jsonb_build_object('submissionId', v_submission_id, 'itemCount', v_item_count)
  );

  INSERT INTO public.task_evidence_submission_audit (
    submission_id,
    evidence_id,
    company_id,
    actor_profile_id,
    actor_type,
    event_type,
    safe_details
  ) VALUES (
    v_submission_id,
    v_evidence_id,
    v_profile.company_id,
    v_profile.id,
    'human',
    'submission.prepared',
    jsonb_build_object('itemCount', v_item_count)
  );

  RETURN QUERY
  SELECT
    v_submission_id,
    v_evidence_id,
    'uploading'::text,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'itemId', item.id,
          'ordinal', item.ordinal,
          'sourceType', item.source_type,
          'status', item.status,
          'storagePath', item.storage_path,
          'mimeType', item.mime_type,
          'sizeBytes', item.size_bytes,
          'sha256', item.sha256
        )
        ORDER BY item.ordinal
      )
      FROM public.task_evidence_items AS item
      WHERE item.submission_id = v_submission_id
    ),
    false;
END
$function$;

ALTER FUNCTION public.prepare_task_evidence_submission(uuid, uuid, text, jsonb, jsonb, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prepare_task_evidence_submission(uuid, uuid, text, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_task_evidence_submission(uuid, uuid, text, jsonb, jsonb, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_task_evidence_submission_upload(
  p_submission_id uuid
)
RETURNS TABLE (
  submission_id uuid,
  evidence_id uuid,
  submission_status text,
  item_id uuid,
  ordinal integer,
  item_status text,
  storage_path text,
  expected_mime_type text,
  expected_size_bytes bigint,
  expected_sha256 text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
STABLE
AS $function$
  SELECT
    submission.id,
    submission.evidence_id,
    submission.status,
    item.id,
    item.ordinal,
    item.status,
    item.storage_path,
    item.mime_type,
    item.size_bytes,
    item.sha256
  FROM public.task_evidence_submissions AS submission
  JOIN public.task_evidence_items AS item
    ON item.submission_id = submission.id
    AND item.company_id = submission.company_id
    AND item.evidence_id = submission.evidence_id
  JOIN public.profiles AS profile
    ON profile.id = auth.uid()
    AND profile.status = 'active'
    AND profile.company_id = submission.company_id
  WHERE submission.id = p_submission_id
    AND submission.submitted_by_profile_id = profile.id
  ORDER BY item.ordinal
$function$;

ALTER FUNCTION public.get_task_evidence_submission_upload(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_task_evidence_submission_upload(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_task_evidence_submission_upload(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_task_evidence_submission_item(
  p_submission_id uuid,
  p_item_id uuid,
  p_verified_sha256 text
)
RETURNS TABLE (item_id uuid, item_status text, submission_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_submission public.task_evidence_submissions%ROWTYPE;
  v_item public.task_evidence_items%ROWTYPE;
BEGIN
  SELECT submission.*
  INTO v_submission
  FROM public.task_evidence_submissions AS submission
  JOIN public.profiles AS profile
    ON profile.id = auth.uid()
    AND profile.status = 'active'
    AND profile.company_id = submission.company_id
  WHERE submission.id = p_submission_id
    AND submission.submitted_by_profile_id = profile.id
  FOR UPDATE OF submission;

  IF NOT FOUND OR v_submission.status NOT IN ('uploading', 'upload_failed') THEN
    RAISE EXCEPTION 'SUBMISSION_NOT_UPLOADABLE' USING ERRCODE = '42501';
  END IF;

  SELECT item.*
  INTO v_item
  FROM public.task_evidence_items AS item
  WHERE item.id = p_item_id
    AND item.submission_id = v_submission.id
    AND item.company_id = v_submission.company_id
    AND item.evidence_id = v_submission.evidence_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVIDENCE_ITEM_NOT_AVAILABLE' USING ERRCODE = '42501';
  END IF;

  IF v_item.status = 'verified' THEN
    RETURN QUERY SELECT v_item.id, v_item.status, v_submission.status;
    RETURN;
  END IF;

  IF lower(p_verified_sha256) IS DISTINCT FROM v_item.sha256
     OR NOT EXISTS (
       SELECT 1
       FROM storage.objects AS object
       WHERE object.bucket_id = 'task-evidence'
         AND object.name = v_item.storage_path
     ) THEN
    RAISE EXCEPTION 'EVIDENCE_ITEM_VERIFICATION_FAILED' USING ERRCODE = '22023';
  END IF;

  UPDATE public.task_evidence_items AS item
  SET status = 'verified',
      uploaded_at = clock_timestamp()
  WHERE item.id = v_item.id;

  UPDATE public.task_evidence_submissions AS submission
  SET status = 'uploading'
  WHERE submission.id = v_submission.id
    AND submission.status = 'upload_failed';

  INSERT INTO public.task_evidence_submission_audit (
    submission_id,
    evidence_id,
    company_id,
    actor_profile_id,
    actor_type,
    event_type,
    item_id,
    safe_details
  ) VALUES (
    v_submission.id,
    v_submission.evidence_id,
    v_submission.company_id,
    auth.uid(),
    'human',
    'item.upload_completed',
    v_item.id,
    jsonb_build_object('ordinal', v_item.ordinal)
  );

  RETURN QUERY SELECT v_item.id, 'verified'::text, 'uploading'::text;
END
$function$;

ALTER FUNCTION public.complete_task_evidence_submission_item(uuid, uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_task_evidence_submission_item(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_task_evidence_submission_item(uuid, uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fail_task_evidence_submission_item(
  p_submission_id uuid,
  p_item_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_submission public.task_evidence_submissions%ROWTYPE;
  v_item public.task_evidence_items%ROWTYPE;
BEGIN
  SELECT submission.*
  INTO v_submission
  FROM public.task_evidence_submissions AS submission
  JOIN public.profiles AS profile
    ON profile.id = auth.uid()
    AND profile.status = 'active'
    AND profile.company_id = submission.company_id
  WHERE submission.id = p_submission_id
    AND submission.submitted_by_profile_id = profile.id
  FOR UPDATE OF submission;

  IF NOT FOUND OR v_submission.status NOT IN ('uploading', 'upload_failed') THEN
    RETURN;
  END IF;

  SELECT item.*
  INTO v_item
  FROM public.task_evidence_items AS item
  WHERE item.id = p_item_id
    AND item.submission_id = v_submission.id
  FOR UPDATE;

  IF NOT FOUND OR v_item.status = 'verified' THEN
    RETURN;
  END IF;

  UPDATE public.task_evidence_items SET status = 'upload_failed' WHERE id = v_item.id;
  UPDATE public.task_evidence_submissions SET status = 'upload_failed'
    WHERE id = v_submission.id;
  UPDATE public.task_evidence SET status = 'upload_failed'
    WHERE id = v_submission.evidence_id
      AND status IN ('pending_upload', 'upload_failed');

  INSERT INTO public.task_evidence_submission_audit (
    submission_id,
    evidence_id,
    company_id,
    actor_profile_id,
    actor_type,
    event_type,
    item_id,
    safe_details
  ) VALUES (
    v_submission.id,
    v_submission.evidence_id,
    v_submission.company_id,
    auth.uid(),
    'human',
    'item.upload_failed',
    v_item.id,
    jsonb_build_object('ordinal', v_item.ordinal, 'retryable', true)
  );
END
$function$;

ALTER FUNCTION public.fail_task_evidence_submission_item(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fail_task_evidence_submission_item(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_task_evidence_submission_item(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_task_evidence_submission(
  p_submission_id uuid
)
RETURNS TABLE (submission_id uuid, evidence_id uuid, submission_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_submission public.task_evidence_submissions%ROWTYPE;
BEGIN
  SELECT submission.*
  INTO v_submission
  FROM public.task_evidence_submissions AS submission
  JOIN public.profiles AS profile
    ON profile.id = auth.uid()
    AND profile.status = 'active'
    AND profile.company_id = submission.company_id
  WHERE submission.id = p_submission_id
    AND submission.submitted_by_profile_id = profile.id
  FOR UPDATE OF submission;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBMISSION_NOT_AVAILABLE' USING ERRCODE = '42501';
  END IF;

  IF v_submission.status NOT IN ('uploading', 'upload_failed') THEN
    RETURN QUERY
    SELECT v_submission.id, v_submission.evidence_id, v_submission.status;
    RETURN;
  END IF;

  PERFORM 1
  FROM public.task_evidence_items AS item
  WHERE item.submission_id = v_submission.id
  FOR UPDATE;

  IF (
    SELECT count(*)
    FROM public.task_evidence_items AS item
    WHERE item.submission_id = v_submission.id
      AND item.status = 'verified'
  ) <> v_submission.item_count THEN
    RAISE EXCEPTION 'SUBMISSION_INCOMPLETE' USING ERRCODE = '23514';
  END IF;

  UPDATE public.task_evidence_submissions
  SET status = 'finalized',
      finalized_at = clock_timestamp()
  WHERE id = v_submission.id;

  UPDATE public.task_evidence
  SET status = 'pending_review',
      uploaded_at = clock_timestamp()
  WHERE id = v_submission.evidence_id
    AND status IN ('pending_upload', 'upload_failed');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBMISSION_FINALIZATION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.task_evidence_audit (
    evidence_id,
    company_id,
    actor_profile_id,
    event_type,
    safe_details
  ) VALUES (
    v_submission.evidence_id,
    v_submission.company_id,
    auth.uid(),
    'upload.completed',
    jsonb_build_object('submissionId', v_submission.id, 'itemCount', v_submission.item_count)
  );

  INSERT INTO public.task_evidence_submission_audit (
    submission_id,
    evidence_id,
    company_id,
    actor_profile_id,
    actor_type,
    event_type,
    safe_details
  ) VALUES (
    v_submission.id,
    v_submission.evidence_id,
    v_submission.company_id,
    auth.uid(),
    'human',
    'submission.finalized',
    jsonb_build_object('itemCount', v_submission.item_count)
  );

  RETURN QUERY SELECT v_submission.id, v_submission.evidence_id, 'finalized'::text;
END
$function$;

ALTER FUNCTION public.finalize_task_evidence_submission(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_task_evidence_submission(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_task_evidence_submission(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_task_evidence_item_access(
  p_evidence_id uuid,
  p_item_id uuid
)
RETURNS TABLE (storage_path text, mime_type text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
STABLE
AS $function$
  SELECT item.storage_path, item.mime_type
  FROM public.task_evidence_items AS item
  JOIN public.task_evidence_submissions AS submission
    ON submission.id = item.submission_id
    AND submission.evidence_id = item.evidence_id
    AND submission.company_id = item.company_id
  JOIN public.tasks AS task
    ON task.id = submission.task_id
    AND task.company_id = submission.company_id
  JOIN public.profiles AS profile
    ON profile.id = auth.uid()
    AND profile.status = 'active'
    AND profile.company_id = submission.company_id
  WHERE item.id = p_item_id
    AND item.evidence_id = p_evidence_id
    AND item.status = 'verified'
    AND (
      profile.role IN ('manager', 'owner', 'super_admin')
      OR (
        profile.role = 'employee'
        AND profile.employee_id IS NOT NULL
        AND (
          submission.submitted_by_profile_id = profile.id
          OR task.assigned_employee_id = profile.employee_id
        )
      )
    )
$function$;

ALTER FUNCTION public.get_task_evidence_item_access(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_task_evidence_item_access(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_task_evidence_item_access(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_task_evidence_verification_context(
  p_evidence_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
STABLE
AS $function$
  SELECT jsonb_build_object(
    'submissionId', submission.id,
    'evidenceId', evidence.id,
    'companyId', evidence.company_id,
    'taskId', evidence.task_id,
    'taskTitle', task.title,
    'taskDescription', task.description,
    'taskPriority', task.priority,
    'items',
      CASE
        WHEN submission.id IS NULL THEN jsonb_build_array(
          jsonb_build_object(
            'itemId', evidence.id,
            'ordinal', 1,
            'storagePath', evidence.original_storage_path,
            'mimeType', evidence.original_mime_type,
            'sha256', evidence.original_sha256
          )
        )
        ELSE (
          SELECT jsonb_agg(
            jsonb_build_object(
              'itemId', item.id,
              'ordinal', item.ordinal,
              'storagePath', item.storage_path,
              'mimeType', item.mime_type,
              'sha256', item.sha256
            )
            ORDER BY item.ordinal
          )
          FROM public.task_evidence_items AS item
          WHERE item.submission_id = submission.id
            AND item.status = 'verified'
        )
      END,
    'countRequirement',
      CASE WHEN requirement.task_id IS NULL THEN NULL ELSE jsonb_build_object(
        'countRequired', requirement.count_required,
        'countLabel', requirement.count_label,
        'unit', requirement.canonical_unit,
        'damagedQuantityRequested', requirement.damaged_quantity_requested,
        'allowDecimals', requirement.allow_decimals,
        'instructions', requirement.employee_instructions,
        'version', requirement.version
      ) END,
    'submittedCount',
      CASE WHEN submission.submitted_quantity IS NULL THEN NULL ELSE jsonb_build_object(
        'quantity', submission.submitted_quantity,
        'unit', submission.submitted_unit,
        'damagedQuantity', submission.damaged_quantity,
        'locationDetails', submission.location_details,
        'notes', submission.employee_notes
      ) END
  )
  FROM public.task_evidence AS evidence
  JOIN public.tasks AS task
    ON task.id = evidence.task_id
    AND task.company_id = evidence.company_id
  LEFT JOIN public.task_evidence_submissions AS submission
    ON submission.evidence_id = evidence.id
    AND submission.company_id = evidence.company_id
  LEFT JOIN public.task_evidence_count_requirements AS requirement
    ON requirement.task_id = evidence.task_id
    AND requirement.company_id = evidence.company_id
    AND (
      submission.count_requirement_version IS NULL
      OR requirement.version = submission.count_requirement_version
    )
  WHERE evidence.id = p_evidence_id
$function$;

ALTER FUNCTION public.get_task_evidence_verification_context(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_task_evidence_verification_context(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_task_evidence_verification_context(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_task_evidence_item_derivative(
  p_evidence_id uuid,
  p_item_id uuid,
  p_storage_path text,
  p_size_bytes bigint,
  p_sha256 text,
  p_source_sha256 text,
  p_generator text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_item public.task_evidence_items%ROWTYPE;
BEGIN
  SELECT item.*
  INTO v_item
  FROM public.task_evidence_items AS item
  WHERE item.id = p_item_id
    AND item.evidence_id = p_evidence_id;

  IF NOT FOUND
     OR v_item.sha256 <> lower(p_source_sha256)
     OR p_storage_path <> v_item.company_id::text || '/' || v_item.submission_id::text
       || '/' || v_item.id::text || '/derived/' || lower(p_sha256) || '.jpg'
     OR p_size_bytes <= 0
     OR p_size_bytes > 20971520
     OR lower(p_sha256) !~ '^[0-9a-f]{64}$'
     OR length(p_generator) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'INVALID_DERIVATIVE' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.task_evidence_item_derivatives (
    submission_id,
    item_id,
    evidence_id,
    company_id,
    derivative_type,
    storage_path,
    mime_type,
    size_bytes,
    sha256,
    source_sha256,
    generator
  ) VALUES (
    v_item.submission_id,
    v_item.id,
    v_item.evidence_id,
    v_item.company_id,
    'ai_jpeg_preview',
    p_storage_path,
    'image/jpeg',
    p_size_bytes,
    lower(p_sha256),
    lower(p_source_sha256),
    p_generator
  )
  ON CONFLICT (item_id, derivative_type) DO NOTHING;
END
$function$;

ALTER FUNCTION public.record_task_evidence_item_derivative(uuid, uuid, text, bigint, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_task_evidence_item_derivative(uuid, uuid, text, bigint, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_task_evidence_item_derivative(uuid, uuid, text, bigint, text, text, text)
  TO service_role;

ALTER TABLE public.task_evidence_verification_attempts
  DROP CONSTRAINT task_evidence_verification_attempts_schema_version_check;
ALTER TABLE public.task_evidence_verification_attempts
  ADD CONSTRAINT task_evidence_verification_attempts_schema_version_check
  CHECK (schema_version IN (1, 2));

CREATE OR REPLACE FUNCTION public.complete_task_evidence_set_verification_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_model_name text,
  p_model_version text,
  p_result jsonb,
  p_usage_metadata jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_job public.task_evidence_verification_jobs%ROWTYPE;
  v_attempt public.task_evidence_verification_attempts%ROWTYPE;
  v_submission public.task_evidence_submissions%ROWTYPE;
  v_status text;
  v_verdict text := p_result ->> 'verdict';
  v_confidence numeric := (p_result ->> 'confidence')::numeric;
  v_comparison text := p_result ->> 'countComparison';
BEGIN
  SELECT job.*
  INTO v_job
  FROM public.task_evidence_verification_jobs AS job
  WHERE job.id = p_job_id
    AND job.status = 'processing'
    AND job.lease_token = p_lease_token
    AND job.lease_expires_at >= clock_timestamp()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEASE_NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.task_evidence_verification_attempts AS attempt
  WHERE attempt.job_id = v_job.id
    AND attempt.attempt_number = v_job.attempt_count
  FOR UPDATE;

  SELECT submission.*
  INTO v_submission
  FROM public.task_evidence_submissions AS submission
  WHERE submission.evidence_id = v_job.evidence_id
    AND submission.company_id = v_job.company_id
  FOR UPDATE;

  IF NOT FOUND
     OR p_result ->> 'schemaVersion' <> '2'
     OR v_verdict NOT IN ('verified', 'rejected', 'needs_human_review')
     OR v_confidence < 0
     OR v_confidence > 1
     OR v_comparison NOT IN ('matches', 'mismatch', 'cannot_verify', 'not_applicable')
     OR nullif(p_result ->> 'submittedQuantity', '')::numeric
        IS DISTINCT FROM v_submission.submitted_quantity
     OR jsonb_typeof(p_result -> 'perImageObservations') <> 'array'
     OR jsonb_array_length(p_result -> 'perImageObservations') <> v_submission.item_count
     OR jsonb_typeof(p_result -> 'completeSetObservations') <> 'array'
     OR jsonb_typeof(p_result -> 'reasonCodes') <> 'array'
     OR jsonb_typeof(p_result -> 'uncertaintyFlags') <> 'array'
     OR jsonb_typeof(p_result -> 'missingViewConcerns') <> 'array'
     OR jsonb_typeof(p_result -> 'duplicateViewConcerns') <> 'array'
     OR jsonb_typeof(p_usage_metadata) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_VERIFICATION_RESULT' USING ERRCODE = '22023';
  END IF;

  v_status := CASE v_verdict
    WHEN 'verified' THEN 'ai_verified'
    WHEN 'rejected' THEN 'ai_rejected'
    ELSE 'needs_human_review'
  END;

  UPDATE public.task_evidence_verification_attempts AS attempt
  SET schema_version = 2,
      model_name = left(p_model_name, 200),
      model_version = left(p_model_version, 200),
      status = 'succeeded',
      verdict = v_verdict,
      confidence = v_confidence,
      explanation = left(p_result ->> 'explanation', 600),
      reason_codes = p_result -> 'reasonCodes',
      visible_observations = p_result -> 'completeSetObservations',
      uncertainty_flags = p_result -> 'uncertaintyFlags',
      usage_metadata = p_usage_metadata,
      completed_at = clock_timestamp()
  WHERE attempt.id = v_attempt.id;

  INSERT INTO public.task_evidence_submission_results (
    attempt_id,
    submission_id,
    evidence_id,
    company_id,
    schema_version,
    full_area_covered,
    submitted_quantity,
    observed_quantity,
    observed_quantity_confidence,
    count_comparison,
    per_image_observations,
    complete_set_observations,
    missing_view_concerns,
    duplicate_view_concerns
  ) VALUES (
    v_attempt.id,
    v_submission.id,
    v_submission.evidence_id,
    v_submission.company_id,
    2,
    (p_result ->> 'fullAreaCovered')::boolean,
    v_submission.submitted_quantity,
    nullif(p_result ->> 'observedQuantity', '')::numeric,
    nullif(p_result ->> 'observedQuantityConfidence', '')::numeric,
    v_comparison,
    p_result -> 'perImageObservations',
    p_result -> 'completeSetObservations',
    p_result -> 'missingViewConcerns',
    p_result -> 'duplicateViewConcerns'
  );

  UPDATE public.task_evidence_verification_jobs
  SET status = 'completed',
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE id = v_job.id;

  UPDATE public.task_evidence SET status = v_status WHERE id = v_job.evidence_id;
  UPDATE public.task_evidence_submissions SET status = v_status WHERE id = v_submission.id;

  INSERT INTO public.task_evidence_audit (
    evidence_id,
    company_id,
    actor_profile_id,
    actor_type,
    event_type,
    safe_details
  ) VALUES (
    v_job.evidence_id,
    v_job.company_id,
    NULL,
    'system',
    'verification.succeeded',
    jsonb_build_object('verdict', v_verdict, 'attempt', v_job.attempt_count)
  );

  INSERT INTO public.task_evidence_submission_audit (
    submission_id,
    evidence_id,
    company_id,
    actor_profile_id,
    actor_type,
    event_type,
    safe_details
  ) VALUES (
    v_submission.id,
    v_submission.evidence_id,
    v_submission.company_id,
    NULL,
    'system',
    'verification.completed',
    jsonb_build_object('verdict', v_verdict, 'attempt', v_job.attempt_count)
  );
END
$function$;

ALTER FUNCTION public.complete_task_evidence_set_verification_job(uuid, uuid, text, text, jsonb, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_task_evidence_set_verification_job(uuid, uuid, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_task_evidence_set_verification_job(uuid, uuid, text, text, jsonb, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_task_evidence_submission_review_context(
  p_evidence_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
STABLE
AS $function$
  SELECT CASE
    WHEN submission.id IS NULL THEN jsonb_build_object(
      'submissionId', evidence.id,
      'legacy', true,
      'items', jsonb_build_array(
        jsonb_build_object(
          'itemId', evidence.id,
          'ordinal', 1,
          'mimeType', evidence.original_mime_type
        )
      ),
      'countRequirement', NULL,
      'submittedCount', NULL,
      'setResult', NULL,
      'submissionAudit', '[]'::jsonb
    )
    ELSE jsonb_build_object(
      'submissionId', submission.id,
      'legacy', false,
      'items', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'itemId', item.id,
            'ordinal', item.ordinal,
            'mimeType', item.mime_type
          )
          ORDER BY item.ordinal
        )
        FROM public.task_evidence_items AS item
        WHERE item.submission_id = submission.id
          AND item.status = 'verified'
      ),
      'countRequirement',
        CASE WHEN requirement.task_id IS NULL THEN NULL ELSE jsonb_build_object(
          'countRequired', requirement.count_required,
          'countLabel', requirement.count_label,
          'unit', requirement.canonical_unit,
          'damagedQuantityRequested', requirement.damaged_quantity_requested,
          'allowDecimals', requirement.allow_decimals,
          'instructions', requirement.employee_instructions,
          'version', requirement.version
        ) END,
      'submittedCount',
        CASE WHEN submission.submitted_quantity IS NULL THEN NULL ELSE jsonb_build_object(
          'quantity', submission.submitted_quantity,
          'unit', submission.submitted_unit,
          'damagedQuantity', submission.damaged_quantity,
          'locationDetails', submission.location_details,
          'notes', submission.employee_notes
        ) END,
      'setResult', (
        SELECT jsonb_build_object(
          'fullAreaCovered', result.full_area_covered,
          'submittedQuantity', result.submitted_quantity,
          'observedQuantity', result.observed_quantity,
          'observedQuantityConfidence', result.observed_quantity_confidence,
          'countComparison', result.count_comparison,
          'perImageObservations', result.per_image_observations,
          'completeSetObservations', result.complete_set_observations,
          'missingViewConcerns', result.missing_view_concerns,
          'duplicateViewConcerns', result.duplicate_view_concerns
        )
        FROM public.task_evidence_submission_results AS result
        WHERE result.submission_id = submission.id
        ORDER BY result.created_at DESC
        LIMIT 1
      ),
      'submissionAudit', coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'eventType', audit.event_type,
              'actorType', audit.actor_type,
              'itemId', audit.item_id,
              'safeDetails', audit.safe_details,
              'createdAt', audit.created_at
            )
            ORDER BY audit.created_at
          )
          FROM public.task_evidence_submission_audit AS audit
          WHERE audit.submission_id = submission.id
        ),
        '[]'::jsonb
      )
    )
  END
  FROM public.task_evidence AS evidence
  JOIN public.profiles AS profile
    ON profile.id = auth.uid()
    AND profile.status = 'active'
    AND profile.company_id = evidence.company_id
    AND profile.role IN ('manager', 'owner', 'super_admin')
  LEFT JOIN public.task_evidence_submissions AS submission
    ON submission.evidence_id = evidence.id
    AND submission.company_id = evidence.company_id
  LEFT JOIN public.task_evidence_count_requirements AS requirement
    ON requirement.task_id = evidence.task_id
    AND requirement.company_id = evidence.company_id
  WHERE evidence.id = p_evidence_id
$function$;

ALTER FUNCTION public.get_task_evidence_submission_review_context(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_task_evidence_submission_review_context(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_task_evidence_submission_review_context(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.can_upload_task_evidence_object(p_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.task_evidence_items AS item
    JOIN public.task_evidence_submissions AS submission
      ON submission.id = item.submission_id
      AND submission.company_id = item.company_id
      AND submission.evidence_id = item.evidence_id
    JOIN public.profiles AS profile
      ON profile.id = auth.uid()
      AND profile.status = 'active'
      AND profile.company_id = submission.company_id
    WHERE item.storage_path = p_name
      AND item.status IN ('pending_upload', 'upload_failed')
      AND submission.submitted_by_profile_id = profile.id
      AND submission.status IN ('uploading', 'upload_failed')
  )
  OR EXISTS (
    SELECT 1
    FROM public.task_evidence AS evidence
    JOIN public.profiles AS profile ON profile.id = auth.uid()
    WHERE evidence.original_storage_path = p_name
      AND evidence.submitted_by_profile_id = auth.uid()
      AND evidence.status IN ('pending_upload', 'upload_failed')
      AND profile.status = 'active'
      AND profile.company_id = evidence.company_id
  )
$function$;

CREATE OR REPLACE FUNCTION private.can_read_task_evidence_object(p_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.task_evidence_items AS item
    JOIN public.task_evidence_submissions AS submission
      ON submission.id = item.submission_id
      AND submission.company_id = item.company_id
      AND submission.evidence_id = item.evidence_id
    JOIN public.tasks AS task
      ON task.id = submission.task_id
      AND task.company_id = submission.company_id
    JOIN public.profiles AS profile
      ON profile.id = auth.uid()
      AND profile.status = 'active'
      AND profile.company_id = submission.company_id
    WHERE item.storage_path = p_name
      AND (
        profile.role IN ('manager', 'owner', 'super_admin')
        OR (
          profile.role = 'employee'
          AND profile.employee_id IS NOT NULL
          AND (
            submission.submitted_by_profile_id = profile.id
            OR task.assigned_employee_id = profile.employee_id
          )
        )
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.task_evidence AS evidence
    JOIN public.tasks AS task
      ON task.id = evidence.task_id
      AND task.company_id = evidence.company_id
    JOIN public.profiles AS profile
      ON profile.id = auth.uid()
      AND profile.status = 'active'
      AND profile.company_id = evidence.company_id
    WHERE evidence.original_storage_path = p_name
      AND (
        profile.role IN ('manager', 'owner', 'super_admin')
        OR (
          profile.role = 'employee'
          AND profile.employee_id IS NOT NULL
          AND (
            evidence.submitted_by_profile_id = profile.id
            OR task.assigned_employee_id = profile.employee_id
          )
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION private.sync_c5_submission_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.task_evidence_submissions AS submission
  SET status = NEW.status
  WHERE submission.evidence_id = NEW.id
    AND submission.company_id = NEW.company_id
    AND submission.status IS DISTINCT FROM NEW.status
    AND NEW.status NOT IN ('pending_upload', 'pending_review');
  RETURN NEW;
END
$function$;

ALTER FUNCTION private.sync_c5_submission_status() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.sync_c5_submission_status()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER task_evidence_sync_c5_submission_status
AFTER UPDATE OF status ON public.task_evidence
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION private.sync_c5_submission_status();

CREATE OR REPLACE FUNCTION private.mirror_c5_evidence_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_submission public.task_evidence_submissions%ROWTYPE;
  v_event text;
BEGIN
  SELECT submission.*
  INTO v_submission
  FROM public.task_evidence_submissions AS submission
  WHERE submission.evidence_id = NEW.evidence_id
    AND submission.company_id = NEW.company_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_event := CASE NEW.event_type
    WHEN 'verification.queued' THEN 'verification.queued'
    WHEN 'verification.started' THEN 'verification.started'
    WHEN 'verification.failed' THEN 'verification.failed'
    WHEN 'review.approved' THEN 'review.approved'
    WHEN 'review.rejected' THEN 'review.rejected'
    WHEN 'task.completion_requested' THEN 'task.completion_requested'
    WHEN 'task.completed' THEN 'task.completed'
    ELSE NULL
  END;

  IF v_event IS NOT NULL THEN
    INSERT INTO public.task_evidence_submission_audit (
      submission_id,
      evidence_id,
      company_id,
      actor_profile_id,
      actor_type,
      event_type,
      safe_details
    ) VALUES (
      v_submission.id,
      v_submission.evidence_id,
      v_submission.company_id,
      NEW.actor_profile_id,
      NEW.actor_type,
      v_event,
      NEW.safe_details
    );
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION private.mirror_c5_evidence_audit() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.mirror_c5_evidence_audit()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER task_evidence_audit_mirror_c5
AFTER INSERT ON public.task_evidence_audit
FOR EACH ROW
EXECUTE FUNCTION private.mirror_c5_evidence_audit();

CREATE OR REPLACE FUNCTION private.request_evidence_rejection_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_submission public.task_evidence_submissions%ROWTYPE;
BEGIN
  IF NEW.status <> 'human_rejected' OR OLD.status = 'human_rejected' THEN
    RETURN NEW;
  END IF;

  SELECT submission.*
  INTO v_submission
  FROM public.task_evidence_submissions AS submission
  WHERE submission.evidence_id = NEW.id
    AND submission.company_id = NEW.company_id;

  IF FOUND THEN
    INSERT INTO public.task_evidence_submission_audit (
      submission_id,
      evidence_id,
      company_id,
      actor_profile_id,
      actor_type,
      event_type,
      safe_details
    ) VALUES (
      v_submission.id,
      v_submission.evidence_id,
      v_submission.company_id,
      NULL,
      'system',
      'notification.requested',
      jsonb_build_object(
        'eventType',
        'evidence.human_rejected',
        'deliveryObligation',
        'existing_notification_outbox'
      )
    );
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION private.request_evidence_rejection_notification() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.request_evidence_rejection_notification()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER task_evidence_rejection_notification
AFTER UPDATE OF status ON public.task_evidence
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION private.request_evidence_rejection_notification();

CREATE OR REPLACE FUNCTION private.localize_evidence_rejection_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_language text;
  v_task_title text;
  v_note text;
BEGIN
  IF NEW.notification_type <> 'evidence.human_rejected'
     OR NEW.related_entity_type <> 'task_evidence' THEN
    RETURN NEW;
  END IF;

  SELECT
    profile.preferred_language,
    CASE
      WHEN profile.preferred_language = 'ar'
        THEN coalesce(localization.title, task.title)
      ELSE task.title
    END,
    review.note
  INTO v_language, v_task_title, v_note
  FROM public.profiles AS profile
  JOIN public.task_evidence AS evidence
    ON evidence.id = NEW.related_entity_id
    AND evidence.company_id = NEW.company_id
  JOIN public.tasks AS task
    ON task.id = evidence.task_id
    AND task.company_id = evidence.company_id
  LEFT JOIN public.task_localizations AS localization
    ON localization.task_id = task.id
    AND localization.company_id = task.company_id
    AND localization.language = 'ar'
  LEFT JOIN public.task_evidence_reviews AS review
    ON review.evidence_id = evidence.id
    AND review.company_id = evidence.company_id
  WHERE profile.id = NEW.recipient_id
    AND profile.company_id = NEW.company_id
    AND profile.status = 'active';

  IF NOT FOUND THEN RETURN NEW; END IF;

  NEW.title := left(
    CASE v_language
      WHEN 'ar' THEN v_task_title || ': تم رفض الدليل'
      ELSE v_task_title || ': Evidence rejected'
    END,
    200
  );
  NEW.message := left(
    CASE
      WHEN v_note IS NULL THEN
        CASE v_language
          WHEN 'ar' THEN 'يرجى مراجعة الدليل وإعادة إرساله.'
          ELSE 'Review the evidence and submit a new evidence set.'
        END
      ELSE
        CASE v_language
          WHEN 'ar' THEN 'سبب المراجع: ' || left(v_note, 300)
          ELSE 'Reviewer reason: ' || left(v_note, 300)
        END
    END,
    500
  );
  RETURN NEW;
END
$function$;

ALTER FUNCTION private.localize_evidence_rejection_notification() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.localize_evidence_rejection_notification()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER notifications_localize_evidence_rejection
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION private.localize_evidence_rejection_notification();

CREATE OR REPLACE FUNCTION public.configure_task_evidence_count_requirement(
  p_task_id uuid,
  p_expected_task_updated_at timestamptz,
  p_requirement jsonb
)
RETURNS TABLE (task_id uuid, requirement jsonb, update_outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_task public.tasks%ROWTYPE;
  v_existing public.task_evidence_count_requirements%ROWTYPE;
  v_label text;
  v_unit text;
  v_instructions text;
  v_damaged boolean;
  v_decimals boolean;
BEGIN
  SELECT profile.*
  INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.status = 'active'
    AND profile.role IN ('manager', 'owner', 'super_admin')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUNT_REQUIREMENT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT task.*
  INTO v_task
  FROM public.tasks AS task
  WHERE task.id = p_task_id
    AND task.company_id = v_profile.company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_EDIT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_task.updated_at IS DISTINCT FROM p_expected_task_updated_at THEN
    RAISE EXCEPTION 'TASK_EDIT_STALE' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.task_evidence AS evidence
    WHERE evidence.task_id = v_task.id
      AND evidence.company_id = v_task.company_id
  ) THEN
    RAISE EXCEPTION 'COUNT_REQUIREMENT_LOCKED_BY_EVIDENCE' USING ERRCODE = '23514';
  END IF;

  SELECT requirement.*
  INTO v_existing
  FROM public.task_evidence_count_requirements AS requirement
  WHERE requirement.task_id = v_task.id
    AND requirement.company_id = v_task.company_id
  FOR UPDATE;

  IF p_requirement IS NULL THEN
    IF FOUND THEN
      DELETE FROM public.task_evidence_count_requirements
      WHERE task_id = v_task.id;
      UPDATE public.tasks SET updated_at = clock_timestamp() WHERE id = v_task.id;
      RETURN QUERY SELECT v_task.id, NULL::jsonb, 'updated'::text;
    ELSE
      RETURN QUERY SELECT v_task.id, NULL::jsonb, 'unchanged'::text;
    END IF;
    RETURN;
  END IF;

  IF jsonb_typeof(p_requirement) <> 'object'
     OR coalesce((p_requirement ->> 'countRequired')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'COUNT_REQUIREMENT_INVALID' USING ERRCODE = '22023';
  END IF;

  v_label := nullif(btrim(p_requirement ->> 'countLabel'), '');
  v_unit := lower(nullif(btrim(p_requirement ->> 'unit'), ''));
  v_instructions := nullif(btrim(p_requirement ->> 'instructions'), '');
  v_damaged := coalesce((p_requirement ->> 'damagedQuantityRequested')::boolean, false);
  v_decimals := coalesce((p_requirement ->> 'allowDecimals')::boolean, false);

  IF v_label IS NULL
     OR length(v_label) > 120
     OR v_unit !~ '^[a-z][a-z0-9_-]{0,31}$'
     OR length(coalesce(v_instructions, '')) > 1000 THEN
    RAISE EXCEPTION 'COUNT_REQUIREMENT_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.task_evidence_count_requirements (
    task_id,
    company_id,
    version,
    count_required,
    count_label,
    canonical_unit,
    damaged_quantity_requested,
    allow_decimals,
    employee_instructions,
    created_by_profile_id,
    updated_by_profile_id
  ) VALUES (
    v_task.id,
    v_task.company_id,
    1,
    true,
    v_label,
    v_unit,
    v_damaged,
    v_decimals,
    v_instructions,
    v_profile.id,
    v_profile.id
  )
  ON CONFLICT (task_id) DO UPDATE
  SET version = public.task_evidence_count_requirements.version + 1,
      count_label = EXCLUDED.count_label,
      canonical_unit = EXCLUDED.canonical_unit,
      damaged_quantity_requested = EXCLUDED.damaged_quantity_requested,
      allow_decimals = EXCLUDED.allow_decimals,
      employee_instructions = EXCLUDED.employee_instructions,
      updated_by_profile_id = EXCLUDED.updated_by_profile_id,
      updated_at = clock_timestamp();

  UPDATE public.tasks SET updated_at = clock_timestamp() WHERE id = v_task.id;

  RETURN QUERY
  SELECT
    v_task.id,
    jsonb_build_object(
      'countRequired', requirement.count_required,
      'countLabel', requirement.count_label,
      'unit', requirement.canonical_unit,
      'damagedQuantityRequested', requirement.damaged_quantity_requested,
      'allowDecimals', requirement.allow_decimals,
      'instructions', requirement.employee_instructions,
      'version', requirement.version
    ),
    'updated'::text
  FROM public.task_evidence_count_requirements AS requirement
  WHERE requirement.task_id = v_task.id;
END
$function$;

ALTER FUNCTION public.configure_task_evidence_count_requirement(uuid, timestamptz, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.configure_task_evidence_count_requirement(uuid, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configure_task_evidence_count_requirement(uuid, timestamptz, jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_management_task_with_count_requirement(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_count_requirement jsonb,
  p_update_count_requirement boolean
)
RETURNS TABLE (task_id uuid, update_outcome text, resulting_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_update record;
  v_effective_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_existing_title text;
  v_count_changed boolean := false;
  v_count_rows integer := 0;
  v_label text;
  v_unit text;
  v_instructions text;
  v_damaged boolean;
  v_decimals boolean;
BEGIN
  IF v_effective_patch = '{}'::jsonb AND p_update_count_requirement IS TRUE THEN
    SELECT task.title
    INTO v_existing_title
    FROM public.tasks AS task
    WHERE task.id = p_task_id
      AND task.company_id = p_company_id;

    IF FOUND THEN
      v_effective_patch := jsonb_build_object('title', v_existing_title);
    END IF;
  END IF;

  SELECT result.*
  INTO v_update
  FROM public.update_management_task(
    p_actor_profile_id,
    p_company_id,
    p_task_id,
    p_expected_updated_at,
    v_effective_patch
  ) AS result;

  IF p_update_count_requirement IS TRUE THEN
    IF EXISTS (
      SELECT 1
      FROM public.task_evidence AS evidence
      WHERE evidence.task_id = p_task_id
        AND evidence.company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'COUNT_REQUIREMENT_LOCKED_BY_EVIDENCE' USING ERRCODE = '23514';
    END IF;

    IF p_count_requirement IS NULL THEN
      DELETE FROM public.task_evidence_count_requirements AS requirement
      WHERE requirement.task_id = p_task_id
        AND requirement.company_id = p_company_id;
      GET DIAGNOSTICS v_count_rows = ROW_COUNT;
      v_count_changed := v_count_rows > 0;
    ELSE
      IF jsonb_typeof(p_count_requirement) <> 'object'
         OR coalesce((p_count_requirement ->> 'countRequired')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'COUNT_REQUIREMENT_INVALID' USING ERRCODE = '22023';
      END IF;
      v_label := nullif(btrim(p_count_requirement ->> 'countLabel'), '');
      v_unit := lower(nullif(btrim(p_count_requirement ->> 'unit'), ''));
      v_instructions := nullif(btrim(p_count_requirement ->> 'instructions'), '');
      v_damaged := coalesce(
        (p_count_requirement ->> 'damagedQuantityRequested')::boolean,
        false
      );
      v_decimals := coalesce(
        (p_count_requirement ->> 'allowDecimals')::boolean,
        false
      );
      IF v_label IS NULL
         OR length(v_label) > 120
         OR v_unit !~ '^[a-z][a-z0-9_-]{0,31}$'
         OR length(coalesce(v_instructions, '')) > 1000 THEN
        RAISE EXCEPTION 'COUNT_REQUIREMENT_INVALID' USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.task_evidence_count_requirements (
        task_id,
        company_id,
        version,
        count_required,
        count_label,
        canonical_unit,
        damaged_quantity_requested,
        allow_decimals,
        employee_instructions,
        created_by_profile_id,
        updated_by_profile_id
      ) VALUES (
        p_task_id,
        p_company_id,
        1,
        true,
        v_label,
        v_unit,
        v_damaged,
        v_decimals,
        v_instructions,
        p_actor_profile_id,
        p_actor_profile_id
      )
      ON CONFLICT (task_id) DO UPDATE
      SET version = public.task_evidence_count_requirements.version + 1,
          count_label = EXCLUDED.count_label,
          canonical_unit = EXCLUDED.canonical_unit,
          damaged_quantity_requested = EXCLUDED.damaged_quantity_requested,
          allow_decimals = EXCLUDED.allow_decimals,
          employee_instructions = EXCLUDED.employee_instructions,
          updated_by_profile_id = EXCLUDED.updated_by_profile_id,
          updated_at = clock_timestamp();
      v_count_changed := true;
    END IF;
  END IF;

  IF v_count_changed AND v_update.update_outcome = 'unchanged' THEN
    UPDATE public.tasks AS task
    SET updated_at = clock_timestamp()
    WHERE task.id = p_task_id
      AND task.company_id = p_company_id
    RETURNING task.updated_at INTO v_update.resulting_updated_at;
    v_update.update_outcome := 'updated';
  END IF;

  RETURN QUERY
  SELECT
    v_update.task_id,
    v_update.update_outcome,
    v_update.resulting_updated_at;
END
$function$;

ALTER FUNCTION public.update_management_task_with_count_requirement(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_management_task_with_count_requirement(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_management_task_with_count_requirement(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, boolean
) TO service_role;

CREATE OR REPLACE FUNCTION public.list_my_task_evidence_count_requirements()
RETURNS TABLE (task_id uuid, requirement jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
STABLE
AS $function$
  SELECT
    task.id,
    jsonb_build_object(
      'countRequired', requirement.count_required,
      'countLabel', requirement.count_label,
      'unit', requirement.canonical_unit,
      'damagedQuantityRequested', requirement.damaged_quantity_requested,
      'allowDecimals', requirement.allow_decimals,
      'instructions', requirement.employee_instructions,
      'version', requirement.version
    )
  FROM public.profiles AS profile
  JOIN public.tasks AS task
    ON task.company_id = profile.company_id
    AND task.status IN ('pending', 'in_progress')
  JOIN public.task_evidence_count_requirements AS requirement
    ON requirement.task_id = task.id
    AND requirement.company_id = task.company_id
  WHERE profile.id = auth.uid()
    AND profile.status = 'active'
    AND (
      profile.role IN ('manager', 'owner', 'super_admin')
      OR (
        profile.role = 'employee'
        AND profile.employee_id IS NOT NULL
        AND task.assigned_employee_id = profile.employee_id
      )
    )
$function$;

ALTER FUNCTION public.list_my_task_evidence_count_requirements() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_my_task_evidence_count_requirements()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_task_evidence_count_requirements()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.insert_brain_task_count_requirement(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_task_id uuid,
  p_proposal_id uuid,
  p_requirement jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_proposal_requirement jsonb;
  v_label text;
  v_unit text;
  v_instructions text;
BEGIN
  SELECT proposal.canonical_payload -> 'count_requirement'
  INTO v_proposal_requirement
  FROM public.brain_action_proposals AS proposal
  WHERE proposal.id = p_proposal_id
    AND proposal.actor_id = p_actor_profile_id
    AND proposal.profile_id = p_actor_profile_id
    AND proposal.tenant_id = p_company_id
    AND proposal.canonical_action = 'create_task'
    AND proposal.status = 'executing';

  IF v_proposal_requirement IS NULL
     OR v_proposal_requirement IS DISTINCT FROM p_requirement
     OR jsonb_typeof(p_requirement) <> 'object'
     OR coalesce((p_requirement ->> 'countRequired')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'COUNT_REQUIREMENT_PROPOSAL_MISMATCH' USING ERRCODE = '42501';
  END IF;

  v_label := nullif(btrim(p_requirement ->> 'countLabel'), '');
  v_unit := lower(nullif(btrim(p_requirement ->> 'unit'), ''));
  v_instructions := nullif(btrim(p_requirement ->> 'instructions'), '');
  IF v_label IS NULL
     OR length(v_label) > 120
     OR v_unit !~ '^[a-z][a-z0-9_-]{0,31}$'
     OR length(coalesce(v_instructions, '')) > 1000 THEN
    RAISE EXCEPTION 'COUNT_REQUIREMENT_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.task_evidence_count_requirements (
    task_id,
    company_id,
    version,
    count_required,
    count_label,
    canonical_unit,
    damaged_quantity_requested,
    allow_decimals,
    employee_instructions,
    created_by_profile_id,
    updated_by_profile_id
  ) VALUES (
    p_task_id,
    p_company_id,
    1,
    true,
    v_label,
    v_unit,
    coalesce((p_requirement ->> 'damagedQuantityRequested')::boolean, false),
    coalesce((p_requirement ->> 'allowDecimals')::boolean, false),
    v_instructions,
    p_actor_profile_id,
    p_actor_profile_id
  );
END
$function$;

ALTER FUNCTION private.insert_brain_task_count_requirement(uuid, uuid, uuid, uuid, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.insert_brain_task_count_requirement(uuid, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_task_with_count_requirement_and_outbox_event(
  p_task_id uuid,
  p_actor_id uuid,
  p_profile_id uuid,
  p_tenant_id uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_status text,
  p_assigned_employee_id uuid,
  p_due_date date,
  p_event_id uuid,
  p_event_type text,
  p_event_schema_version integer,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_command_id uuid,
  p_correlation_id uuid,
  p_event_causation_id uuid,
  p_proposal_id uuid,
  p_idempotency_key text,
  p_event_payload jsonb,
  p_occurred_at timestamptz,
  p_count_requirement jsonb
)
RETURNS TABLE (
  task_id uuid,
  title text,
  priority text,
  status text,
  assigned_employee_id uuid,
  due_date date,
  outbox_event_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_result record;
BEGIN
  SELECT result.*
  INTO v_result
  FROM public.create_task_with_outbox_event(
    p_task_id,
    p_actor_id,
    p_profile_id,
    p_tenant_id,
    p_title,
    p_description,
    p_priority,
    p_status,
    p_assigned_employee_id,
    p_due_date,
    p_event_id,
    p_event_type,
    p_event_schema_version,
    p_aggregate_type,
    p_aggregate_id,
    p_command_id,
    p_correlation_id,
    p_event_causation_id,
    p_proposal_id,
    p_idempotency_key,
    p_event_payload,
    p_occurred_at
  ) AS result;
  PERFORM private.insert_brain_task_count_requirement(
    p_profile_id,
    p_tenant_id,
    p_task_id,
    p_proposal_id,
    p_count_requirement
  );
  RETURN QUERY SELECT
    v_result.task_id,
    v_result.title,
    v_result.priority,
    v_result.status,
    v_result.assigned_employee_id,
    v_result.due_date,
    v_result.outbox_event_id;
END
$function$;

ALTER FUNCTION public.create_task_with_count_requirement_and_outbox_event(
  uuid, uuid, uuid, uuid, text, text, text, text, uuid, date,
  uuid, text, integer, text, uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_task_with_count_requirement_and_outbox_event(
  uuid, uuid, uuid, uuid, text, text, text, text, uuid, date,
  uuid, text, integer, text, uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_task_with_count_requirement_and_outbox_event(
  uuid, uuid, uuid, uuid, text, text, text, text, uuid, date,
  uuid, text, integer, text, uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.create_task_with_count_requirement_and_outbox_event_due_at(
  p_task_id uuid,
  p_actor_id uuid,
  p_profile_id uuid,
  p_tenant_id uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_status text,
  p_assigned_employee_id uuid,
  p_due_date date,
  p_due_at timestamptz,
  p_event_id uuid,
  p_event_type text,
  p_event_schema_version integer,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_command_id uuid,
  p_correlation_id uuid,
  p_event_causation_id uuid,
  p_proposal_id uuid,
  p_idempotency_key text,
  p_event_payload jsonb,
  p_occurred_at timestamptz,
  p_count_requirement jsonb
)
RETURNS TABLE (
  task_id uuid,
  title text,
  priority text,
  status text,
  assigned_employee_id uuid,
  due_date date,
  due_at timestamptz,
  outbox_event_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_result record;
BEGIN
  SELECT result.*
  INTO v_result
  FROM public.create_task_with_outbox_event_due_at(
    p_task_id,
    p_actor_id,
    p_profile_id,
    p_tenant_id,
    p_title,
    p_description,
    p_priority,
    p_status,
    p_assigned_employee_id,
    p_due_date,
    p_due_at,
    p_event_id,
    p_event_type,
    p_event_schema_version,
    p_aggregate_type,
    p_aggregate_id,
    p_command_id,
    p_correlation_id,
    p_event_causation_id,
    p_proposal_id,
    p_idempotency_key,
    p_event_payload,
    p_occurred_at
  ) AS result;
  PERFORM private.insert_brain_task_count_requirement(
    p_profile_id,
    p_tenant_id,
    p_task_id,
    p_proposal_id,
    p_count_requirement
  );
  RETURN QUERY SELECT
    v_result.task_id,
    v_result.title,
    v_result.priority,
    v_result.status,
    v_result.assigned_employee_id,
    v_result.due_date,
    v_result.due_at,
    v_result.outbox_event_id;
END
$function$;

ALTER FUNCTION public.create_task_with_count_requirement_and_outbox_event_due_at(
  uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, timestamptz,
  uuid, text, integer, text, uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_task_with_count_requirement_and_outbox_event_due_at(
  uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, timestamptz,
  uuid, text, integer, text, uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_task_with_count_requirement_and_outbox_event_due_at(
  uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, timestamptz,
  uuid, text, integer, text, uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz, jsonb
) TO service_role;

COMMENT ON TABLE public.task_evidence_submissions IS
  'C5 immutable multi-photo submission header. evidence_id is the C2-C4 compatibility anchor.';
COMMENT ON TABLE public.task_evidence_items IS
  'Immutable originals in stable ordinal order; authenticated clients have no direct table writes.';
COMMENT ON TABLE public.task_evidence_count_requirements IS
  'Canonical task evidence count contract. Changes are rejected after any evidence exists.';
COMMENT ON FUNCTION public.prepare_task_evidence_submission(uuid, uuid, text, jsonb, jsonb, uuid) IS
  'Prepares 1-10 immutable evidence items under one company/task-scoped submission and idempotency identity.';
COMMENT ON FUNCTION public.complete_task_evidence_set_verification_job(uuid, uuid, text, text, jsonb, jsonb) IS
  'Lease-bound service-role completion for strict C5 aggregate results. It never mutates task status.';
COMMENT ON FUNCTION public.configure_task_evidence_count_requirement(uuid, timestamptz, jsonb) IS
  'Management-only optimistic count requirement update; refuses reinterpretation after evidence exists.';

COMMIT;
