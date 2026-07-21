-- D1.2E migration 010: close unconditional anonymous CRUD on public.companies.
--
-- Scope:
--   * remove only policies that both apply to anon and unconditionally allow
--     SELECT, INSERT, UPDATE, or DELETE;
--   * revoke existing table privileges from anon;
--   * preserve every conditional/authenticated policy and every authenticated
--     grant exactly as deployed.
--
-- Preflight assumptions (the transaction fails closed if any differ):
--   * public.companies exists and has RLS enabled;
--   * exactly one unconditional anon-applicable policy exists for each CRUD
--     command (the policy names are deliberately not assumed);
--   * at least one non-unconditional authenticated-applicable policy remains
--     for each CRUD command.
--
-- Deployment prerequisite outside this migration:
--   signup/provisioning must be proven not to use anonymous direct company
--   CRUD. A legitimate provisioning dependency must be moved to a separately
--   reviewed authenticated/server boundary before this migration is applied.

BEGIN;

DO $d1_010_preflight_and_policy_closure$
DECLARE
  v_anon_oid oid;
  v_authenticated_oid oid;
  v_command "char";
  v_unsafe_count integer;
  v_safe_authenticated_count integer;
  v_policy record;
BEGIN
  SELECT r.oid INTO v_anon_oid
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'anon';

  SELECT r.oid INTO v_authenticated_oid
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'authenticated';

  IF v_anon_oid IS NULL OR v_authenticated_oid IS NULL THEN
    RAISE EXCEPTION 'D1_010_REQUIRED_SUPABASE_ROLES_MISSING';
  END IF;

  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'D1_010_COMPANIES_TABLE_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    WHERE c.oid = 'public.companies'::regclass
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'D1_010_COMPANIES_RLS_NOT_ENABLED';
  END IF;

  FOREACH v_command IN ARRAY ARRAY['r', 'a', 'w', 'd']::"char"[]
  LOOP
    SELECT count(*) INTO v_unsafe_count
    FROM pg_catalog.pg_policy AS p
    WHERE p.polrelid = 'public.companies'::regclass
      AND p.polcmd = v_command
      AND (0::oid = ANY (p.polroles) OR v_anon_oid = ANY (p.polroles))
      AND CASE v_command
        WHEN 'r' THEN lower(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid))) = 'true'
        WHEN 'a' THEN lower(btrim(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))) = 'true'
        WHEN 'w' THEN
          lower(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid))) = 'true'
          AND lower(btrim(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))) = 'true'
        WHEN 'd' THEN lower(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid))) = 'true'
        ELSE false
      END;

    IF v_unsafe_count <> 1 THEN
      RAISE EXCEPTION
        'D1_010_UNSAFE_ANON_POLICY_PREFLIGHT_FAILED: command %, expected 1, found %',
        v_command,
        v_unsafe_count;
    END IF;

    SELECT count(*) INTO v_safe_authenticated_count
    FROM pg_catalog.pg_policy AS p
    WHERE p.polrelid = 'public.companies'::regclass
      AND p.polcmd = v_command
      AND (0::oid = ANY (p.polroles) OR v_authenticated_oid = ANY (p.polroles))
      AND NOT CASE v_command
        WHEN 'r' THEN coalesce(lower(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid))) = 'true', false)
        WHEN 'a' THEN coalesce(lower(btrim(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))) = 'true', false)
        WHEN 'w' THEN
          coalesce(lower(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid))) = 'true', false)
          AND coalesce(lower(btrim(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))) = 'true', false)
        WHEN 'd' THEN coalesce(lower(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid))) = 'true', false)
        ELSE true
      END;

    IF v_safe_authenticated_count < 1 THEN
      RAISE EXCEPTION
        'D1_010_AUTHENTICATED_POLICY_PREFLIGHT_FAILED: command % has no conditional policy',
        v_command;
    END IF;
  END LOOP;

  FOR v_policy IN
    SELECT p.polname
    FROM pg_catalog.pg_policy AS p
    WHERE p.polrelid = 'public.companies'::regclass
      AND (0::oid = ANY (p.polroles) OR v_anon_oid = ANY (p.polroles))
      AND CASE p.polcmd
        WHEN 'r' THEN lower(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid))) = 'true'
        WHEN 'a' THEN lower(btrim(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))) = 'true'
        WHEN 'w' THEN
          lower(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid))) = 'true'
          AND lower(btrim(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))) = 'true'
        WHEN 'd' THEN lower(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid))) = 'true'
        ELSE false
      END
  LOOP
    EXECUTE format('DROP POLICY %I ON public.companies', v_policy.polname);
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS p
    WHERE p.polrelid = 'public.companies'::regclass
      AND (0::oid = ANY (p.polroles) OR v_anon_oid = ANY (p.polroles))
      AND CASE p.polcmd
        WHEN 'r' THEN lower(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid))) = 'true'
        WHEN 'a' THEN lower(btrim(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))) = 'true'
        WHEN 'w' THEN
          lower(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid))) = 'true'
          AND lower(btrim(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))) = 'true'
        WHEN 'd' THEN lower(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid))) = 'true'
        ELSE false
      END
  ) THEN
    RAISE EXCEPTION 'D1_010_UNSAFE_ANON_POLICY_REMAINS';
  END IF;
END
$d1_010_preflight_and_policy_closure$;

REVOKE ALL PRIVILEGES ON TABLE public.companies FROM anon;

COMMIT;

-- Post-deployment validation (read-only; run manually after applying):
--
-- 1. Inspect all remaining policies and their commands, roles, USING clauses,
--    and WITH CHECK clauses:
--
-- SELECT p.polname AS policy_name,
--        p.polcmd AS command,
--        p.polroles::regrole[] AS roles,
--        pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS using_expression,
--        pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
-- FROM pg_catalog.pg_policy AS p
-- WHERE p.polrelid = 'public.companies'::regclass
-- ORDER BY p.polcmd, p.polname;
--
-- There must be no policy applicable to anon/PUBLIC that unconditionally
-- permits a CRUD command. Conditional authenticated policies must remain.
--
-- 2. Inspect table grants:
--
-- SELECT g.grantee, g.privilege_type
-- FROM information_schema.role_table_grants AS g
-- WHERE g.table_schema = 'public'
--   AND g.table_name = 'companies'
-- ORDER BY g.grantee, g.privilege_type;
--
-- The result must contain zero rows for grantee anon. Compare authenticated
-- rows with the approved preflight capture; they must be unchanged.
-- 3. With isolated anon and authenticated test clients, prove anon SELECT,
--    INSERT, UPDATE, and DELETE are denied; an active authenticated profile can
--    read only its persisted company; privileged mutations retain their existing
--    policy behavior; and another tenant's company remains invisible.
-- 4. Re-run the focused K8 create_task/task-outbox regression and compare the
--    K8 RPC signature, grants, result, and event behavior with the baseline.
--
-- Safe rollback/recovery:
--   * Before COMMIT, PostgreSQL rolls the entire migration back on any failed
--     preflight or statement, leaving policies and grants unchanged.
--   * After COMMIT, do not restore unconditional anonymous policies or anon
--     privileges. If a legitimate authenticated operation fails, retain this
--     security closure and deploy a separately reviewed narrow authenticated or
--     server-side correction. This migration does not revoke or change any
--     authenticated grant, so no authenticated grant restoration is expected.
