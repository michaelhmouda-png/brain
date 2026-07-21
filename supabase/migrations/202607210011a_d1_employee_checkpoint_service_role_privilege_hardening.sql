-- D1.2E migration 011a: complete checkpoint service_role hardening.
--
-- Approved minimum: SELECT and INSERT only. SELECT is required to verify
-- accepted checkpoints; INSERT is required to append future approved checkpoint
-- evidence. UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER are not approved.
--
-- This correction preserves the table and its accepted row. It validates the
-- stored migration-011 fingerprint against the live pre-correction catalog,
-- then changes grants only. Because table grants are intentionally included in
-- that fingerprint, the stored fingerprint remains immutable historical evidence
-- of the catalog accepted by migration 011 and is not rewritten after hardening.
--
-- Deployment prerequisites:
--   * migrations 010 and 011 are deployed and their validation evidence accepted;
--   * the target project and healthy backup/PITR point are confirmed;
--   * this migration is applied alone; migration 012 is not included.

BEGIN;

DO $d1_011a_harden_checkpoint_privileges$
DECLARE
  v_checkpoint_before jsonb;
  v_stored_fingerprint text;
  v_live_fingerprint text;
  v_anon_oid oid;
  v_authenticated_oid oid;
  v_command "char";
  v_k8_function regprocedure;
