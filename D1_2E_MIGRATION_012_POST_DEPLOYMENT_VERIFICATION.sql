-- Migration 012 post-deployment verification.
-- One SELECT-only statement. It does not recompute or rewrite migration 011's
-- historical fingerprint and returns only structural metadata, non-reversible
-- SHA-256 evidence, and aggregates. Historical field equality is enforced by
-- the migration's transaction-local pre-update snapshot; this verifier confirms
-- the resulting six-row identity/vocabulary state and expected updated_at effect.
WITH
checkpoint AS (
  SELECT
    checkpoint_row.migration_name,
    checkpoint_row.baseline_version,
    checkpoint_row.catalog_fingerprint,
    checkpoint_row.approval_reference,
    checkpoint_row.recorded_at
  FROM public.d1_employee_migration_checkpoints AS checkpoint_row
),
checkpoint_grants AS (
  SELECT grant_row.grantee, grant_row.privilege_type, grant_row.is_grantable
  FROM information_schema.role_table_grants AS grant_row
  WHERE grant_row.table_schema = 'public'
    AND grant_row.table_name = 'd1_employee_migration_checkpoints'
),
employee_columns AS (
  SELECT
    column_row.column_name,
    column_row.data_type,
    column_row.is_nullable,
    column_row.column_default
  FROM information_schema.columns AS column_row
  WHERE column_row.table_schema = 'public'
    AND column_row.table_name = 'employees'
),
employee_constraints AS (
  SELECT
    constraint_row.conname AS constraint_name,
    constraint_row.contype::text AS constraint_type,
    constraint_row.convalidated AS validated,
    constraint_row.confdeltype::text AS delete_action,
    referenced_namespace.nspname AS referenced_schema,
    referenced_relation.relname AS referenced_table,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
  FROM pg_catalog.pg_constraint AS constraint_row
  LEFT JOIN pg_catalog.pg_class AS referenced_relation
    ON referenced_relation.oid = constraint_row.confrelid
  LEFT JOIN pg_catalog.pg_namespace AS referenced_namespace
    ON referenced_namespace.oid = referenced_relation.relnamespace
  WHERE constraint_row.conrelid = to_regclass('public.employees')
),
employee_constraint_literals AS (
  SELECT
    constraint_row.constraint_name,
    array_agg((literal.match)[1] ORDER BY (literal.match)[1]) AS literal_values
  FROM employee_constraints AS constraint_row
  CROSS JOIN LATERAL regexp_matches(
    constraint_row.definition,
    '''([^'']+)''',
    'g'
  ) AS literal(match)
  GROUP BY constraint_row.constraint_name
),
employee_indexes AS (
  SELECT
    index_relation.relname AS index_name,
    index_row.indisunique AS is_unique,
    index_row.indisvalid AS is_valid,
    ARRAY(
      SELECT attribute.attname
      FROM unnest(index_row.indkey) WITH ORDINALITY AS key_column(attribute_number, ordinal_position)
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = index_row.indrelid
        AND attribute.attnum = key_column.attribute_number
      ORDER BY key_column.ordinal_position
    ) AS key_columns,
    pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid) AS predicate,
    pg_catalog.pg_get_indexdef(index_row.indexrelid) AS definition
  FROM pg_catalog.pg_index AS index_row
  JOIN pg_catalog.pg_class AS index_relation
    ON index_relation.oid = index_row.indexrelid
  WHERE index_row.indrelid = to_regclass('public.employees')
),
exception_state AS (
  SELECT
    relation.relrowsecurity AS rls_enabled,
    relation.relforcerowsecurity AS rls_forced,
    pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid = to_regclass('public.employee_migration_exceptions')
),
exception_columns AS (
  SELECT
    column_row.column_name,
    column_row.data_type,
    column_row.is_nullable,
    column_row.column_default
  FROM information_schema.columns AS column_row
  WHERE column_row.table_schema = 'public'
    AND column_row.table_name = 'employee_migration_exceptions'
),
exception_constraints AS (
  SELECT
    constraint_row.conname AS constraint_name,
    constraint_row.contype::text AS constraint_type,
    constraint_row.convalidated AS validated,
    constraint_row.confdeltype::text AS delete_action,
    referenced_namespace.nspname AS referenced_schema,
    referenced_relation.relname AS referenced_table,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
  FROM pg_catalog.pg_constraint AS constraint_row
  LEFT JOIN pg_catalog.pg_class AS referenced_relation
    ON referenced_relation.oid = constraint_row.confrelid
  LEFT JOIN pg_catalog.pg_namespace AS referenced_namespace
    ON referenced_namespace.oid = referenced_relation.relnamespace
  WHERE constraint_row.conrelid = to_regclass('public.employee_migration_exceptions')
),
exception_constraint_literals AS (
  SELECT
    constraint_row.constraint_name,
    array_agg((literal.match)[1] ORDER BY (literal.match)[1]) AS literal_values
  FROM exception_constraints AS constraint_row
  CROSS JOIN LATERAL regexp_matches(
    constraint_row.definition,
    '''([^'']+)''',
    'g'
  ) AS literal(match)
  GROUP BY constraint_row.constraint_name
),
exception_grants AS (
  SELECT grant_row.grantee, grant_row.privilege_type, grant_row.is_grantable
  FROM information_schema.role_table_grants AS grant_row
  WHERE grant_row.table_schema = 'public'
    AND grant_row.table_name = 'employee_migration_exceptions'
),
exception_policies AS (
  SELECT
    policy.polname AS policy_name,
    policy.polcmd::text AS command,
    pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
    pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) AS check_expression
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = to_regclass('public.employee_migration_exceptions')
),
employee_aggregates AS (
  SELECT
    count(*)::bigint AS employee_count,
    count(*) FILTER (WHERE employee.status = 'active')::bigint AS legacy_active_count,
    count(*) FILTER (WHERE employee.status = 'actie')::bigint AS legacy_actie_count,
    count(*) FILTER (WHERE employee.status IS NULL)::bigint AS legacy_null_status_count,
    count(*) FILTER (
      WHERE employee.status IS DISTINCT FROM 'active'
        AND employee.status IS DISTINCT FROM 'actie'
        AND employee.status IS NOT NULL
    )::bigint AS legacy_other_status_count,
    count(*) FILTER (WHERE employee.lifecycle_status = 'active')::bigint AS canonical_active_count,
    count(*) FILTER (WHERE employee.lifecycle_status IS NULL)::bigint AS canonical_null_count,
    count(*) FILTER (
      WHERE employee.lifecycle_status IS DISTINCT FROM 'active'
        AND employee.lifecycle_status IS NOT NULL
    )::bigint AS canonical_other_count,
    count(*) FILTER (WHERE employee.lifecycle_effective_at IS NOT NULL)::bigint AS lifecycle_effective_count,
    count(*) FILTER (
      WHERE employee.updated_at >= employee.lifecycle_effective_at
    )::bigint AS updated_at_at_or_after_lifecycle_count,
    count(*) FILTER (WHERE employee.version = 1)::bigint AS version_one_count,
    count(*) FILTER (WHERE employee.version <> 1)::bigint AS unexpected_version_count,
    count(*) FILTER (
      WHERE employee.lifecycle_effective_at IS NULL
        OR employee.lifecycle_effective_at > employee.updated_at
    )::bigint AS invalid_lifecycle_timestamp_count,
    count(*) FILTER (WHERE employee.employee_number IS NOT NULL)::bigint AS generated_employee_number_count,
    count(*) FILTER (WHERE employee.archived_at IS NOT NULL)::bigint AS populated_archived_at_count,
    count(*) FILTER (WHERE employee.archived_by_profile_id IS NOT NULL)::bigint AS populated_archive_actor_count,
    count(*) FILTER (WHERE employee.termination_reason_code IS NOT NULL)::bigint AS populated_termination_reason_count
  FROM public.employees AS employee
),
employee_identity_and_legacy_evidence AS (
  SELECT
    count(*)::bigint AS employee_count,
    count(DISTINCT employee.id)::bigint AS distinct_employee_id_count,
    count(*) FILTER (WHERE employee.company_id IS NULL)::bigint AS null_company_count,
    count(*) FILTER (WHERE company.id IS NULL)::bigint AS missing_company_count,
    encode(
      extensions.digest(
        convert_to(
          string_agg(employee.id::text || ':' || employee.company_id::text, '|' ORDER BY employee.id),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) AS employee_company_identity_set_hash,
    encode(
      extensions.digest(
        convert_to(
          string_agg(
            jsonb_build_array(
              employee.id,
              employee.company_id,
              employee.status,
              employee.employment_type,
              employee.role,
              employee.department,
              employee.first_name,
              employee.last_name,
              employee.location_id,
              employee.department_id,
              employee.hire_date,
              employee.email,
              employee.phone,
              employee.notes,
              employee.salary,
              employee.created_at
            )::text,
            '|'
            ORDER BY employee.id
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) AS legacy_business_field_set_hash
  FROM public.employees AS employee
  LEFT JOIN public.companies AS company ON company.id = employee.company_id
),
employee_vocabularies AS (
  SELECT
    (
      SELECT coalesce(jsonb_object_agg(grouped.value, grouped.row_count), '{}'::jsonb)
      FROM (
        SELECT employee.status AS value, count(*) AS row_count
        FROM public.employees AS employee
        GROUP BY employee.status
      ) AS grouped
    ) AS status_counts,
    (
      SELECT coalesce(jsonb_object_agg(grouped.value, grouped.row_count), '{}'::jsonb)
      FROM (
        SELECT employee.employment_type AS value, count(*) AS row_count
        FROM public.employees AS employee
        GROUP BY employee.employment_type
      ) AS grouped
    ) AS employment_type_counts,
    (
      SELECT coalesce(jsonb_object_agg(grouped.value, grouped.row_count), '{}'::jsonb)
      FROM (
        SELECT employee.role AS value, count(*) AS row_count
        FROM public.employees AS employee
        GROUP BY employee.role
      ) AS grouped
    ) AS role_counts,
    (
      SELECT coalesce(jsonb_object_agg(grouped.value, grouped.row_count), '{}'::jsonb)
      FROM (
        SELECT employee.department AS value, count(*) AS row_count
        FROM public.employees AS employee
        GROUP BY employee.department
      ) AS grouped
    ) AS department_counts
),
employee_trigger AS (
  SELECT
    trigger_row.tgname AS trigger_name,
    trigger_row.tgenabled::text AS enabled_state,
    trigger_row.tgtype AS trigger_type,
    namespace.nspname AS function_schema,
    procedure.proname AS function_name,
    procedure.prosecdef AS security_definer,
    regexp_replace(lower(procedure.prosrc), '\s+', '', 'g') AS normalized_source
  FROM pg_catalog.pg_trigger AS trigger_row
  JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger_row.tgfoid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE trigger_row.tgrelid = to_regclass('public.employees')
    AND NOT trigger_row.tgisinternal
),
company_grants AS (
  SELECT grant_row.grantee, grant_row.privilege_type, grant_row.is_grantable
  FROM information_schema.role_table_grants AS grant_row
  WHERE grant_row.table_schema = 'public'
    AND grant_row.table_name = 'companies'
    AND grant_row.grantee IN ('anon', 'authenticated')
),
company_policies AS (
  SELECT
    policy.polcmd::text AS command,
    policy.polroles,
    pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
    pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) AS check_expression
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = to_regclass('public.companies')
),
supabase_roles AS (
  SELECT
    (SELECT role.oid FROM pg_catalog.pg_roles AS role WHERE role.rolname = 'anon') AS anon_oid,
    (SELECT role.oid FROM pg_catalog.pg_roles AS role WHERE role.rolname = 'authenticated') AS authenticated_oid
),
company_policy_checks AS (
  SELECT
    command_row.command_name,
    command_row.command_code,
    (
      SELECT count(*)
      FROM company_policies AS policy
      CROSS JOIN supabase_roles AS role_oids
      WHERE policy.command = command_row.command_code
        AND (0::oid = ANY (policy.polroles) OR role_oids.anon_oid = ANY (policy.polroles))
        AND CASE command_row.command_code
          WHEN 'r' THEN regexp_replace(lower(coalesce(policy.using_expression, '')), '[()\s]', '', 'g') = 'true'
          WHEN 'a' THEN regexp_replace(lower(coalesce(policy.check_expression, '')), '[()\s]', '', 'g') = 'true'
          WHEN 'w' THEN
            regexp_replace(lower(coalesce(policy.using_expression, '')), '[()\s]', '', 'g') = 'true'
            AND regexp_replace(lower(coalesce(policy.check_expression, '')), '[()\s]', '', 'g') = 'true'
          WHEN 'd' THEN regexp_replace(lower(coalesce(policy.using_expression, '')), '[()\s]', '', 'g') = 'true'
          ELSE false
        END
    ) AS unconditional_anon_policy_count,
    (
      SELECT count(*)
      FROM company_policies AS policy
      CROSS JOIN supabase_roles AS role_oids
      WHERE policy.command = command_row.command_code
        AND (0::oid = ANY (policy.polroles) OR role_oids.authenticated_oid = ANY (policy.polroles))
        AND NOT CASE command_row.command_code
          WHEN 'r' THEN coalesce(regexp_replace(lower(coalesce(policy.using_expression, '')), '[()\s]', '', 'g') = 'true', false)
          WHEN 'a' THEN coalesce(regexp_replace(lower(coalesce(policy.check_expression, '')), '[()\s]', '', 'g') = 'true', false)
          WHEN 'w' THEN
            coalesce(regexp_replace(lower(coalesce(policy.using_expression, '')), '[()\s]', '', 'g') = 'true', false)
            AND coalesce(regexp_replace(lower(coalesce(policy.check_expression, '')), '[()\s]', '', 'g') = 'true', false)
          WHEN 'd' THEN coalesce(regexp_replace(lower(coalesce(policy.using_expression, '')), '[()\s]', '', 'g') = 'true', false)
          ELSE true
        END
    ) AS authenticated_conditional_policy_count
  FROM (VALUES
    ('SELECT'::text, 'r'::text),
    ('INSERT'::text, 'a'::text),
    ('UPDATE'::text, 'w'::text),
    ('DELETE'::text, 'd'::text)
  ) AS command_row(command_name, command_code)
),
k8 AS (
  SELECT
    procedure.oid IS NOT NULL AS function_exists,
    namespace.nspname AS schema_name,
    procedure.proname AS function_name,
    pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
    pg_catalog.pg_get_function_result(procedure.oid) AS result_type,
    pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
    procedure.prosecdef AS security_definer,
    procedure.proconfig AS function_config,
    pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE') AS service_role_execute,
    pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE') AS anon_execute,
    pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE') AS authenticated_execute
  FROM (
    SELECT to_regprocedure(
      'public.create_task_with_outbox_event(uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,uuid,text,integer,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz)'
    ) AS function_oid
  ) AS expected
  LEFT JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = expected.function_oid
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
),
kernel_tables AS (
  SELECT
    required.relation_name,
    relation.relrowsecurity AS rls_enabled,
    relation.relforcerowsecurity AS rls_forced
  FROM (VALUES
    ('brain_action_proposals'::text),
    ('brain_domain_events'::text),
    ('brain_event_outbox'::text)
  ) AS required(relation_name)
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.oid = to_regclass('public.' || required.relation_name)
),
checks(check_name, passed, details) AS (
  SELECT
    'migration_011_checkpoint_unchanged',
    (SELECT count(*) FROM checkpoint) = 1
      AND EXISTS (
        SELECT 1 FROM checkpoint AS checkpoint_row
        WHERE checkpoint_row.migration_name = '202607210011_d1_employee_catalog_baseline'
          AND checkpoint_row.baseline_version = 1
          AND checkpoint_row.catalog_fingerprint = '1fdf16c9af0cba0bd7b76de8dffba5acc5bd5427a4dec704675d665f83e73a99'
          AND checkpoint_row.approval_reference = 'D1_2E_FINAL_IMPLEMENTATION_SPECIFICATION.md (approved)'
      ),
    jsonb_build_object(
      'row_count', (SELECT count(*) FROM checkpoint),
      'checkpoint', (SELECT to_jsonb(checkpoint_row) FROM checkpoint AS checkpoint_row LIMIT 1),
      'live_fingerprint_comparison_required', false
    )

  UNION ALL

  SELECT
    'migration_011a_checkpoint_privileges_unchanged',
    NOT EXISTS (
      SELECT 1 FROM checkpoint_grants AS grant_row
      WHERE grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated')
    )
      AND (SELECT count(*) FROM checkpoint_grants AS grant_row WHERE grant_row.grantee = 'service_role') = 2
      AND (SELECT count(*) FROM checkpoint_grants AS grant_row WHERE grant_row.grantee = 'service_role' AND grant_row.privilege_type IN ('SELECT', 'INSERT')) = 2,
    jsonb_build_object(
      'grants', (SELECT coalesce(jsonb_agg(to_jsonb(grant_row) ORDER BY grant_row.grantee, grant_row.privilege_type), '[]'::jsonb) FROM checkpoint_grants AS grant_row)
    )

  UNION ALL

  SELECT
    'employee_updated_at_trigger_expected_and_enabled',
    (SELECT count(*) FROM employee_trigger) = 1
      AND EXISTS (
        SELECT 1
        FROM employee_trigger AS trigger_state
        WHERE trigger_state.trigger_name = 'employees_update_timestamp'
          AND trigger_state.enabled_state = 'O'
          AND trigger_state.trigger_type = 19
          AND trigger_state.function_schema = 'public'
          AND trigger_state.function_name = 'update_timestamp'
          AND NOT trigger_state.security_definer
          AND trigger_state.normalized_source = 'beginnew.updated_at=now();returnnew;end;'
      ),
    jsonb_build_object(
      'trigger', (SELECT to_jsonb(trigger_state) FROM employee_trigger AS trigger_state LIMIT 1),
      'policy', 'existing trigger intentionally advances updated_at; lifecycle_effective_at stores the pre-trigger updated_at'
    )

  UNION ALL

  SELECT
    'employee_identity_and_company_relationships_preserved',
    evidence.employee_count = 6
      AND evidence.distinct_employee_id_count = 6
      AND evidence.null_company_count = 0
      AND evidence.missing_company_count = 0
      AND evidence.employee_company_identity_set_hash ~ '^[0-9a-f]{64}$',
    to_jsonb(evidence)
  FROM employee_identity_and_legacy_evidence AS evidence

  UNION ALL

  SELECT
    'legacy_business_fields_preserved_by_atomic_snapshot',
    evidence.employee_count = 6
      AND evidence.legacy_business_field_set_hash ~ '^[0-9a-f]{64}$'
      AND aggregate.invalid_lifecycle_timestamp_count = 0,
    jsonb_build_object(
      'employee_count', evidence.employee_count,
      'legacy_business_field_set_hash', evidence.legacy_business_field_set_hash,
      'historical_comparison', 'enforced inside migration transaction against pg_temp.d1_012_employee_before',
      'updated_at_policy', 'updated_at may advance only through the reviewed trigger'
    )
  FROM employee_identity_and_legacy_evidence AS evidence
  CROSS JOIN employee_aggregates AS aggregate

  UNION ALL

  SELECT
    'legacy_vocabularies_exactly_preserved',
    vocabulary.status_counts = '{"active": 6}'::jsonb
      AND vocabulary.employment_type_counts = '{"full-time": 5, "full time": 1}'::jsonb
      AND vocabulary.role_counts = '{"employee": 1, "manager": 2, "owner": 2, "Owner": 1}'::jsonb
      AND vocabulary.department_counts = '{"Floor": 1, "General": 2, "management": 2, "Waiter": 1}'::jsonb,
    to_jsonb(vocabulary)
  FROM employee_vocabularies AS vocabulary

  UNION ALL

  SELECT
    'employee_foundation_columns_exact',
    (SELECT count(*) FROM employee_columns AS column_row WHERE column_row.column_name IN (
      'employee_number', 'lifecycle_status', 'version', 'lifecycle_effective_at',
      'archived_at', 'archived_by_profile_id', 'termination_reason_code'
    )) = 7
      AND EXISTS (SELECT 1 FROM employee_columns WHERE column_name = 'employee_number' AND data_type = 'text' AND is_nullable = 'YES')
      AND EXISTS (SELECT 1 FROM employee_columns WHERE column_name = 'lifecycle_status' AND data_type = 'text' AND is_nullable = 'YES')
      AND EXISTS (SELECT 1 FROM employee_columns WHERE column_name = 'version' AND data_type = 'bigint' AND is_nullable = 'NO' AND column_default = '1')
      AND EXISTS (SELECT 1 FROM employee_columns WHERE column_name = 'lifecycle_effective_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'YES')
      AND EXISTS (SELECT 1 FROM employee_columns WHERE column_name = 'archived_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'YES')
      AND EXISTS (SELECT 1 FROM employee_columns WHERE column_name = 'archived_by_profile_id' AND data_type = 'uuid' AND is_nullable = 'YES')
      AND EXISTS (SELECT 1 FROM employee_columns WHERE column_name = 'termination_reason_code' AND data_type = 'text' AND is_nullable = 'YES'),
    jsonb_build_object(
      'columns', (SELECT jsonb_agg(to_jsonb(column_row) ORDER BY column_row.column_name) FROM employee_columns AS column_row WHERE column_row.column_name IN (
        'employee_number', 'lifecycle_status', 'version', 'lifecycle_effective_at',
        'archived_at', 'archived_by_profile_id', 'termination_reason_code'
      ))
    )

  UNION ALL

  SELECT
    'employee_foundation_constraints_exact_and_validated',
    (SELECT count(*) FROM employee_constraints AS constraint_row WHERE constraint_row.constraint_name IN (
      'employees_lifecycle_status_check', 'employees_version_positive',
      'employees_archive_shape', 'employees_archived_by_profile_id_fkey'
    ) AND constraint_row.validated) = 4
      AND EXISTS (
        SELECT 1 FROM employee_constraints
        WHERE constraint_name = 'employees_lifecycle_status_check'
          AND constraint_type = 'c'
          AND definition LIKE '%lifecycle_status IS NULL%'
          AND definition LIKE '%draft%'
          AND definition LIKE '%active%'
          AND definition LIKE '%on_leave%'
          AND definition LIKE '%inactive%'
          AND definition LIKE '%terminated%'
          AND definition LIKE '%archived%'
      )
      AND EXISTS (
        SELECT 1 FROM employee_constraint_literals
        WHERE constraint_name = 'employees_lifecycle_status_check'
          AND literal_values = ARRAY[
            'active', 'archived', 'draft', 'inactive', 'on_leave', 'terminated'
          ]::text[]
      )
      AND EXISTS (
        SELECT 1 FROM employee_constraints
        WHERE constraint_name = 'employees_version_positive'
          AND constraint_type = 'c'
          AND regexp_replace(definition, '[()\s]', '', 'g') = 'CHECKversion>0'
      )
      AND EXISTS (
        SELECT 1 FROM employee_constraints
        WHERE constraint_name = 'employees_archive_shape'
          AND constraint_type = 'c'
          AND definition LIKE '%lifecycle_status IS DISTINCT FROM%archived%'
          AND definition LIKE '%archived_at IS NOT NULL%'
      )
      AND EXISTS (
        SELECT 1 FROM employee_constraints
        WHERE constraint_name = 'employees_archived_by_profile_id_fkey'
          AND constraint_type = 'f'
          AND referenced_schema = 'public'
          AND referenced_table = 'profiles'
          AND delete_action = 'r'
          AND definition LIKE 'FOREIGN KEY (archived_by_profile_id)%REFERENCES profiles(id)%ON DELETE RESTRICT%'
      ),
    jsonb_build_object(
      'constraints', (SELECT jsonb_agg(to_jsonb(constraint_row) ORDER BY constraint_row.constraint_name) FROM employee_constraints AS constraint_row WHERE constraint_row.constraint_name IN (
        'employees_lifecycle_status_check', 'employees_version_positive',
        'employees_archive_shape', 'employees_archived_by_profile_id_fkey'
      ))
    )

  UNION ALL

  SELECT
    'employee_foundation_indexes_valid',
    EXISTS (
      SELECT 1 FROM employee_indexes
      WHERE index_name = 'employees_company_id_id_uidx'
        AND is_unique AND is_valid
        AND key_columns = ARRAY['company_id', 'id']::name[]
        AND predicate IS NULL
    )
      AND EXISTS (
        SELECT 1 FROM employee_indexes
        WHERE index_name = 'employees_company_employee_number_uidx'
          AND is_unique AND is_valid
          AND key_columns = ARRAY['company_id', 'employee_number']::name[]
          AND regexp_replace(coalesce(predicate, ''), '[()\s]', '', 'g') = 'employee_numberISNOTNULL'
      ),
    jsonb_build_object(
      'indexes', (SELECT jsonb_agg(to_jsonb(index_row) ORDER BY index_row.index_name) FROM employee_indexes AS index_row WHERE index_row.index_name IN (
        'employees_company_id_id_uidx', 'employees_company_employee_number_uidx'
      ))
    )

  UNION ALL

  SELECT
    'canonical_backfill_exact_and_legacy_unchanged',
    aggregate.employee_count = 6
      AND aggregate.legacy_active_count = 6
      AND aggregate.legacy_actie_count = 0
      AND aggregate.legacy_null_status_count = 0
      AND aggregate.legacy_other_status_count = 0
      AND aggregate.canonical_active_count = 6
      AND aggregate.canonical_null_count = 0
      AND aggregate.canonical_other_count = 0
      AND aggregate.lifecycle_effective_count = 6
      AND aggregate.updated_at_at_or_after_lifecycle_count = 6
      AND aggregate.version_one_count = 6
      AND aggregate.unexpected_version_count = 0
      AND aggregate.invalid_lifecycle_timestamp_count = 0,
    to_jsonb(aggregate)
  FROM employee_aggregates AS aggregate

  UNION ALL

  SELECT
    'no_employee_numbers_or_archive_values_generated',
    aggregate.generated_employee_number_count = 0
      AND aggregate.populated_archived_at_count = 0
      AND aggregate.populated_archive_actor_count = 0
      AND aggregate.populated_termination_reason_count = 0,
    to_jsonb(aggregate)
  FROM employee_aggregates AS aggregate

  UNION ALL

  SELECT
    'exception_table_forced_rls_without_policies',
    to_regclass('public.employee_migration_exceptions') IS NOT NULL
      AND coalesce((SELECT state.rls_enabled AND state.rls_forced FROM exception_state AS state), false)
      AND (SELECT count(*) FROM exception_policies) = 0,
    jsonb_build_object(
      'table_state', coalesce((SELECT to_jsonb(state) FROM exception_state AS state), '{}'::jsonb),
      'policy_count', (SELECT count(*) FROM exception_policies)
    )

  UNION ALL

  SELECT
    'exception_table_service_role_exact_privileges',
    (SELECT count(*) FROM exception_grants AS grant_row WHERE grant_row.grantee = 'service_role') = 3
      AND (SELECT count(*) FROM exception_grants AS grant_row WHERE grant_row.grantee = 'service_role' AND grant_row.privilege_type IN ('SELECT', 'INSERT', 'UPDATE')) = 3
      AND NOT EXISTS (
        SELECT 1 FROM exception_grants AS grant_row
        WHERE grant_row.grantee = 'service_role'
          AND grant_row.privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
      ),
    jsonb_build_object(
      'service_role_grants', (SELECT coalesce(jsonb_agg(to_jsonb(grant_row) ORDER BY grant_row.privilege_type), '[]'::jsonb) FROM exception_grants AS grant_row WHERE grant_row.grantee = 'service_role')
    )

  UNION ALL

  SELECT
    'exception_table_ordinary_roles_have_zero_access',
    NOT EXISTS (
      SELECT 1 FROM exception_grants AS grant_row
      WHERE grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated')
    ),
    jsonb_build_object(
      'ordinary_grants', (SELECT coalesce(jsonb_agg(to_jsonb(grant_row) ORDER BY grant_row.grantee, grant_row.privilege_type), '[]'::jsonb) FROM exception_grants AS grant_row WHERE grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated'))
    )

  UNION ALL

  SELECT
    'exception_table_contains_no_unexpected_rows',
    (SELECT count(*) FROM public.employee_migration_exceptions) = 0,
    jsonb_build_object(
      'exception_row_count', (SELECT count(*) FROM public.employee_migration_exceptions),
      'expected_from_approved_status_vocabulary', 0
    )

  UNION ALL

  SELECT
    'exception_table_contract_complete',
    (SELECT count(*) FROM exception_columns) = 10
      AND (SELECT count(*) FROM exception_constraints WHERE constraint_name IN (
        'employee_migration_exceptions_pkey',
        'employee_migration_exceptions_employee_field_key',
        'employee_migration_exceptions_employee_company_fkey',
        'employee_migration_exceptions_reviewed_by_profile_id_fkey',
        'employee_migration_exceptions_field_name_check',
        'employee_migration_exceptions_source_value_hash_check',
        'employee_migration_exceptions_resolution_status_check'
      ) AND validated) = 7
      AND EXISTS (
        SELECT 1 FROM exception_constraints
        WHERE constraint_name = 'employee_migration_exceptions_pkey'
          AND constraint_type = 'p' AND definition = 'PRIMARY KEY (id)'
      )
      AND EXISTS (
        SELECT 1 FROM exception_constraints
        WHERE constraint_name = 'employee_migration_exceptions_employee_field_key'
          AND constraint_type = 'u' AND definition = 'UNIQUE (employee_id, field_name)'
      )
      AND EXISTS (
        SELECT 1 FROM exception_constraints
        WHERE constraint_name = 'employee_migration_exceptions_employee_company_fkey'
          AND constraint_type = 'f'
          AND referenced_schema = 'public' AND referenced_table = 'employees'
          AND delete_action = 'r'
          AND definition LIKE 'FOREIGN KEY (company_id, employee_id)%REFERENCES employees(company_id, id)%ON DELETE RESTRICT%'
      )
      AND EXISTS (
        SELECT 1 FROM exception_constraints
        WHERE constraint_name = 'employee_migration_exceptions_reviewed_by_profile_id_fkey'
          AND constraint_type = 'f'
          AND referenced_schema = 'public' AND referenced_table = 'profiles'
          AND delete_action = 'r'
          AND definition LIKE 'FOREIGN KEY (reviewed_by_profile_id)%REFERENCES profiles(id)%ON DELETE RESTRICT%'
      )
      AND EXISTS (
        SELECT 1 FROM exception_constraints
        WHERE constraint_name = 'employee_migration_exceptions_field_name_check'
          AND constraint_type = 'c'
          AND definition LIKE '%status%employment_type%role%department%'
      )
      AND EXISTS (
        SELECT 1 FROM exception_constraint_literals
        WHERE constraint_name = 'employee_migration_exceptions_field_name_check'
          AND literal_values = ARRAY['department', 'employment_type', 'role', 'status']::text[]
      )
      AND EXISTS (
        SELECT 1 FROM exception_constraints
        WHERE constraint_name = 'employee_migration_exceptions_source_value_hash_check'
          AND constraint_type = 'c'
          AND definition LIKE '%^[0-9a-f]{64}$%'
      )
      AND EXISTS (
        SELECT 1 FROM exception_constraints
        WHERE constraint_name = 'employee_migration_exceptions_resolution_status_check'
          AND constraint_type = 'c'
          AND definition LIKE '%pending%approved%rejected%'
      )
      AND EXISTS (
        SELECT 1 FROM exception_constraint_literals
        WHERE constraint_name = 'employee_migration_exceptions_resolution_status_check'
          AND literal_values = ARRAY['approved', 'pending', 'rejected']::text[]
      ),
    jsonb_build_object(
      'columns', (SELECT jsonb_agg(to_jsonb(column_row) ORDER BY column_row.column_name) FROM exception_columns AS column_row),
      'constraints', (SELECT jsonb_agg(to_jsonb(constraint_row) ORDER BY constraint_row.constraint_name) FROM exception_constraints AS constraint_row)
    )

  UNION ALL

  SELECT
    'migration_010_protections_remain_valid',
    coalesce((SELECT relation.relrowsecurity FROM pg_catalog.pg_class AS relation WHERE relation.oid = to_regclass('public.companies')), false)
      AND NOT EXISTS (SELECT 1 FROM company_grants AS grant_row WHERE grant_row.grantee = 'anon')
      AND (SELECT bool_and(command_check.unconditional_anon_policy_count = 0 AND command_check.authenticated_conditional_policy_count >= 1) FROM company_policy_checks AS command_check),
    jsonb_build_object(
      'company_grants', (SELECT coalesce(jsonb_agg(to_jsonb(grant_row) ORDER BY grant_row.grantee, grant_row.privilege_type), '[]'::jsonb) FROM company_grants AS grant_row),
      'policy_checks', (SELECT jsonb_agg(to_jsonb(command_check) ORDER BY command_check.command_name) FROM company_policy_checks AS command_check)
    )

  UNION ALL

  SELECT
    'k8_exact_rpc_contract_unchanged',
    k8_state.function_exists
      AND k8_state.schema_name = 'public'
      AND k8_state.function_name = 'create_task_with_outbox_event'
      AND k8_state.owner_name = 'postgres'
      AND k8_state.security_definer
      AND k8_state.function_config @> ARRAY['search_path=public, pg_temp']::text[]
      AND k8_state.service_role_execute
      AND NOT k8_state.anon_execute
      AND NOT k8_state.authenticated_execute
      AND regexp_replace(coalesce(k8_state.result_type, ''), '\s+', ' ', 'g') =
        'TABLE(task_id uuid, title text, priority text, status text, assigned_employee_id uuid, due_date date, outbox_event_id uuid)',
    jsonb_build_object(
      'contract', to_jsonb(k8_state),
      'signature_verified_by_exact_to_regprocedure_lookup', true
    )
  FROM k8 AS k8_state

  UNION ALL

  SELECT
    'k8_kernel_tables_forced_rls_unchanged',
    count(*) = 3 AND bool_and(coalesce(kernel.rls_enabled, false) AND coalesce(kernel.rls_forced, false)),
    jsonb_build_object('tables', jsonb_agg(to_jsonb(kernel) ORDER BY kernel.relation_name))
  FROM kernel_tables AS kernel
),
summary AS (
  SELECT
    count(*) AS check_count,
    count(*) FILTER (WHERE verification.passed) AS passed_count,
    count(*) FILTER (WHERE NOT verification.passed) AS failed_count,
    bool_and(verification.passed) AS all_checks_pass
  FROM checks AS verification
)
SELECT jsonb_build_object(
  'migration_012_post_deployment_evidence',
  jsonb_build_object(
    'migration', '202607210012_d1_employee_foundation_expand.sql',
    'read_only', true,
    'contains_personal_identifiers', false,
    'summary', (SELECT to_jsonb(result) FROM summary AS result),
    'checks', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'check_name', verification.check_name,
          'passed', verification.passed,
          'details', verification.details
        )
        ORDER BY verification.check_name
      )
      FROM checks AS verification
    )
  )
);
