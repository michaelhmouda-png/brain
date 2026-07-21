-- D1.2E migration 012: additive employee lifecycle foundation.
--
-- Approved production preflight (2026-07-22): six employees; every legacy
-- status is exactly "active"; no "actie", NULL, or other status is present.
-- This migration deliberately binds its backfill to that reviewed evidence.
-- Any intervening catalog or vocabulary drift fails before schema mutation.
--
-- Scope:
--   * preserve every legacy employee field and row;
--   * add nullable canonical lifecycle/archive metadata and versioning;
--   * add tenant-safe employee identity indexes;
--   * create a forced-RLS, server-only migration-exception register;
--   * map only exact legacy status "active";
--   * leave K1-K8, application authorization, and existing employee RLS alone.
--
-- Deployment prerequisites:
--   * migrations 010, 011, and 011a are deployed and validated;
--   * the approved migration-012 SELECT-only preflight still passes;
--   * brain-production and a healthy backup/PITR point are confirmed;
--   * this migration is applied alone; migration 013 is not included.

BEGIN;

DO $d1_012_preflight$
DECLARE
  v_anon_oid oid;
  v_authenticated_oid oid;
  v_command "char";
  v_k8_function regprocedure;
  v_target_name text;
  v_expected_column record;
BEGIN
  IF to_regclass('public.d1_employee_migration_checkpoints') IS NULL THEN
    RAISE EXCEPTION 'D1_012_CHECKPOINT_TABLE_MISSING';
  END IF;

  IF (SELECT count(*) FROM public.d1_employee_migration_checkpoints) <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.d1_employee_migration_checkpoints AS checkpoint
      WHERE checkpoint.migration_name = '202607210011_d1_employee_catalog_baseline'
        AND checkpoint.baseline_version = 1
        AND checkpoint.catalog_fingerprint = '1fdf16c9af0cba0bd7b76de8dffba5acc5bd5427a4dec704675d665f83e73a99'
        AND checkpoint.approval_reference = 'D1_2E_FINAL_IMPLEMENTATION_SPECIFICATION.md (approved)'
        AND jsonb_typeof(checkpoint.aggregate_counts) = 'object'
    ) THEN
    RAISE EXCEPTION 'D1_012_ACCEPTED_CHECKPOINT_DRIFT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.d1_employee_migration_checkpoints'::regclass
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.d1_employee_migration_checkpoints'::regclass
  ) THEN
    RAISE EXCEPTION 'D1_012_CHECKPOINT_RLS_DRIFT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS grant_row
    WHERE grant_row.table_schema = 'public'
      AND grant_row.table_name = 'd1_employee_migration_checkpoints'
      AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) OR (
    SELECT count(*)
    FROM information_schema.role_table_grants AS grant_row
    WHERE grant_row.table_schema = 'public'
      AND grant_row.table_name = 'd1_employee_migration_checkpoints'
      AND grant_row.grantee = 'service_role'
  ) <> 2 OR EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS grant_row
    WHERE grant_row.table_schema = 'public'
      AND grant_row.table_name = 'd1_employee_migration_checkpoints'
      AND grant_row.grantee = 'service_role'
      AND grant_row.privilege_type NOT IN ('SELECT', 'INSERT')
  ) THEN
    RAISE EXCEPTION 'D1_012_CHECKPOINT_GRANT_DRIFT';
  END IF;

  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'D1_012_SHA256_DIGEST_UNAVAILABLE';
  END IF;

  IF to_regclass('public.employees') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'D1_012_REQUIRED_RELATION_MISSING';
  END IF;

  FOR v_expected_column IN
    SELECT *
    FROM (VALUES
      ('id', 'uuid', 'NO'),
      ('company_id', 'uuid', 'NO'),
      ('location_id', 'uuid', 'YES'),
      ('first_name', 'text', 'NO'),
      ('last_name', 'text', 'NO'),
      ('role', 'text', 'NO'),
      ('department', 'text', 'NO'),
      ('phone', 'text', 'YES'),
      ('email', 'text', 'YES'),
      ('employment_type', 'text', 'NO'),
      ('salary', 'numeric', 'YES'),
      ('hire_date', 'date', 'YES'),
      ('status', 'text', 'NO'),
      ('notes', 'text', 'YES'),
      ('created_at', 'timestamp with time zone', 'NO'),
      ('updated_at', 'timestamp with time zone', 'NO'),
      ('department_id', 'uuid', 'YES')
    ) AS expected(column_name, data_type, is_nullable)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'employees'
        AND column_row.column_name = v_expected_column.column_name
        AND column_row.data_type = v_expected_column.data_type
        AND column_row.is_nullable = v_expected_column.is_nullable
    ) THEN
      RAISE EXCEPTION 'D1_012_EMPLOYEE_COLUMN_DRIFT: %', v_expected_column.column_name;
    END IF;
  END LOOP;

  FOREACH v_target_name IN ARRAY ARRAY[
    'employee_number',
    'lifecycle_status',
    'version',
    'lifecycle_effective_at',
    'archived_at',
    'archived_by_profile_id',
    'termination_reason_code'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'employees'
        AND column_row.column_name = v_target_name
    ) THEN
      RAISE EXCEPTION 'D1_012_TARGET_COLUMN_ALREADY_EXISTS: %', v_target_name;
    END IF;
  END LOOP;

  IF to_regclass('public.employee_migration_exceptions') IS NOT NULL
    OR to_regclass('public.employees_company_id_id_uidx') IS NOT NULL
    OR to_regclass('public.employees_company_employee_number_uidx') IS NOT NULL THEN
    RAISE EXCEPTION 'D1_012_TARGET_OBJECT_ALREADY_EXISTS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.employees'::regclass
      AND constraint_row.conname IN (
        'employees_lifecycle_status_check',
        'employees_version_positive',
        'employees_archive_shape',
        'employees_archived_by_profile_id_fkey'
      )
  ) THEN
    RAISE EXCEPTION 'D1_012_TARGET_CONSTRAINT_ALREADY_EXISTS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = 'profiles'
      AND column_row.column_name = 'id'
      AND column_row.data_type = 'uuid'
      AND column_row.is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.profiles'::regclass
      AND constraint_row.contype IN ('p', 'u')
      AND constraint_row.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) ~ '\(id\)'
  ) THEN
    RAISE EXCEPTION 'D1_012_PROFILE_ARCHIVE_REFERENCE_INCOMPATIBLE';
  END IF;

  IF (SELECT count(*) FROM public.employees) <> 6
    OR (SELECT count(*) FROM public.employees AS employee WHERE employee.status = 'active') <> 6
    OR EXISTS (
      SELECT 1
      FROM public.employees AS employee
      WHERE employee.status IS DISTINCT FROM 'active'
    ) THEN
    RAISE EXCEPTION 'D1_012_EMPLOYEE_STATUS_EVIDENCE_DRIFT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.employees AS employee
    WHERE employee.id IS NULL
      OR employee.company_id IS NULL
      OR employee.created_at IS NULL
      OR employee.updated_at IS NULL
  ) OR EXISTS (
    SELECT employee.company_id, employee.id
    FROM public.employees AS employee
    GROUP BY employee.company_id, employee.id
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM public.employees AS employee
    LEFT JOIN public.companies AS company ON company.id = employee.company_id
    WHERE company.id IS NULL
  ) THEN
    RAISE EXCEPTION 'D1_012_EMPLOYEE_IDENTITY_OR_TIMESTAMP_DRIFT';
  END IF;

  SELECT role.oid INTO v_anon_oid
  FROM pg_catalog.pg_roles AS role
  WHERE role.rolname = 'anon';

  SELECT role.oid INTO v_authenticated_oid
  FROM pg_catalog.pg_roles AS role
  WHERE role.rolname = 'authenticated';

  IF v_anon_oid IS NULL OR v_authenticated_oid IS NULL THEN
    RAISE EXCEPTION 'D1_012_REQUIRED_SUPABASE_ROLES_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.companies'::regclass
      AND relation.relrowsecurity
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS grant_row
    WHERE grant_row.table_schema = 'public'
      AND grant_row.table_name = 'companies'
      AND grant_row.grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'D1_012_MIGRATION_010_GRANT_OR_RLS_DRIFT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.companies'::regclass
      AND (0::oid = ANY (policy.polroles) OR v_anon_oid = ANY (policy.polroles))
      AND CASE policy.polcmd
        WHEN 'r' THEN regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')), '[()\s]', '', 'g') = 'true'
        WHEN 'a' THEN regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')), '[()\s]', '', 'g') = 'true'
        WHEN 'w' THEN
          regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')), '[()\s]', '', 'g') = 'true'
          AND regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')), '[()\s]', '', 'g') = 'true'
        WHEN 'd' THEN regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')), '[()\s]', '', 'g') = 'true'
        ELSE false
      END
  ) THEN
    RAISE EXCEPTION 'D1_012_MIGRATION_010_POLICY_DRIFT';
  END IF;

  FOREACH v_command IN ARRAY ARRAY['r', 'a', 'w', 'd']::"char"[]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = 'public.companies'::regclass
        AND policy.polcmd = v_command
        AND (0::oid = ANY (policy.polroles) OR v_authenticated_oid = ANY (policy.polroles))
        AND NOT CASE v_command
          WHEN 'r' THEN coalesce(regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')), '[()\s]', '', 'g') = 'true', false)
          WHEN 'a' THEN coalesce(regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')), '[()\s]', '', 'g') = 'true', false)
          WHEN 'w' THEN
            coalesce(regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')), '[()\s]', '', 'g') = 'true', false)
            AND coalesce(regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')), '[()\s]', '', 'g') = 'true', false)
          WHEN 'd' THEN coalesce(regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')), '[()\s]', '', 'g') = 'true', false)
          ELSE true
        END
    ) THEN
      RAISE EXCEPTION 'D1_012_AUTHENTICATED_COMPANY_POLICY_MISSING: %', v_command;
    END IF;
  END LOOP;

  v_k8_function := to_regprocedure(
    'public.create_task_with_outbox_event(uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,uuid,text,integer,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz)'
  );

  IF v_k8_function IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = v_k8_function
      AND pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
  ) OR NOT pg_catalog.has_function_privilege('service_role', v_k8_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', v_k8_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_k8_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'D1_012_K8_RPC_CONTRACT_DRIFT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.brain_action_proposals'::regclass),
      ('public.brain_domain_events'::regclass),
      ('public.brain_event_outbox'::regclass)
    ) AS required_kernel_table(relation_oid)
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = required_kernel_table.relation_oid
    WHERE NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'D1_012_KERNEL_RLS_DRIFT';
  END IF;
END
$d1_012_preflight$;

ALTER TABLE public.employees
  ADD COLUMN employee_number text,
  ADD COLUMN lifecycle_status text,
  ADD COLUMN version bigint NOT NULL DEFAULT 1,
  ADD COLUMN lifecycle_effective_at timestamptz,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by_profile_id uuid,
  ADD COLUMN termination_reason_code text;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_lifecycle_status_check
    CHECK (
      lifecycle_status IS NULL
      OR lifecycle_status IN (
        'draft',
        'active',
        'on_leave',
        'inactive',
        'terminated',
        'archived'
      )
    ) NOT VALID,
  ADD CONSTRAINT employees_version_positive
    CHECK (version > 0) NOT VALID,
  ADD CONSTRAINT employees_archive_shape
    CHECK (
      lifecycle_status IS DISTINCT FROM 'archived'
      OR archived_at IS NOT NULL
    ) NOT VALID,
  ADD CONSTRAINT employees_archived_by_profile_id_fkey
    FOREIGN KEY (archived_by_profile_id)
    REFERENCES public.profiles(id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX employees_company_id_id_uidx
  ON public.employees(company_id, id);

CREATE UNIQUE INDEX employees_company_employee_number_uidx
  ON public.employees(company_id, employee_number)
  WHERE employee_number IS NOT NULL;

CREATE TABLE public.employee_migration_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  company_id uuid NOT NULL,
  field_name text NOT NULL
    CHECK (field_name IN ('status', 'employment_type', 'role', 'department')),
  source_value_hash text NOT NULL
    CHECK (source_value_hash ~ '^[0-9a-f]{64}$'),
  resolution_status text NOT NULL DEFAULT 'pending'
    CHECK (resolution_status IN ('pending', 'approved', 'rejected')),
  approved_canonical_value text,
  reviewed_by_profile_id uuid
    REFERENCES public.profiles(id)
    ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT employee_migration_exceptions_employee_field_key
    UNIQUE (employee_id, field_name),
  CONSTRAINT employee_migration_exceptions_employee_company_fkey
    FOREIGN KEY (company_id, employee_id)
    REFERENCES public.employees(company_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE public.employee_migration_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_migration_exceptions FORCE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.employee_migration_exceptions
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.employee_migration_exceptions
  FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.employee_migration_exceptions
  TO service_role;

UPDATE public.employees AS employee
SET
  lifecycle_status = 'active',
  lifecycle_effective_at = coalesce(employee.updated_at, employee.created_at)
WHERE employee.status = 'active'
  AND employee.lifecycle_status IS NULL;

INSERT INTO public.employee_migration_exceptions (
  employee_id,
  company_id,
  field_name,
  source_value_hash
)
SELECT
  employee.id,
  employee.company_id,
  'status',
  encode(
    extensions.digest(convert_to(employee.status, 'UTF8'), 'sha256'),
    'hex'
  )
FROM public.employees AS employee
WHERE employee.status IS DISTINCT FROM 'active'
ON CONFLICT (employee_id, field_name) DO NOTHING;

ALTER TABLE public.employees
  VALIDATE CONSTRAINT employees_lifecycle_status_check;
ALTER TABLE public.employees
  VALIDATE CONSTRAINT employees_version_positive;
ALTER TABLE public.employees
  VALIDATE CONSTRAINT employees_archive_shape;

DO $d1_012_postcondition$
DECLARE
  v_k8_function regprocedure;
BEGIN
  IF (SELECT count(*) FROM public.employees) <> 6
    OR EXISTS (
      SELECT 1
      FROM public.employees AS employee
      WHERE employee.status IS DISTINCT FROM 'active'
        OR employee.lifecycle_status IS DISTINCT FROM 'active'
        OR employee.lifecycle_effective_at IS NULL
        OR employee.lifecycle_effective_at > employee.updated_at
        OR employee.version <> 1
        OR employee.employee_number IS NOT NULL
        OR employee.archived_at IS NOT NULL
        OR employee.archived_by_profile_id IS NOT NULL
        OR employee.termination_reason_code IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'D1_012_CANONICAL_BACKFILL_POSTCONDITION_FAILED';
  END IF;

  IF (SELECT count(*) FROM public.employee_migration_exceptions) <> 0 THEN
    RAISE EXCEPTION 'D1_012_UNEXPECTED_EXCEPTION_ROW';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.employee_migration_exceptions'::regclass
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.employee_migration_exceptions'::regclass
  ) THEN
    RAISE EXCEPTION 'D1_012_EXCEPTION_RLS_POSTCONDITION_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS grant_row
    WHERE grant_row.table_schema = 'public'
      AND grant_row.table_name = 'employee_migration_exceptions'
      AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) OR (
    SELECT count(*)
    FROM information_schema.role_table_grants AS grant_row
    WHERE grant_row.table_schema = 'public'
      AND grant_row.table_name = 'employee_migration_exceptions'
      AND grant_row.grantee = 'service_role'
  ) <> 3 OR EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS grant_row
    WHERE grant_row.table_schema = 'public'
      AND grant_row.table_name = 'employee_migration_exceptions'
      AND grant_row.grantee = 'service_role'
      AND grant_row.privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'D1_012_EXCEPTION_GRANT_POSTCONDITION_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.employees'::regclass
      AND constraint_row.conname IN (
        'employees_lifecycle_status_check',
        'employees_version_positive',
        'employees_archive_shape',
        'employees_archived_by_profile_id_fkey'
      )
      AND NOT constraint_row.convalidated
  ) THEN
    RAISE EXCEPTION 'D1_012_EMPLOYEE_CONSTRAINT_NOT_VALIDATED';
  END IF;

  v_k8_function := to_regprocedure(
    'public.create_task_with_outbox_event(uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,uuid,text,integer,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz)'
  );

  IF v_k8_function IS NULL
    OR NOT pg_catalog.has_function_privilege('service_role', v_k8_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', v_k8_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_k8_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'D1_012_K8_POSTCONDITION_FAILED';
  END IF;
END
$d1_012_postcondition$;

COMMIT;

-- Safe rollback/recovery:
--   * any failed preflight, DDL, backfill, validation, or postcondition rolls
--     back the complete transaction;
--   * after a successful deployment, application readers remain on legacy
--     columns until a separately approved cutover;
--   * if rollout pauses, leave the additive columns, indexes, and exception
--     evidence present but unused; do not rewrite legacy status or delete
--     exception evidence;
--   * do not restore anonymous company access, broaden exception-table access,
--     modify K8, or proceed to migration 013 after any failed validation.
