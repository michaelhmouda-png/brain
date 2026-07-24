-- D1.2E migration 011: authoritative employee-domain catalog baseline.
--
-- This migration does not reconstruct or claim historical migration state.
-- The audited live catalog is authoritative because
-- supabase_migrations.schema_migrations is absent (42P01).
--
-- Scope:
--   * fail closed unless migration 010's security outcome remains present;
--   * fail closed unless required employee-domain and K8 objects remain present;
--   * create one forced-RLS, server-only, append-only checkpoint table;
--   * record one deterministic SHA-256 structural catalog fingerprint and
--     sanitized aggregate counts without storing personal employee data.
--
-- Deployment prerequisites:
--   * migration 010 is deployed and fully validated;
--   * the target project/environment and healthy backup/PITR point are recorded;
--   * a read-only deployment-time fingerprint and sanitized aggregate capture
--     have been reviewed under D1.2E;
--   * migration 011 is applied alone; migration 012 or later is not included.

BEGIN;

DO $d1_011_preflight$
DECLARE
  v_anon_oid oid;
  v_authenticated_oid oid;
  v_command "char";
  v_required_relation text;
  v_k8_function regprocedure;
BEGIN
  IF to_regclass('public.d1_employee_migration_checkpoints') IS NOT NULL THEN
    RAISE EXCEPTION 'D1_011_CHECKPOINT_TABLE_ALREADY_EXISTS';
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'D1_011_UNEXPECTED_STANDARD_MIGRATION_HISTORY';
  END IF;

  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'D1_011_SHA256_DIGEST_UNAVAILABLE';
  END IF;

  FOREACH v_required_relation IN ARRAY ARRAY[
    'auth.users',
    'public.companies',
    'public.profiles',
    'public.employees',
    'public.locations',
    'public.departments',
    'public.tasks',
    'public.attendance_records',
    'public.shifts',
    'public.weekly_schedules',
    'public.recurring_shifts',
    'public.shift_swaps',
    'public.time_off_requests',
    'public.announcement_acknowledgments',
    'public.brain_action_proposals',
    'public.brain_domain_events',
    'public.brain_event_outbox'
  ]
  LOOP
    IF to_regclass(v_required_relation) IS NULL THEN
      RAISE EXCEPTION 'D1_011_REQUIRED_RELATION_MISSING: %', v_required_relation;
    END IF;
  END LOOP;

  SELECT r.oid INTO v_anon_oid
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'anon';

  SELECT r.oid INTO v_authenticated_oid
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'authenticated';

  IF v_anon_oid IS NULL OR v_authenticated_oid IS NULL THEN
    RAISE EXCEPTION 'D1_011_REQUIRED_SUPABASE_ROLES_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    WHERE c.oid = 'public.companies'::regclass
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'D1_011_COMPANIES_RLS_NOT_ENABLED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'companies'
      AND g.grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'D1_011_MIGRATION_010_ANON_GRANT_REGRESSION';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS p
    WHERE p.polrelid = 'public.companies'::regclass
      AND (0::oid = ANY (p.polroles) OR v_anon_oid = ANY (p.polroles))
      AND CASE p.polcmd
        WHEN 'r' THEN regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '')), '[()\s]', '', 'g') = 'true'
        WHEN 'a' THEN regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')), '[()\s]', '', 'g') = 'true'
        WHEN 'w' THEN
          regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '')), '[()\s]', '', 'g') = 'true'
          AND regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')), '[()\s]', '', 'g') = 'true'
        WHEN 'd' THEN regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '')), '[()\s]', '', 'g') = 'true'
        ELSE false
      END
  ) THEN
    RAISE EXCEPTION 'D1_011_MIGRATION_010_POLICY_REGRESSION';
  END IF;

  FOREACH v_command IN ARRAY ARRAY['r', 'a', 'w', 'd']::"char"[]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS p
      WHERE p.polrelid = 'public.companies'::regclass
        AND p.polcmd = v_command
        AND (0::oid = ANY (p.polroles) OR v_authenticated_oid = ANY (p.polroles))
        AND NOT CASE v_command
          WHEN 'r' THEN coalesce(regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '')), '[()\s]', '', 'g') = 'true', false)
          WHEN 'a' THEN coalesce(regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')), '[()\s]', '', 'g') = 'true', false)
          WHEN 'w' THEN
            coalesce(regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '')), '[()\s]', '', 'g') = 'true', false)
            AND coalesce(regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')), '[()\s]', '', 'g') = 'true', false)
          WHEN 'd' THEN coalesce(regexp_replace(lower(coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '')), '[()\s]', '', 'g') = 'true', false)
          ELSE true
        END
    ) THEN
      RAISE EXCEPTION 'D1_011_AUTHENTICATED_COMPANY_POLICY_MISSING: %', v_command;
    END IF;
  END LOOP;

  v_k8_function := to_regprocedure(
    'public.create_task_with_outbox_event(uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,uuid,text,integer,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz)'
  );

  IF v_k8_function IS NULL THEN
    RAISE EXCEPTION 'D1_011_K8_CREATE_TASK_RPC_MISSING_OR_CHANGED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_k8_function
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'D1_011_K8_CREATE_TASK_RPC_SECURITY_DRIFT';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role', v_k8_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', v_k8_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_k8_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'D1_011_K8_CREATE_TASK_RPC_GRANT_DRIFT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.brain_action_proposals'::regclass),
      ('public.brain_domain_events'::regclass),
      ('public.brain_event_outbox'::regclass)
    ) AS required_kernel_table(relation_oid)
    JOIN pg_catalog.pg_class AS c ON c.oid = required_kernel_table.relation_oid
    WHERE NOT c.relrowsecurity OR NOT c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'D1_011_KERNEL_RLS_SECURITY_DRIFT';
  END IF;