BEGIN
  IF to_regclass('public.d1_employee_migration_checkpoints') IS NULL THEN
    RAISE EXCEPTION 'D1_011A_CHECKPOINT_TABLE_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    WHERE c.oid = 'public.d1_employee_migration_checkpoints'::regclass
      AND c.relrowsecurity
      AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'D1_011A_CHECKPOINT_RLS_DRIFT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS p
    WHERE p.polrelid = 'public.d1_employee_migration_checkpoints'::regclass
  ) THEN
    RAISE EXCEPTION 'D1_011A_UNEXPECTED_CHECKPOINT_POLICY';
  END IF;

  IF (SELECT count(*) FROM public.d1_employee_migration_checkpoints) <> 1 THEN
    RAISE EXCEPTION 'D1_011A_ACCEPTED_CHECKPOINT_CARDINALITY_INVALID';
  END IF;

  SELECT to_jsonb(c), c.catalog_fingerprint
  INTO v_checkpoint_before, v_stored_fingerprint
  FROM public.d1_employee_migration_checkpoints AS c
  WHERE c.migration_name = '202607210011_d1_employee_catalog_baseline'
    AND c.baseline_version = 1
    AND c.catalog_fingerprint ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(c.aggregate_counts) = 'object'
    AND c.approval_reference = 'D1_2E_FINAL_IMPLEMENTATION_SPECIFICATION.md (approved)';

  IF v_checkpoint_before IS NULL THEN
    RAISE EXCEPTION 'D1_011A_ACCEPTED_CHECKPOINT_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'd1_employee_migration_checkpoints'
      AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'D1_011A_UNEXPECTED_ORDINARY_ROLE_GRANT';
  END IF;

  SELECT r.oid INTO v_anon_oid
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'anon';

  SELECT r.oid INTO v_authenticated_oid
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'authenticated';

  IF v_anon_oid IS NULL OR v_authenticated_oid IS NULL THEN
    RAISE EXCEPTION 'D1_011A_REQUIRED_SUPABASE_ROLES_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    WHERE c.oid = 'public.companies'::regclass
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'D1_011A_COMPANIES_RLS_NOT_ENABLED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'companies'
      AND g.grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'D1_011A_MIGRATION_010_ANON_GRANT_REGRESSION';
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
    RAISE EXCEPTION 'D1_011A_MIGRATION_010_POLICY_REGRESSION';
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
      RAISE EXCEPTION 'D1_011A_AUTHENTICATED_COMPANY_POLICY_MISSING: %', v_command;
    END IF;
  END LOOP;

  v_k8_function := to_regprocedure(
    'public.create_task_with_outbox_event(uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,uuid,text,integer,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz)'
  );

  IF v_k8_function IS NULL THEN
    RAISE EXCEPTION 'D1_011A_K8_CREATE_TASK_RPC_MISSING_OR_CHANGED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_k8_function
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'D1_011A_K8_CREATE_TASK_RPC_SECURITY_DRIFT';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role', v_k8_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', v_k8_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_k8_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'D1_011A_K8_CREATE_TASK_RPC_GRANT_DRIFT';
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
    RAISE EXCEPTION 'D1_011A_KERNEL_RLS_SECURITY_DRIFT';
  END IF;

  WITH catalog_evidence AS (
    SELECT jsonb_build_object(
      'relations', (
        SELECT coalesce(jsonb_agg(to_jsonb(relation_row) ORDER BY relation_row.schema_name, relation_row.relation_name), '[]'::jsonb)
        FROM (
          SELECT n.nspname AS schema_name, c.relname AS relation_name,
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
          SELECT n.nspname AS schema_name, c.relname AS relation_name,
            a.attnum AS ordinal_position, a.attname AS column_name,
            pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
            a.attnotnull AS not_null,
            pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS default_expression
          FROM pg_catalog.pg_attribute AS a
          JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
          JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
          LEFT JOIN pg_catalog.pg_attrdef AS ad
            ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
          WHERE a.attnum > 0 AND NOT a.attisdropped
            AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users'))
        ) AS column_row
      ),
      'constraints', (
        SELECT coalesce(jsonb_agg(to_jsonb(constraint_row) ORDER BY constraint_row.schema_name, constraint_row.relation_name, constraint_row.constraint_name), '[]'::jsonb)
        FROM (
          SELECT n.nspname AS schema_name, c.relname AS relation_name,
            con.conname AS constraint_name, con.contype::text AS constraint_type,
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
          SELECT ns.nspname AS schema_name, tbl.relname AS relation_name,
            idx.relname AS index_name, i.indisunique AS is_unique,
            i.indisprimary AS is_primary, i.indisvalid AS is_valid,
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
          SELECT n.nspname AS schema_name, c.relname AS relation_name,
            p.polname AS policy_name, p.polcmd::text AS command,
            p.polpermissive AS permissive,
            ARRAY(
              SELECT CASE WHEN role_oid = 0::oid THEN 'public'
                ELSE pg_catalog.pg_get_userbyid(role_oid) END
              FROM unnest(p.polroles) AS policy_role(role_oid) ORDER BY 1
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
          SELECT g.table_schema, g.table_name, g.grantee,
            g.privilege_type, g.is_grantable
          FROM information_schema.role_table_grants AS g
          WHERE g.table_schema = 'public'
        ) AS grant_row
      ),
      'functions', (
        SELECT coalesce(jsonb_agg(to_jsonb(function_row) ORDER BY function_row.schema_name, function_row.function_name, function_row.identity_arguments), '[]'::jsonb)
        FROM (
          SELECT n.nspname AS schema_name, p.proname AS function_name,
            pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
            pg_catalog.pg_get_function_result(p.oid) AS result_type,
            p.prosecdef AS security_definer, p.provolatile::text AS volatility,
            p.proconfig AS function_config
          FROM pg_catalog.pg_proc AS p
          JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
          WHERE n.nspname IN ('public', 'private')
        ) AS function_row
      ),
      'routine_grants', (
        SELECT coalesce(jsonb_agg(to_jsonb(routine_grant_row) ORDER BY routine_grant_row.routine_schema, routine_grant_row.routine_name, routine_grant_row.grantee, routine_grant_row.privilege_type), '[]'::jsonb)
        FROM (
          SELECT g.routine_schema, g.routine_name, g.grantee,
            g.privilege_type, g.is_grantable
          FROM information_schema.routine_privileges AS g
          WHERE g.routine_schema IN ('public', 'private')
        ) AS routine_grant_row
      )
    ) AS evidence
  )
  SELECT encode(
    extensions.digest(convert_to(ce.evidence::text, 'UTF8'), 'sha256'),
    'hex'
  )
  INTO v_live_fingerprint
  FROM catalog_evidence AS ce;

  IF v_live_fingerprint IS DISTINCT FROM v_stored_fingerprint THEN
    RAISE EXCEPTION 'D1_011A_STORED_FINGERPRINT_NO_LONGER_MATCHES_LIVE_CATALOG';
  END IF;

  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.d1_employee_migration_checkpoints FROM service_role';
  EXECUTE 'GRANT SELECT, INSERT ON TABLE public.d1_employee_migration_checkpoints TO service_role';

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'd1_employee_migration_checkpoints'
      AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'D1_011A_ORDINARY_ROLE_GRANT_POSTCONDITION_FAILED';
  END IF;

  IF (
    SELECT count(*)
    FROM information_schema.role_table_grants AS g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'd1_employee_migration_checkpoints'
      AND g.grantee = 'service_role'
  ) <> 2
  OR NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants AS g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'd1_employee_migration_checkpoints'
      AND g.grantee = 'service_role' AND g.privilege_type = 'SELECT'
  )
  OR NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants AS g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'd1_employee_migration_checkpoints'
      AND g.grantee = 'service_role' AND g.privilege_type = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'D1_011A_SERVICE_ROLE_MINIMUM_GRANT_POSTCONDITION_FAILED';
  END IF;

  IF (
    SELECT to_jsonb(c)
    FROM public.d1_employee_migration_checkpoints AS c
    WHERE c.migration_name = '202607210011_d1_employee_catalog_baseline'
  ) IS DISTINCT FROM v_checkpoint_before THEN
    RAISE EXCEPTION 'D1_011A_CHECKPOINT_ROW_CHANGED';
  END IF;
