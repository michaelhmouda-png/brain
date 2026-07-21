-- D1.2A SINGLE READ-ONLY EVIDENCE EXPORT
-- Run this file as one selection in the confirmed Brain development project.
-- It returns one result set: section, evidence.
-- Every executable branch is a SELECT. No RPC is invoked.
-- Query 9.2 is represented as a recorded fact because the relation is confirmed absent (42P01).

WITH evidence AS (
  -- 01: Schemas and owners.
  SELECT '01_schemas'::text AS section, COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.schema_name), '[]'::jsonb) AS evidence
  FROM (
    SELECT n.nspname AS schema_name, pg_get_userbyid(n.nspowner) AS schema_owner
    FROM pg_catalog.pg_namespace AS n
    WHERE n.nspname IN ('public', 'auth', 'supabase_migrations')
  ) AS q

  UNION ALL

  -- 02: Tables/views, owners, and RLS state.
  SELECT '02_objects', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.schema_name, q.object_name), '[]'::jsonb)
  FROM (
    SELECT n.nspname AS schema_name, c.relname AS object_name,
      CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table' WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view' WHEN 'f' THEN 'foreign table' ELSE c.relkind::text END AS object_kind,
      pg_get_userbyid(c.relowner) AS object_owner, c.relpersistence AS persistence,
      c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'auth', 'supabase_migrations')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users')
        OR (n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations'))
  ) AS q

  UNION ALL

  -- 03: Columns, data types, defaults, nullability, identity, and generated state.
  SELECT '03_columns', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.table_schema, q.table_name, q.ordinal_position), '[]'::jsonb)
  FROM (
    SELECT c.table_schema, c.table_name, c.ordinal_position, c.column_name, c.data_type,
      c.udt_schema, c.udt_name, c.is_nullable, c.column_default, c.is_identity,
      c.identity_generation, c.is_generated, c.generation_expression
    FROM information_schema.columns AS c
    WHERE c.table_schema IN ('public', 'auth', 'supabase_migrations')
      AND (c.table_schema = 'public' OR (c.table_schema = 'auth' AND c.table_name = 'users')
        OR (c.table_schema = 'supabase_migrations' AND c.table_name = 'schema_migrations'))
  ) AS q

  UNION ALL

  -- 04: Primary keys, unique constraints, checks, and exclusions.
  SELECT '04_constraints', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.schema_name, q.table_name, q.constraint_name), '[]'::jsonb)
  FROM (
    SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name,
      CASE con.contype WHEN 'p' THEN 'primary key' WHEN 'u' THEN 'unique' WHEN 'c' THEN 'check'
        WHEN 'x' THEN 'exclusion' ELSE con.contype::text END AS constraint_type,
      con.convalidated AS is_validated, pg_get_constraintdef(con.oid, true) AS constraint_definition
    FROM pg_catalog.pg_constraint AS con
    JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND con.contype IN ('p', 'u', 'c', 'x')
  ) AS q

  UNION ALL

  -- 05: Foreign keys and delete/update behavior.
  SELECT '05_foreign_keys', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.source_schema, q.source_table, q.constraint_name), '[]'::jsonb)
  FROM (
    SELECT src_ns.nspname AS source_schema, src.relname AS source_table, con.conname AS constraint_name,
      dst_ns.nspname AS target_schema, dst.relname AS target_table,
      CASE con.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_update,
      CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete,
      con.condeferrable AS is_deferrable, con.condeferred AS initially_deferred,
      con.convalidated AS is_validated, pg_get_constraintdef(con.oid, true) AS constraint_definition
    FROM pg_catalog.pg_constraint AS con
    JOIN pg_catalog.pg_class AS src ON src.oid = con.conrelid
    JOIN pg_catalog.pg_namespace AS src_ns ON src_ns.oid = src.relnamespace
    JOIN pg_catalog.pg_class AS dst ON dst.oid = con.confrelid
    JOIN pg_catalog.pg_namespace AS dst_ns ON dst_ns.oid = dst.relnamespace
    WHERE con.contype = 'f' AND (src_ns.nspname = 'public' OR dst_ns.nspname = 'public')
  ) AS q

  UNION ALL

  -- 06: Indexes.
  SELECT '06_indexes', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.schema_name, q.table_name, q.index_name), '[]'::jsonb)
  FROM (
    SELECT ns.nspname AS schema_name, tbl.relname AS table_name, idx_class.relname AS index_name,
      idx.indisprimary AS is_primary, idx.indisunique AS is_unique, idx.indisvalid AS is_valid,
      idx.indisready AS is_ready, pg_get_indexdef(idx_class.oid) AS index_definition
    FROM pg_catalog.pg_index AS idx
    JOIN pg_catalog.pg_class AS tbl ON tbl.oid = idx.indrelid
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = tbl.relnamespace
    JOIN pg_catalog.pg_class AS idx_class ON idx_class.oid = idx.indexrelid
    WHERE ns.nspname = 'public'
  ) AS q

  UNION ALL

  -- 07: Non-internal triggers.
  SELECT '07_triggers', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.schema_name, q.table_name, q.trigger_name), '[]'::jsonb)
  FROM (
    SELECT n.nspname AS schema_name, c.relname AS table_name, t.tgname AS trigger_name,
      t.tgenabled AS enabled_state, pg_get_triggerdef(t.oid, true) AS trigger_definition
    FROM pg_catalog.pg_trigger AS t
    JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
  ) AS q

  UNION ALL

  -- 08: RLS policies, including enabled/forced state.
  SELECT '08_rls_policies', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.table_name, q.policy_name), '[]'::jsonb)
  FROM (
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
      p.policyname AS policy_name, p.permissive, p.roles, p.cmd AS command,
      p.qual AS using_expression, p.with_check AS with_check_expression
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_policies AS p ON p.schemaname = n.nspname AND p.tablename = c.relname
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ) AS q

  UNION ALL

  -- 09: Table/view grants.
  SELECT '09_table_grants', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.table_name, q.grantee, q.privilege_type), '[]'::jsonb)
  FROM (
    SELECT g.table_schema, g.table_name, g.grantee, g.privilege_type, g.is_grantable
    FROM information_schema.role_table_grants AS g
    WHERE g.table_schema = 'public'
  ) AS q

  UNION ALL

  -- 10: Relevant function signatures and security configuration; no function bodies.
  SELECT '10_functions', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.function_schema, q.function_name, q.identity_arguments), '[]'::jsonb)
  FROM (
    SELECT n.nspname AS function_schema, p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments,
      pg_get_function_result(p.oid) AS result_type, l.lanname AS language,
      CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_mode,
      p.provolatile AS volatility, p.proparallel AS parallel_safety,
      (SELECT setting FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS setting
        WHERE setting LIKE 'search_path=%' LIMIT 1) AS configured_search_path
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    WHERE n.nspname IN ('public', 'private') AND (
      p.proname ILIKE '%employee%' OR p.proname ILIKE '%profile%' OR p.proname ILIKE '%shift%'
      OR p.proname ILIKE '%attendance%' OR p.proname ILIKE '%leave%' OR p.proname ILIKE '%tenant%'
      OR p.proname ILIKE '%company%' OR p.proname ILIKE '%proposal%' OR p.proname ILIKE '%task%'
      OR p.proname ILIKE '%event%' OR p.proname ILIKE '%outbox%')
  ) AS q

  UNION ALL

  -- 11: Relevant function grants.
  SELECT '11_function_grants', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.routine_schema, q.routine_name, q.specific_name, q.grantee), '[]'::jsonb)
  FROM (
    SELECT g.routine_schema, g.routine_name, g.specific_name, g.grantee, g.privilege_type, g.is_grantable
    FROM information_schema.role_routine_grants AS g
    WHERE g.routine_schema IN ('public', 'private') AND (
      g.routine_name ILIKE '%employee%' OR g.routine_name ILIKE '%profile%' OR g.routine_name ILIKE '%shift%'
      OR g.routine_name ILIKE '%attendance%' OR g.routine_name ILIKE '%leave%' OR g.routine_name ILIKE '%tenant%'
      OR g.routine_name ILIKE '%company%' OR g.routine_name ILIKE '%proposal%' OR g.routine_name ILIKE '%task%'
      OR g.routine_name ILIKE '%event%' OR g.routine_name ILIKE '%outbox%')
  ) AS q

  UNION ALL

  -- 12: Migration-history finding already established by read-only Query 9.2.
  SELECT '12_migration_history', jsonb_build_object(
    'expected_relation', 'supabase_migrations.schema_migrations',
    'exists', false,
    'query_9_2_error_code', '42P01',
    'sanitized_message', 'relation does not exist',
    'repository_live_parity_verifiable_from_relation', false
  )

  UNION ALL

  -- 13: Safe auth structure and aggregate linkage totals.
  SELECT '13_auth_and_profile_totals', jsonb_build_object(
    'auth_users_columns', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.ordinal_position), '[]'::jsonb)
      FROM (SELECT ordinal_position, column_name, data_type, is_nullable, is_identity, is_generated
        FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users') AS c),
    'auth_user_count', (SELECT count(*) FROM auth.users),
    'profile_count', (SELECT count(*) FROM public.profiles),
    'profiles_with_employee_count', (SELECT count(*) FROM public.profiles WHERE employee_id IS NOT NULL),
    'profiles_without_employee_count', (SELECT count(*) FROM public.profiles WHERE employee_id IS NULL)
  )

  UNION ALL

  -- 14: Employee data-quality aggregate totals.
  SELECT '14_employee_quality', to_jsonb(q)
  FROM (
    SELECT count(*) AS employee_count,
      count(*) FILTER (WHERE company_id IS NULL) AS missing_company_count,
      count(*) FILTER (WHERE location_id IS NULL) AS missing_location_count,
      count(*) FILTER (WHERE department_id IS NULL) AS missing_department_count,
      count(*) FILTER (WHERE hire_date IS NULL) AS missing_hire_date_count,
      count(*) FILTER (WHERE phone IS NULL OR btrim(phone) = '') AS missing_phone_count,
      count(*) FILTER (WHERE email IS NULL OR btrim(email) = '') AS missing_email_count,
      count(*) FILTER (WHERE salary IS NULL) AS missing_salary_count,
      count(*) FILTER (WHERE first_name IS NULL OR btrim(first_name) = '') AS missing_first_name_count,
      count(*) FILTER (WHERE last_name IS NULL OR btrim(last_name) = '') AS missing_last_name_count
    FROM public.employees
  ) AS q

  UNION ALL

  -- 15: Employee counts by redacted tenant bucket.
  SELECT '15_employee_tenant_buckets', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.redacted_tenant_bucket), '[]'::jsonb)
  FROM (
    SELECT row_number() OVER (ORDER BY company_id NULLS LAST) AS redacted_tenant_bucket,
      count(*) AS employee_count, company_id IS NULL AS is_missing_tenant
    FROM public.employees GROUP BY company_id
  ) AS q

  UNION ALL

  -- 16: Employee and profile vocabularies. Values are grouped only.
  SELECT '16_vocabularies', jsonb_build_object(
    'employee_status', (SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.employee_count DESC, q.value), '[]'::jsonb)
      FROM (SELECT COALESCE(NULLIF(btrim(status), ''), '[null-or-empty]') AS value, count(*) AS employee_count
        FROM public.employees GROUP BY 1) AS q),
    'employment_type', (SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.employee_count DESC, q.value), '[]'::jsonb)
      FROM (SELECT COALESCE(NULLIF(btrim(employment_type), ''), '[null-or-empty]') AS value, count(*) AS employee_count
        FROM public.employees GROUP BY 1) AS q),
    'legacy_employee_role', (SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.employee_count DESC, q.value), '[]'::jsonb)
      FROM (SELECT COALESCE(NULLIF(btrim(role), ''), '[null-or-empty]') AS value, count(*) AS employee_count
        FROM public.employees GROUP BY 1) AS q),
    'profile_authorization_role', (SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.profile_count DESC, q.value), '[]'::jsonb)
      FROM (SELECT COALESCE(NULLIF(btrim(role), ''), '[null-or-empty]') AS value, count(*) AS profile_count
        FROM public.profiles GROUP BY 1) AS q),
    'profile_status', (SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.profile_count DESC, q.value), '[]'::jsonb)
      FROM (SELECT COALESCE(NULLIF(btrim(status), ''), '[null-or-empty]') AS value, count(*) AS profile_count
        FROM public.profiles GROUP BY 1) AS q)
  )

  UNION ALL

  -- 17: Duplicate-name summary; no names are returned.
  SELECT '17_duplicate_employee_names', to_jsonb(q)
  FROM (
    WITH groups AS (
      SELECT count(*) AS group_size FROM public.employees
      GROUP BY company_id, lower(btrim(first_name)), lower(btrim(last_name)) HAVING count(*) > 1
    )
    SELECT count(*) AS duplicate_name_group_count,
      COALESCE(sum(group_size), 0) AS employee_rows_in_duplicate_name_groups FROM groups
  ) AS q

  UNION ALL

  -- 18: Profile-to-employee linkage integrity.
  SELECT '18_profile_employee_integrity', jsonb_build_object(
    'summary', (SELECT to_jsonb(q) FROM (
      SELECT count(*) FILTER (WHERE p.employee_id IS NOT NULL) AS linked_profile_count,
        count(*) FILTER (WHERE p.employee_id IS NULL) AS unlinked_profile_count,
        count(*) FILTER (WHERE p.employee_id IS NOT NULL AND e.id IS NULL) AS nonexistent_employee_link_count,
        count(*) FILTER (WHERE p.employee_id IS NOT NULL AND e.id IS NOT NULL
          AND p.company_id IS DISTINCT FROM e.company_id) AS tenant_mismatch_count,
        count(*) FILTER (WHERE p.employee_id IS NOT NULL AND e.id IS NOT NULL
          AND p.status IN ('inactive', 'suspended') AND e.status = 'active') AS inactive_profile_active_employee_count
      FROM public.profiles AS p LEFT JOIN public.employees AS e ON e.id = p.employee_id
    ) AS q),
    'duplicate_links', (SELECT to_jsonb(q) FROM (
      WITH links AS (SELECT employee_id, count(*) AS profile_count FROM public.profiles
        WHERE employee_id IS NOT NULL GROUP BY employee_id HAVING count(*) > 1)
      SELECT count(*) AS employees_with_multiple_profiles,
        COALESCE(sum(profile_count), 0) AS profiles_in_duplicate_links FROM links
    ) AS q)
  )

  UNION ALL

  -- 19: Employee, department, and location tenant integrity.
  SELECT '19_organization_integrity', jsonb_build_object(
    'employees', (SELECT to_jsonb(q) FROM (
      SELECT count(*) FILTER (WHERE c.id IS NULL) AS invalid_company_reference_count,
        count(*) FILTER (WHERE e.department_id IS NOT NULL AND d.id IS NULL) AS invalid_department_reference_count,
        count(*) FILTER (WHERE e.location_id IS NOT NULL AND l.id IS NULL) AS invalid_location_reference_count,
        count(*) FILTER (WHERE d.id IS NOT NULL AND d.company_id IS DISTINCT FROM e.company_id) AS department_tenant_mismatch_count,
        count(*) FILTER (WHERE l.id IS NOT NULL AND l.company_id IS DISTINCT FROM e.company_id) AS location_tenant_mismatch_count
      FROM public.employees AS e LEFT JOIN public.companies AS c ON c.id = e.company_id
      LEFT JOIN public.departments AS d ON d.id = e.department_id LEFT JOIN public.locations AS l ON l.id = e.location_id
    ) AS q),
    'departments', (SELECT to_jsonb(q) FROM (
      SELECT count(*) FILTER (WHERE d.location_id IS NOT NULL AND l.id IS NULL) AS invalid_location_count,
        count(*) FILTER (WHERE l.id IS NOT NULL AND l.company_id IS DISTINCT FROM d.company_id) AS location_tenant_mismatch_count,
        count(*) FILTER (WHERE d.manager_employee_id IS NOT NULL AND e.id IS NULL) AS invalid_manager_count,
        count(*) FILTER (WHERE e.id IS NOT NULL AND e.company_id IS DISTINCT FROM d.company_id) AS manager_tenant_mismatch_count
      FROM public.departments AS d LEFT JOIN public.locations AS l ON l.id = d.location_id
      LEFT JOIN public.employees AS e ON e.id = d.manager_employee_id
    ) AS q),
    'duplicate_department_names', (SELECT to_jsonb(q) FROM (
      WITH groups AS (SELECT count(*) AS group_size FROM public.departments
        GROUP BY company_id, lower(btrim(name)) HAVING count(*) > 1)
      SELECT count(*) AS duplicate_group_count, COALESCE(sum(group_size), 0) AS affected_rows FROM groups
    ) AS q),
    'duplicate_location_names', (SELECT to_jsonb(q) FROM (
      WITH groups AS (SELECT count(*) AS group_size FROM public.locations
        GROUP BY company_id, lower(btrim(name)) HAVING count(*) > 1)
      SELECT count(*) AS duplicate_group_count, COALESCE(sum(group_size), 0) AS affected_rows FROM groups
    ) AS q)
  )

  UNION ALL

  -- 20: Shift, attendance, leave, swap, and task tenant integrity.
  -- Uses the confirmed live shift_swaps.requestor_id column.
  SELECT '20_operational_integrity', jsonb_build_object(
    'shifts', (SELECT to_jsonb(q) FROM (
      SELECT count(*) AS row_count,
        count(*) FILTER (WHERE s.employee_id IS NOT NULL AND e.id IS NULL) AS missing_employee_count,
        count(*) FILTER (WHERE e.id IS NOT NULL AND e.company_id IS DISTINCT FROM s.company_id) AS employee_tenant_mismatch_count,
        count(*) FILTER (WHERE s.department_id IS NOT NULL AND d.id IS NULL) AS missing_department_count,
        count(*) FILTER (WHERE d.id IS NOT NULL AND d.company_id IS DISTINCT FROM s.company_id) AS department_tenant_mismatch_count,
        count(*) FILTER (WHERE e.id IS NOT NULL AND e.status IS DISTINCT FROM 'active') AS rows_for_non_active_employees
      FROM public.shifts AS s LEFT JOIN public.employees AS e ON e.id = s.employee_id
      LEFT JOIN public.departments AS d ON d.id = s.department_id
    ) AS q),
    'attendance_records', (SELECT to_jsonb(q) FROM (
      SELECT count(*) AS row_count, count(*) FILTER (WHERE e.id IS NULL) AS missing_employee_count,
        count(*) FILTER (WHERE e.id IS NOT NULL AND e.company_id IS DISTINCT FROM a.company_id) AS tenant_mismatch_count,
        count(*) FILTER (WHERE a.location IS NULL OR btrim(a.location) = '') AS missing_free_text_location_count
      FROM public.attendance_records AS a LEFT JOIN public.employees AS e ON e.id = a.employee_id
    ) AS q),
    'time_off_requests', (SELECT to_jsonb(q) FROM (
      SELECT count(*) AS row_count, count(*) FILTER (WHERE e.id IS NULL) AS missing_employee_count,
        count(*) FILTER (WHERE e.id IS NOT NULL AND e.company_id IS DISTINCT FROM r.company_id) AS tenant_mismatch_count,
        count(*) FILTER (WHERE e.id IS NOT NULL AND e.status IS DISTINCT FROM 'active') AS rows_for_non_active_employees
      FROM public.time_off_requests AS r LEFT JOIN public.employees AS e ON e.id = r.employee_id
    ) AS q),
    'shift_swaps', (SELECT to_jsonb(q) FROM (
      SELECT count(*) AS row_count, count(*) FILTER (WHERE requester.id IS NULL) AS missing_requestor_count,
        count(*) FILTER (WHERE target.id IS NULL) AS missing_target_count,
        count(*) FILTER (WHERE requester.id IS NOT NULL AND requester.company_id IS DISTINCT FROM sw.company_id) AS requestor_tenant_mismatch_count,
        count(*) FILTER (WHERE target.id IS NOT NULL AND target.company_id IS DISTINCT FROM sw.company_id) AS target_tenant_mismatch_count
      FROM public.shift_swaps AS sw LEFT JOIN public.employees AS requester ON requester.id = sw.requestor_id
      LEFT JOIN public.employees AS target ON target.id = sw.target_employee_id
    ) AS q),
    'tasks', (SELECT to_jsonb(q) FROM (
      SELECT count(*) AS row_count,
        count(*) FILTER (WHERE t.assigned_employee_id IS NOT NULL AND e.id IS NULL) AS missing_assignee_count,
        count(*) FILTER (WHERE e.id IS NOT NULL AND e.company_id IS DISTINCT FROM t.company_id) AS tenant_mismatch_count
      FROM public.tasks AS t LEFT JOIN public.employees AS e ON e.id = t.assigned_employee_id
    ) AS q)
  )

  UNION ALL

  -- 21: Employee deletion dependencies and actions.
  SELECT '21_employee_delete_dependencies', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.source_schema, q.source_table, q.foreign_key_name), '[]'::jsonb)
  FROM (
    SELECT src_ns.nspname AS source_schema, src.relname AS source_table, con.conname AS foreign_key_name,
      CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_employee_delete,
      src.reltuples::bigint AS estimated_source_rows, pg_get_constraintdef(con.oid, true) AS constraint_definition
    FROM pg_catalog.pg_constraint AS con
    JOIN pg_catalog.pg_class AS src ON src.oid = con.conrelid
    JOIN pg_catalog.pg_namespace AS src_ns ON src_ns.oid = src.relnamespace
    JOIN pg_catalog.pg_class AS target ON target.oid = con.confrelid
    JOIN pg_catalog.pg_namespace AS target_ns ON target_ns.oid = target.relnamespace
    WHERE con.contype = 'f' AND target_ns.nspname = 'public' AND target.relname = 'employees'
  ) AS q

  UNION ALL

  -- 22: Exact aggregate reference counts for known employee dependencies.
  SELECT '22_employee_reference_counts', jsonb_agg(to_jsonb(q) ORDER BY q.relationship)
  FROM (
    SELECT 'profiles.employee_id' AS relationship, count(*) AS referencing_row_count FROM public.profiles WHERE employee_id IS NOT NULL
    UNION ALL SELECT 'departments.manager_employee_id', count(*) FROM public.departments WHERE manager_employee_id IS NOT NULL
    UNION ALL SELECT 'shifts.employee_id', count(*) FROM public.shifts WHERE employee_id IS NOT NULL
    UNION ALL SELECT 'attendance_records.employee_id', count(*) FROM public.attendance_records WHERE employee_id IS NOT NULL
    UNION ALL SELECT 'time_off_requests.employee_id', count(*) FROM public.time_off_requests WHERE employee_id IS NOT NULL
    UNION ALL SELECT 'shift_swaps.requestor_id', count(*) FROM public.shift_swaps WHERE requestor_id IS NOT NULL
    UNION ALL SELECT 'shift_swaps.target_employee_id', count(*) FROM public.shift_swaps WHERE target_employee_id IS NOT NULL
    UNION ALL SELECT 'tasks.assigned_employee_id', count(*) FROM public.tasks WHERE assigned_employee_id IS NOT NULL
  ) AS q

  UNION ALL

  -- 23: Candidate workforce/scheduling objects, including undocumented live objects.
  SELECT '23_workforce_objects', COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.schema_name, q.object_name), '[]'::jsonb)
  FROM (
    SELECT n.nspname AS schema_name, c.relname AS object_name,
      CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table'
        WHEN 'v' THEN 'view' ELSE c.relkind::text END AS object_kind
    FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v') AND (
      c.relname ILIKE '%employee%' OR c.relname ILIKE '%profile%' OR c.relname ILIKE '%shift%'
      OR c.relname ILIKE '%schedule%' OR c.relname ILIKE '%attendance%' OR c.relname ILIKE '%clock%'
      OR c.relname ILIKE '%leave%' OR c.relname ILIKE '%time_off%' OR c.relname ILIKE '%role%'
      OR c.relname ILIKE '%permission%' OR c.relname ILIKE '%skill%' OR c.relname ILIKE '%certification%'
      OR c.relname ILIKE '%position%')
  ) AS q
)
SELECT section, evidence
FROM evidence
ORDER BY section;