END
$d1_011_preflight$;

CREATE TABLE public.d1_employee_migration_checkpoints (
  migration_name text PRIMARY KEY,
  baseline_version integer NOT NULL CHECK (baseline_version = 1),
  catalog_fingerprint text NOT NULL CHECK (catalog_fingerprint ~ '^[0-9a-f]{64}$'),
  aggregate_counts jsonb NOT NULL CHECK (jsonb_typeof(aggregate_counts) = 'object'),
  approval_reference text NOT NULL CHECK (btrim(approval_reference) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.d1_employee_migration_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d1_employee_migration_checkpoints FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.d1_employee_migration_checkpoints
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.d1_employee_migration_checkpoints
  TO service_role;

WITH catalog_evidence AS (
  SELECT jsonb_build_object(
    'relations', (
      SELECT coalesce(jsonb_agg(to_jsonb(relation_row) ORDER BY relation_row.schema_name, relation_row.relation_name), '[]'::jsonb)
      FROM (
        SELECT
          n.nspname AS schema_name,
          c.relname AS relation_name,
          c.relkind::text AS relation_kind,
          pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
          c.relrowsecurity AS rls_enabled,
          c.relforcerowsecurity AS rls_forced
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          OR (n.nspname = 'auth' AND c.relname = 'users')
      ) AS relation_row
    ),
    'columns', (
      SELECT coalesce(jsonb_agg(to_jsonb(column_row) ORDER BY column_row.schema_name, column_row.relation_name, column_row.ordinal_position), '[]'::jsonb)
      FROM (
        SELECT
          n.nspname AS schema_name,
          c.relname AS relation_name,
          a.attnum AS ordinal_position,
          a.attname AS column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
          a.attnotnull AS not_null,
          pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS default_expression
        FROM pg_catalog.pg_attribute AS a
        JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef AS ad
          ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE a.attnum > 0
          AND NOT a.attisdropped
          AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users'))
      ) AS column_row
    ),
    'constraints', (
      SELECT coalesce(jsonb_agg(to_jsonb(constraint_row) ORDER BY constraint_row.schema_name, constraint_row.relation_name, constraint_row.constraint_name), '[]'::jsonb)
      FROM (
        SELECT
          n.nspname AS schema_name,
          c.relname AS relation_name,
          con.conname AS constraint_name,
          con.contype::text AS constraint_type,
          con.convalidated AS validated,
          pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
        FROM pg_catalog.pg_constraint AS con
        JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          OR (n.nspname = 'auth' AND c.relname = 'users')
      ) AS constraint_row
    ),
    'indexes', (
      SELECT coalesce(jsonb_agg(to_jsonb(index_row) ORDER BY index_row.schema_name, index_row.relation_name, index_row.index_name), '[]'::jsonb)
      FROM (
        SELECT
          ns.nspname AS schema_name,
          tbl.relname AS relation_name,
          idx.relname AS index_name,
          i.indisunique AS is_unique,
          i.indisprimary AS is_primary,
          i.indisvalid AS is_valid,
          pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_catalog.pg_index AS i
        JOIN pg_catalog.pg_class AS tbl ON tbl.oid = i.indrelid
        JOIN pg_catalog.pg_class AS idx ON idx.oid = i.indexrelid
        JOIN pg_catalog.pg_namespace AS ns ON ns.oid = tbl.relnamespace
        WHERE ns.nspname = 'public'
          OR (ns.nspname = 'auth' AND tbl.relname = 'users')
      ) AS index_row
    ),
    'policies', (
      SELECT coalesce(jsonb_agg(to_jsonb(policy_row) ORDER BY policy_row.schema_name, policy_row.relation_name, policy_row.policy_name), '[]'::jsonb)
      FROM (
        SELECT
          n.nspname AS schema_name,
          c.relname AS relation_name,
          p.polname AS policy_name,
          p.polcmd::text AS command,
          p.polpermissive AS permissive,
          ARRAY(
            SELECT CASE
              WHEN role_oid = 0::oid THEN 'public'
              ELSE pg_catalog.pg_get_userbyid(role_oid)
            END
            FROM unnest(p.polroles) AS policy_role(role_oid)
            ORDER BY 1
          ) AS roles,
          pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS using_expression,
          pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
        FROM pg_catalog.pg_policy AS p
        JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
      ) AS policy_row
    ),
    'table_grants', (
      SELECT coalesce(jsonb_agg(to_jsonb(grant_row) ORDER BY grant_row.table_schema, grant_row.table_name, grant_row.grantee, grant_row.privilege_type), '[]'::jsonb)
      FROM (
        SELECT
          g.table_schema,
          g.table_name,
          g.grantee,
          g.privilege_type,
          g.is_grantable
        FROM information_schema.role_table_grants AS g
        WHERE g.table_schema = 'public'
      ) AS grant_row
    ),
    'functions', (
      SELECT coalesce(jsonb_agg(to_jsonb(function_row) ORDER BY function_row.schema_name, function_row.function_name, function_row.identity_arguments), '[]'::jsonb)
      FROM (
        SELECT
          n.nspname AS schema_name,
          p.proname AS function_name,
          pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
          pg_catalog.pg_get_function_result(p.oid) AS result_type,
          p.prosecdef AS security_definer,
          p.provolatile::text AS volatility,
          p.proconfig AS function_config
        FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'private')
      ) AS function_row
    ),
    'routine_grants', (
      SELECT coalesce(jsonb_agg(to_jsonb(routine_grant_row) ORDER BY routine_grant_row.routine_schema, routine_grant_row.routine_name, routine_grant_row.grantee, routine_grant_row.privilege_type), '[]'::jsonb)
      FROM (
        SELECT
          g.routine_schema,
          g.routine_name,
          g.grantee,
          g.privilege_type,
          g.is_grantable
        FROM information_schema.routine_privileges AS g
        WHERE g.routine_schema IN ('public', 'private')
      ) AS routine_grant_row
    )
  ) AS evidence
),
aggregate_evidence AS (
  SELECT jsonb_build_object(
    'companies', (SELECT count(*) FROM public.companies),
    'profiles', (SELECT count(*) FROM public.profiles),
    'employees', (SELECT count(*) FROM public.employees),
    'tasks', (SELECT count(*) FROM public.tasks),
    'attendance_records', (SELECT count(*) FROM public.attendance_records),
    'shifts', (SELECT count(*) FROM public.shifts),
    'weekly_schedules', (SELECT count(*) FROM public.weekly_schedules),
    'recurring_shifts', (SELECT count(*) FROM public.recurring_shifts),
    'shift_swaps', (SELECT count(*) FROM public.shift_swaps),
    'time_off_requests', (SELECT count(*) FROM public.time_off_requests),
    'announcement_acknowledgments', (SELECT count(*) FROM public.announcement_acknowledgments),
    'brain_action_proposals', (SELECT count(*) FROM public.brain_action_proposals),
    'brain_domain_events', (SELECT count(*) FROM public.brain_domain_events),
    'brain_event_outbox', (SELECT count(*) FROM public.brain_event_outbox),
    'employee_status_counts', (
      SELECT coalesce(jsonb_object_agg(status_count.status, status_count.row_count ORDER BY status_count.status), '{}'::jsonb)
      FROM (
        SELECT coalesce(e.status, '__null__') AS status, count(*) AS row_count
        FROM public.employees AS e
        GROUP BY coalesce(e.status, '__null__')
      ) AS status_count
    ),
    'employment_type_counts', (
      SELECT coalesce(jsonb_object_agg(type_count.employment_type, type_count.row_count ORDER BY type_count.employment_type), '{}'::jsonb)
      FROM (
        SELECT coalesce(e.employment_type, '__null__') AS employment_type, count(*) AS row_count
        FROM public.employees AS e
        GROUP BY coalesce(e.employment_type, '__null__')
      ) AS type_count
    ),
    'duplicate_employee_links', (
      SELECT count(*)
      FROM (
        SELECT p.employee_id
        FROM public.profiles AS p
        WHERE p.employee_id IS NOT NULL
        GROUP BY p.employee_id
        HAVING count(*) > 1
      ) AS duplicate_link
    ),
    'profile_employee_tenant_mismatches', (
      SELECT count(*)
      FROM public.profiles AS p
      JOIN public.employees AS e ON e.id = p.employee_id
      WHERE p.company_id IS DISTINCT FROM e.company_id
    ),
    'migration_010_validated', true
  ) AS counts
)
INSERT INTO public.d1_employee_migration_checkpoints (
  migration_name,
  baseline_version,
  catalog_fingerprint,
  aggregate_counts,
  approval_reference
)
SELECT
  '202607210011_d1_employee_catalog_baseline',
  1,
  encode(extensions.digest(convert_to(catalog_evidence.evidence::text, 'UTF8'), 'sha256'), 'hex'),
  aggregate_evidence.counts,
  'D1_2E_FINAL_IMPLEMENTATION_SPECIFICATION.md (approved)'
FROM catalog_evidence
CROSS JOIN aggregate_evidence;

DO $d1_011_postcondition$
BEGIN
  IF (SELECT count(*) FROM public.d1_employee_migration_checkpoints) <> 1 THEN
    RAISE EXCEPTION 'D1_011_CHECKPOINT_CARDINALITY_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.d1_employee_migration_checkpoints AS c
    WHERE c.migration_name = '202607210011_d1_employee_catalog_baseline'
      AND c.baseline_version = 1
      AND c.catalog_fingerprint ~ '^[0-9a-f]{64}$'
      AND jsonb_typeof(c.aggregate_counts) = 'object'
      AND c.approval_reference = 'D1_2E_FINAL_IMPLEMENTATION_SPECIFICATION.md (approved)'
  ) THEN
    RAISE EXCEPTION 'D1_011_CHECKPOINT_POSTCONDITION_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'd1_employee_migration_checkpoints'
      AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'D1_011_CHECKPOINT_GRANT_POSTCONDITION_FAILED';
  END IF;