END
$d1_011a_harden_checkpoint_privileges$;

COMMIT;

-- Post-deployment verification (read-only):
-- SELECT jsonb_build_object(
--   'table_state', (SELECT to_jsonb(s) FROM (
--     SELECT c.relrowsecurity AS rls_enabled,
--            c.relforcerowsecurity AS rls_forced,
--            pg_catalog.pg_get_userbyid(c.relowner) AS owner_name
--     FROM pg_catalog.pg_class AS c
--     WHERE c.oid='public.d1_employee_migration_checkpoints'::regclass) AS s),
--   'grants', (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.grantee,g.privilege_type),'[]'::jsonb)
--     FROM (SELECT grantee,privilege_type,is_grantable
--       FROM information_schema.role_table_grants
--       WHERE table_schema='public' AND table_name='d1_employee_migration_checkpoints') AS g),
--   'checkpoint', (SELECT to_jsonb(c) FROM public.d1_employee_migration_checkpoints AS c)
-- );
--
-- Required: RLS enabled and forced; postgres owner may retain owner rights;
-- service_role has exactly SELECT and INSERT; PUBLIC/anon/authenticated have no
-- grants; no policies exist; exactly one accepted checkpoint row remains byte-
-- for-byte logically unchanged from the pre-deployment export.
--
-- Safe rollback/recovery:
--   * any failed guard/postcondition rolls back the entire transaction;
--   * after success, do not restore excess service_role privileges;
--   * if application behavior unexpectedly depends on broader checkpoint access,
--     stop before migration 012 and correct that caller forward. Never rewrite or
--     delete the accepted checkpoint and never broaden ordinary-role access.
--
-- GO criteria: the preflight fingerprint matches; one accepted row exists; RLS
-- is enabled and forced; no checkpoint policies or ordinary-role grants exist;
-- migration 010 and K8 invariants pass; backup/PITR and target are confirmed.
-- Post-deployment, service_role must have exactly SELECT and INSERT, the exported
-- checkpoint row must be logically identical, and focused 010/011/K8 tests pass.
-- NO-GO: any failed/unknown guard, fingerprint or row mismatch, extra grant,
-- ordinary-role access, K8/010 drift, or inability to verify the preserved row.
