-- D1.2A READ-ONLY EXPORT QUERIES
-- Documentation only. Do not run the entire file at once.
-- Every executable statement in this file is a SELECT (optionally using a WITH CTE).
-- Run one numbered query at a time in the confirmed Brain development project.

-- SECTION 1 / QUERY 1.1: Relevant schemas.
-- Returns schema names and owners only; no application row data.
SELECT
  n.nspname AS schema_name,
  pg_get_userbyid(n.nspowner) AS schema_owner
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname IN ('public', 'auth', 'supabase_migrations')
ORDER BY n.nspname;

-- SECTION 1 / QUERY 1.2: Relevant live tables and views.
-- Returns object kind, owner, persistence, RLS state, and forced-RLS state.
SELECT
  n.nspname AS schema_name,
  c.relname AS object_name,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'partitioned table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized view'
    WHEN 'f' THEN 'foreign table'
    ELSE c.relkind::text
  END AS object_kind,
  pg_get_userbyid(c.relowner) AS object_owner,
  c.relpersistence AS persistence,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'auth', 'supabase_migrations')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND (
    n.nspname = 'public'
    OR (n.nspname = 'auth' AND c.relname = 'users')
    OR (n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations')
  )
ORDER BY n.nspname, c.relname;

-- SECTION 2 / QUERY 2.1: Columns, types, nullability, defaults, identity, and generation.
-- Returns structural column metadata. It does not read table rows.
SELECT
  c.table_schema,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_schema,
  c.udt_name,
  c.is_nullable,
  c.column_default,
  c.is_identity,
  c.identity_generation,
  c.is_generated,
  c.generation_expression
FROM information_schema.columns AS c
WHERE c.table_schema IN ('public', 'auth', 'supabase_migrations')
  AND (
    c.table_schema = 'public'
    OR (c.table_schema = 'auth' AND c.table_name = 'users')
    OR (c.table_schema = 'supabase_migrations' AND c.table_name = 'schema_migrations')
  )
ORDER BY c.table_schema, c.table_name, c.ordinal_position;

-- SECTION 3 / QUERY 3.1: Primary keys, unique constraints, and check constraints.
-- Returns constraint names, types, validation state, and definitions.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  con.conname AS constraint_name,
  CASE con.contype
    WHEN 'p' THEN 'primary key'
    WHEN 'u' THEN 'unique'
    WHEN 'c' THEN 'check'
    WHEN 'x' THEN 'exclusion'
    ELSE con.contype::text
  END AS constraint_type,
  con.convalidated AS is_validated,
  pg_get_constraintdef(con.oid, true) AS constraint_definition
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND con.contype IN ('p', 'u', 'c', 'x')
ORDER BY n.nspname, c.relname, constraint_type, con.conname;

-- SECTION 3 / QUERY 3.2: Foreign keys and delete/update behavior.
-- Returns both sides of each foreign key and the PostgreSQL referential actions.
SELECT
  src_ns.nspname AS source_schema,
  src.relname AS source_table,
  con.conname AS constraint_name,
  dst_ns.nspname AS target_schema,
  dst.relname AS target_table,
  CASE con.confupdtype
    WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT'
  END AS on_update,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT'
  END AS on_delete,
  con.condeferrable AS is_deferrable,
  con.condeferred AS initially_deferred,
  con.convalidated AS is_validated,
  pg_get_constraintdef(con.oid, true) AS constraint_definition
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS src ON src.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS src_ns ON src_ns.oid = src.relnamespace
JOIN pg_catalog.pg_class AS dst ON dst.oid = con.confrelid
JOIN pg_catalog.pg_namespace AS dst_ns ON dst_ns.oid = dst.relnamespace
WHERE con.contype = 'f'
  AND (src_ns.nspname = 'public' OR dst_ns.nspname = 'public')
ORDER BY src_ns.nspname, src.relname, con.conname;

-- SECTION 4 / QUERY 4.1: Indexes.
-- Returns index definitions and validity without reading indexed data.
SELECT
  table_ns.nspname AS schema_name,
  table_class.relname AS table_name,
  index_class.relname AS index_name,
  idx.indisprimary AS is_primary,
  idx.indisunique AS is_unique,
  idx.indisvalid AS is_valid,
  idx.indisready AS is_ready,
  pg_get_indexdef(index_class.oid) AS index_definition
FROM pg_catalog.pg_index AS idx
JOIN pg_catalog.pg_class AS table_class ON table_class.oid = idx.indrelid
JOIN pg_catalog.pg_namespace AS table_ns ON table_ns.oid = table_class.relnamespace
JOIN pg_catalog.pg_class AS index_class ON index_class.oid = idx.indexrelid
WHERE table_ns.nspname = 'public'
ORDER BY table_ns.nspname, table_class.relname, index_class.relname;

-- SECTION 5 / QUERY 5.1: Non-internal triggers.
-- Returns trigger definitions and enabled state; it does not fire triggers.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled_state,
  pg_get_triggerdef(t.oid, true) AS trigger_definition
FROM pg_catalog.pg_trigger AS t
JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY n.nspname, c.relname, t.tgname;

-- SECTION 6 / QUERY 6.1: RLS state for public tables.
-- Returns whether RLS is enabled and forced for each table.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

-- SECTION 6 / QUERY 6.2: RLS policy definitions.
-- Returns roles, command scope, permissive/restrictive mode, USING, and WITH CHECK expressions.
SELECT
  p.schemaname AS schema_name,
  p.tablename AS table_name,
  p.policyname AS policy_name,
  p.permissive,
  p.roles,
  p.cmd AS command,
  p.qual AS using_expression,
  p.with_check AS with_check_expression
FROM pg_catalog.pg_policies AS p
WHERE p.schemaname = 'public'
ORDER BY p.tablename, p.policyname;

-- SECTION 7 / QUERY 7.1: Table and view grants.
-- Returns grantees and privileges only. It does not test or change access.
SELECT
  g.table_schema,
  g.table_name,
  g.grantee,
  g.privilege_type,
  g.is_grantable
FROM information_schema.role_table_grants AS g
WHERE g.table_schema = 'public'
ORDER BY g.table_name, g.grantee, g.privilege_type;

-- SECTION 8 / QUERY 8.1: Relevant function and RPC signatures and security attributes.
-- Returns function metadata, including definer/invoker state and configured search_path.
-- It intentionally does not return complete function bodies.
SELECT
  n.nspname AS function_schema,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_function_result(p.oid) AS result_type,
  l.lanname AS language,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_mode,
  p.provolatile AS volatility,
  p.proparallel AS parallel_safety,
  (
    SELECT setting
    FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS setting
    WHERE setting LIKE 'search_path=%'
    LIMIT 1
  ) AS configured_search_path
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
WHERE n.nspname IN ('public', 'private')
  AND (
    p.proname ILIKE '%employee%'
    OR p.proname ILIKE '%profile%'
    OR p.proname ILIKE '%shift%'
    OR p.proname ILIKE '%attendance%'
    OR p.proname ILIKE '%leave%'
    OR p.proname ILIKE '%tenant%'
    OR p.proname ILIKE '%company%'
    OR p.proname ILIKE '%proposal%'
    OR p.proname ILIKE '%task%'
    OR p.proname ILIKE '%event%'
    OR p.proname ILIKE '%outbox%'
  )
ORDER BY n.nspname, p.proname, identity_arguments;

-- SECTION 8 / QUERY 8.2: Relevant function grants.
-- Returns function privilege grants for the relevant schemas and names.
SELECT
  g.routine_schema,
  g.routine_name,
  g.specific_name,
  g.grantee,
  g.privilege_type,
  g.is_grantable
FROM information_schema.role_routine_grants AS g
WHERE g.routine_schema IN ('public', 'private')
  AND (
    g.routine_name ILIKE '%employee%'
    OR g.routine_name ILIKE '%profile%'
    OR g.routine_name ILIKE '%shift%'
    OR g.routine_name ILIKE '%attendance%'
    OR g.routine_name ILIKE '%leave%'
    OR g.routine_name ILIKE '%tenant%'
    OR g.routine_name ILIKE '%company%'
    OR g.routine_name ILIKE '%proposal%'
    OR g.routine_name ILIKE '%task%'
    OR g.routine_name ILIKE '%event%'
    OR g.routine_name ILIKE '%outbox%'
  )
ORDER BY g.routine_schema, g.routine_name, g.specific_name, g.grantee;

-- SECTION 8 / QUERY 8.3: Function-to-table dependencies visible in PostgreSQL catalogs.
-- Returns recorded dependencies; absence does not prove that dynamic SQL does not access a table.
SELECT DISTINCT
  fn_ns.nspname AS function_schema,
  fn.proname AS function_name,
  pg_get_function_identity_arguments(fn.oid) AS identity_arguments,
  dep_ns.nspname AS dependent_schema,
  dep.relname AS dependent_object
FROM pg_catalog.pg_proc AS fn
JOIN pg_catalog.pg_namespace AS fn_ns ON fn_ns.oid = fn.pronamespace
JOIN pg_catalog.pg_depend AS d ON d.objid = fn.oid
JOIN pg_catalog.pg_class AS dep ON dep.oid = d.refobjid
JOIN pg_catalog.pg_namespace AS dep_ns ON dep_ns.oid = dep.relnamespace
WHERE fn_ns.nspname IN ('public', 'private')
  AND dep_ns.nspname = 'public'
ORDER BY function_schema, function_name, identity_arguments, dependent_schema, dependent_object;

-- SECTION 9 / QUERY 9.1: Migration-history table structure.
-- Returns metadata for the migration-history table without migration SQL contents.
SELECT
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.is_nullable
FROM information_schema.columns AS c
WHERE c.table_schema = 'supabase_migrations'
  AND c.table_name = 'schema_migrations'
ORDER BY c.ordinal_position;

-- SECTION 9 / QUERY 9.2: Applied migration versions only.
-- Returns version identifiers; it intentionally excludes stored statements.
SELECT
  m.version
FROM supabase_migrations.schema_migrations AS m
ORDER BY m.version;

-- SECTION 10 / QUERY 10.1: Safe auth.users structural metadata.
-- Returns column definitions only, never auth user rows or metadata values.
SELECT
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.is_identity,
  c.is_generated
FROM information_schema.columns AS c
WHERE c.table_schema = 'auth'
  AND c.table_name = 'users'
ORDER BY c.ordinal_position;

-- SECTION 10 / QUERY 10.2: Safe aggregate auth/profile linkage totals.
-- Returns counts only. It does not select auth IDs, emails, phone numbers, or metadata.
SELECT
  (SELECT count(*) FROM auth.users) AS auth_user_count,
  (SELECT count(*) FROM public.profiles) AS profile_count,
  (SELECT count(*) FROM public.profiles WHERE employee_id IS NOT NULL) AS profiles_with_employee_count,
  (SELECT count(*) FROM public.profiles WHERE employee_id IS NULL) AS profiles_without_employee_count;

-- SECTION 11 / QUERY 11.1: Employee high-level counts and missing-field counts.
-- Returns aggregates only; no employee, company, contact, salary, or note values.
SELECT
  count(*) AS employee_count,
  count(*) FILTER (WHERE company_id IS NULL) AS missing_company_count,
  count(*) FILTER (WHERE location_id IS NULL) AS missing_location_count,
  count(*) FILTER (WHERE department_id IS NULL) AS missing_department_count,
  count(*) FILTER (WHERE hire_date IS NULL) AS missing_hire_date_count,
  count(*) FILTER (WHERE phone IS NULL OR btrim(phone) = '') AS missing_phone_count,
  count(*) FILTER (WHERE email IS NULL OR btrim(email) = '') AS missing_email_count,
  count(*) FILTER (WHERE salary IS NULL) AS missing_salary_count,
  count(*) FILTER (WHERE first_name IS NULL OR btrim(first_name) = '') AS missing_first_name_count,
  count(*) FILTER (WHERE last_name IS NULL OR btrim(last_name) = '') AS missing_last_name_count
FROM public.employees;

-- SECTION 11 / QUERY 11.2: Employee counts per redacted tenant bucket.
-- Returns a deterministic bucket number and count, never company IDs or names.
WITH tenant_counts AS (
  SELECT company_id, count(*) AS employee_count
  FROM public.employees
  GROUP BY company_id
)
SELECT
  row_number() OVER (ORDER BY company_id NULLS LAST) AS redacted_tenant_bucket,
  employee_count,
  company_id IS NULL AS is_missing_tenant
FROM tenant_counts
ORDER BY redacted_tenant_bucket;

-- SECTION 11 / QUERY 11.3: Employee lifecycle/status vocabulary.
-- Returns grouped vocabulary and counts only; no employee identifiers.
SELECT
  COALESCE(NULLIF(btrim(status), ''), '[null-or-empty]') AS status_value,
  count(*) AS employee_count
FROM public.employees
GROUP BY COALESCE(NULLIF(btrim(status), ''), '[null-or-empty]')
ORDER BY employee_count DESC, status_value;

-- SECTION 11 / QUERY 11.4: Employee employment-type vocabulary.
-- Returns grouped vocabulary and counts only.
SELECT
  COALESCE(NULLIF(btrim(employment_type), ''), '[null-or-empty]') AS employment_type_value,
  count(*) AS employee_count
FROM public.employees
GROUP BY COALESCE(NULLIF(btrim(employment_type), ''), '[null-or-empty]')
ORDER BY employee_count DESC, employment_type_value;

-- SECTION 11 / QUERY 11.5: Legacy employee role vocabulary.
-- Returns grouped role/job vocabulary and counts only; review rare values before sharing.
SELECT
  COALESCE(NULLIF(btrim(role), ''), '[null-or-empty]') AS legacy_role_value,
  count(*) AS employee_count
FROM public.employees
GROUP BY COALESCE(NULLIF(btrim(role), ''), '[null-or-empty]')
ORDER BY employee_count DESC, legacy_role_value;

-- SECTION 11 / QUERY 11.6: Duplicate-name aggregate summary.
-- Returns only the number of duplicate groups and affected rows, never names.
WITH duplicate_groups AS (
  SELECT count(*) AS group_size
  FROM public.employees
  GROUP BY company_id, lower(btrim(first_name)), lower(btrim(last_name))
  HAVING count(*) > 1
)
SELECT
  count(*) AS duplicate_name_group_count,
  COALESCE(sum(group_size), 0) AS employee_rows_in_duplicate_name_groups
FROM duplicate_groups;

-- SECTION 11 / QUERY 11.7: Profile authorization-role vocabulary.
-- Returns grouped authorization roles and counts only.
SELECT
  COALESCE(NULLIF(btrim(role), ''), '[null-or-empty]') AS authorization_role_value,
  count(*) AS profile_count
FROM public.profiles
GROUP BY COALESCE(NULLIF(btrim(role), ''), '[null-or-empty]')
ORDER BY profile_count DESC, authorization_role_value;

-- SECTION 11 / QUERY 11.8: Profile status vocabulary.
-- Returns grouped status values and counts only.
SELECT
  COALESCE(NULLIF(btrim(status), ''), '[null-or-empty]') AS profile_status_value,
  count(*) AS profile_count
FROM public.profiles
GROUP BY COALESCE(NULLIF(btrim(status), ''), '[null-or-empty]')
ORDER BY profile_count DESC, profile_status_value;

-- SECTION 12 / QUERY 12.1: Profile-to-employee linkage integrity counts.
-- Returns aggregate violations only; no profile or employee identifiers.
SELECT
  count(*) FILTER (WHERE p.employee_id IS NOT NULL) AS linked_profile_count,
  count(*) FILTER (WHERE p.employee_id IS NULL) AS unlinked_profile_count,
  count(*) FILTER (WHERE p.employee_id IS NOT NULL AND e.id IS NULL) AS nonexistent_employee_link_count,
  count(*) FILTER (
    WHERE p.employee_id IS NOT NULL
      AND e.id IS NOT NULL
      AND p.company_id IS DISTINCT FROM e.company_id
  ) AS profile_employee_tenant_mismatch_count,
  count(*) FILTER (
    WHERE p.employee_id IS NOT NULL
      AND e.id IS NOT NULL
      AND p.status IN ('inactive', 'suspended')
      AND e.status = 'active'
  ) AS inactive_profile_active_employee_count
FROM public.profiles AS p
LEFT JOIN public.employees AS e ON e.id = p.employee_id;

-- SECTION 12 / QUERY 12.2: Multiple profiles linked to one employee.
-- Returns only the number of affected employees and linked profile rows.
WITH duplicate_links AS (
  SELECT employee_id, count(*) AS profile_count
  FROM public.profiles
  WHERE employee_id IS NOT NULL
  GROUP BY employee_id
  HAVING count(*) > 1
)
SELECT
  count(*) AS employees_with_multiple_profiles,
  COALESCE(sum(profile_count), 0) AS profiles_in_duplicate_links
FROM duplicate_links;

-- SECTION 13 / QUERY 13.1: Employee parent-reference and tenant-integrity counts.
-- Returns counts for missing and cross-tenant company, department, and location relationships.
SELECT
  count(*) FILTER (WHERE c.id IS NULL) AS invalid_company_reference_count,
  count(*) FILTER (WHERE e.department_id IS NOT NULL AND d.id IS NULL) AS invalid_department_reference_count,
  count(*) FILTER (WHERE e.location_id IS NOT NULL AND l.id IS NULL) AS invalid_location_reference_count,
  count(*) FILTER (
    WHERE d.id IS NOT NULL AND d.company_id IS DISTINCT FROM e.company_id
  ) AS employee_department_tenant_mismatch_count,
  count(*) FILTER (
    WHERE l.id IS NOT NULL AND l.company_id IS DISTINCT FROM e.company_id
  ) AS employee_location_tenant_mismatch_count
FROM public.employees AS e
LEFT JOIN public.companies AS c ON c.id = e.company_id
LEFT JOIN public.departments AS d ON d.id = e.department_id
LEFT JOIN public.locations AS l ON l.id = e.location_id;

-- SECTION 13 / QUERY 13.2: Department manager/location integrity counts.
-- Returns aggregate invalid-reference and cross-tenant counts only.
SELECT
  count(*) FILTER (WHERE d.location_id IS NOT NULL AND l.id IS NULL) AS invalid_department_location_count,
  count(*) FILTER (
    WHERE l.id IS NOT NULL AND l.company_id IS DISTINCT FROM d.company_id
  ) AS department_location_tenant_mismatch_count,
  count(*) FILTER (WHERE d.manager_employee_id IS NOT NULL AND e.id IS NULL) AS invalid_manager_employee_count,
  count(*) FILTER (
    WHERE e.id IS NOT NULL AND e.company_id IS DISTINCT FROM d.company_id
  ) AS department_manager_tenant_mismatch_count
FROM public.departments AS d
LEFT JOIN public.locations AS l ON l.id = d.location_id
LEFT JOIN public.employees AS e ON e.id = d.manager_employee_id;

-- SECTION 13 / QUERY 13.3: Duplicate department names within tenants.
-- Returns only duplicate-group and affected-row counts, never names or company IDs.
WITH duplicate_groups AS (
  SELECT count(*) AS group_size
  FROM public.departments
  GROUP BY company_id, lower(btrim(name))
  HAVING count(*) > 1
)
SELECT
  count(*) AS duplicate_department_name_group_count,
  COALESCE(sum(group_size), 0) AS departments_in_duplicate_name_groups
FROM duplicate_groups;

-- SECTION 13 / QUERY 13.4: Duplicate location names within tenants.
-- Returns only duplicate-group and affected-row counts.
WITH duplicate_groups AS (
  SELECT count(*) AS group_size
  FROM public.locations
  GROUP BY company_id, lower(btrim(name))
  HAVING count(*) > 1
)
SELECT
  count(*) AS duplicate_location_name_group_count,
  COALESCE(sum(group_size), 0) AS locations_in_duplicate_name_groups
FROM duplicate_groups;

-- SECTION 14 / QUERY 14.1: Shift-to-employee and shift-to-department integrity counts.
-- Returns aggregate missing/cross-tenant references and inactive assignment counts.
SELECT
  count(*) FILTER (WHERE s.employee_id IS NOT NULL AND e.id IS NULL) AS missing_employee_count,
  count(*) FILTER (
    WHERE e.id IS NOT NULL AND e.company_id IS DISTINCT FROM s.company_id
  ) AS shift_employee_tenant_mismatch_count,
  count(*) FILTER (WHERE s.department_id IS NOT NULL AND d.id IS NULL) AS missing_department_count,
  count(*) FILTER (
    WHERE d.id IS NOT NULL AND d.company_id IS DISTINCT FROM s.company_id
  ) AS shift_department_tenant_mismatch_count,
  count(*) FILTER (
    WHERE e.id IS NOT NULL AND e.status IS DISTINCT FROM 'active'
  ) AS shifts_for_non_active_employees
FROM public.shifts AS s
LEFT JOIN public.employees AS e ON e.id = s.employee_id
LEFT JOIN public.departments AS d ON d.id = s.department_id;

-- SECTION 14 / QUERY 14.2: Attendance-to-employee tenant integrity and provenance completeness.
-- Returns aggregate counts. Column metadata should be reviewed before running if live names differ.
SELECT
  count(*) AS attendance_record_count,
  count(*) FILTER (WHERE e.id IS NULL) AS missing_employee_count,
  count(*) FILTER (
    WHERE e.id IS NOT NULL AND e.company_id IS DISTINCT FROM a.company_id
  ) AS attendance_employee_tenant_mismatch_count,
  count(*) FILTER (WHERE a.location IS NULL OR btrim(a.location) = '') AS missing_free_text_location_count
FROM public.attendance_records AS a
LEFT JOIN public.employees AS e ON e.id = a.employee_id;

-- SECTION 14 / QUERY 14.3: Time-off-to-employee integrity counts.
-- Returns aggregate missing/cross-tenant references and non-active employee associations.
SELECT
  count(*) AS time_off_request_count,
  count(*) FILTER (WHERE e.id IS NULL) AS missing_employee_count,
  count(*) FILTER (
    WHERE e.id IS NOT NULL AND e.company_id IS DISTINCT FROM r.company_id
  ) AS time_off_employee_tenant_mismatch_count,
  count(*) FILTER (
    WHERE e.id IS NOT NULL AND e.status IS DISTINCT FROM 'active'
  ) AS requests_for_non_active_employees
FROM public.time_off_requests AS r
LEFT JOIN public.employees AS e ON e.id = r.employee_id;

-- SECTION 14 / QUERY 14.4: Shift-swap employee integrity counts.
-- Returns aggregate missing/cross-tenant requestor and target references only.
SELECT
  count(*) AS shift_swap_count,
  count(*) FILTER (WHERE requester.id IS NULL) AS missing_requester_employee_count,
  count(*) FILTER (WHERE target.id IS NULL) AS missing_target_employee_count,
  count(*) FILTER (
    WHERE requester.id IS NOT NULL AND requester.company_id IS DISTINCT FROM sw.company_id
  ) AS requester_tenant_mismatch_count,
  count(*) FILTER (
    WHERE target.id IS NOT NULL AND target.company_id IS DISTINCT FROM sw.company_id
  ) AS target_tenant_mismatch_count
FROM public.shift_swaps AS sw
LEFT JOIN public.employees AS requester ON requester.id = sw.requestor_id
LEFT JOIN public.employees AS target ON target.id = sw.target_employee_id;

-- SECTION 14 / QUERY 14.5: Task-to-employee integrity counts.
-- Returns aggregate missing/cross-tenant assignee references only.
SELECT
  count(*) AS task_count,
  count(*) FILTER (
    WHERE t.assigned_employee_id IS NOT NULL AND e.id IS NULL
  ) AS missing_assigned_employee_count,
  count(*) FILTER (
    WHERE e.id IS NOT NULL AND e.company_id IS DISTINCT FROM t.company_id
  ) AS task_employee_tenant_mismatch_count
FROM public.tasks AS t
LEFT JOIN public.employees AS e ON e.id = t.assigned_employee_id;

-- SECTION 15 / QUERY 15.1: Employee dependency counts by table and foreign-key action.
-- Returns metadata plus aggregate estimated row counts; no employee IDs are returned.
SELECT
  src_ns.nspname AS source_schema,
  src.relname AS source_table,
  con.conname AS foreign_key_name,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT'
  END AS on_employee_delete,
  src.reltuples::bigint AS estimated_source_rows,
  pg_get_constraintdef(con.oid, true) AS constraint_definition
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS src ON src.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS src_ns ON src_ns.oid = src.relnamespace
JOIN pg_catalog.pg_class AS target ON target.oid = con.confrelid
JOIN pg_catalog.pg_namespace AS target_ns ON target_ns.oid = target.relnamespace
WHERE con.contype = 'f'
  AND target_ns.nspname = 'public'
  AND target.relname = 'employees'
ORDER BY source_schema, source_table, foreign_key_name;

-- SECTION 15 / QUERY 15.2: Exact aggregate reference counts for known employee dependencies.
-- Returns counts per relationship only, without employee IDs or personal fields.
SELECT 'profiles.employee_id' AS relationship, count(*) AS referencing_row_count
FROM public.profiles WHERE employee_id IS NOT NULL
UNION ALL
SELECT 'departments.manager_employee_id', count(*)
FROM public.departments WHERE manager_employee_id IS NOT NULL
UNION ALL
SELECT 'shifts.employee_id', count(*)
FROM public.shifts WHERE employee_id IS NOT NULL
UNION ALL
SELECT 'attendance_records.employee_id', count(*)
FROM public.attendance_records WHERE employee_id IS NOT NULL
UNION ALL
SELECT 'time_off_requests.employee_id', count(*)
FROM public.time_off_requests WHERE employee_id IS NOT NULL
UNION ALL
SELECT 'shift_swaps.requestor_id', count(*)
FROM public.shift_swaps WHERE requestor_id IS NOT NULL
UNION ALL
SELECT 'shift_swaps.target_employee_id', count(*)
FROM public.shift_swaps WHERE target_employee_id IS NOT NULL
UNION ALL
SELECT 'tasks.assigned_employee_id', count(*)
FROM public.tasks WHERE assigned_employee_id IS NOT NULL
ORDER BY relationship;

-- SECTION 16 / QUERY 16.1: Candidate workforce/scheduling tables not covered by known names.
-- Returns structural object names only, helping identify undocumented live objects.
SELECT
  n.nspname AS schema_name,
  c.relname AS object_name,
  CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table' WHEN 'v' THEN 'view' ELSE c.relkind::text END AS object_kind
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v')
  AND (
    c.relname ILIKE '%employee%'
    OR c.relname ILIKE '%profile%'
    OR c.relname ILIKE '%shift%'
    OR c.relname ILIKE '%schedule%'
    OR c.relname ILIKE '%attendance%'
    OR c.relname ILIKE '%clock%'
    OR c.relname ILIKE '%leave%'
    OR c.relname ILIKE '%time_off%'
    OR c.relname ILIKE '%role%'
    OR c.relname ILIKE '%permission%'
    OR c.relname ILIKE '%skill%'
    OR c.relname ILIKE '%certification%'
    OR c.relname ILIKE '%position%'
  )
ORDER BY n.nspname, c.relname;