END
$d1_011_postcondition$;

COMMIT;

-- Post-deployment validation (read-only; run manually after application):
--
-- SELECT c.relrowsecurity AS rls_enabled,
--        c.relforcerowsecurity AS rls_forced,
--        pg_catalog.pg_get_userbyid(c.relowner) AS owner_name
-- FROM pg_catalog.pg_class AS c
-- WHERE c.oid = 'public.d1_employee_migration_checkpoints'::regclass;
--
-- SELECT g.grantee, g.privilege_type, g.is_grantable
-- FROM information_schema.role_table_grants AS g
-- WHERE g.table_schema = 'public'
--   AND g.table_name = 'd1_employee_migration_checkpoints'
-- ORDER BY g.grantee, g.privilege_type;
--
-- SELECT migration_name,
--        baseline_version,
--        catalog_fingerprint,
--        jsonb_typeof(aggregate_counts) AS aggregate_counts_type,
--        approval_reference,
--        recorded_at
-- FROM public.d1_employee_migration_checkpoints;
--
-- Required: enabled and forced RLS; no PUBLIC/anon/authenticated grant; exactly
-- one version-1 row; a 64-character lowercase SHA-256 fingerprint; sanitized
-- aggregate object; approved reference. Compare the fingerprint and aggregates
-- with the separately approved deployment-time read-only capture.
--
-- Safe rollback/recovery:
--   * any failed preflight, insert, or postcondition rolls back the transaction;
--   * after successful deployment, retain the accepted checkpoint as immutable
--     deployment evidence, stop before migration 012, and leave it unused if the
--     rollout is paused;
--   * do not rewrite/delete accepted evidence or fabricate historical migration
--     rows. A catalog mismatch requires a reviewed forward investigation.
