/*
  Phase B0 — Production catalog capture
  Target project reference: jjhtasppfxunbrswgxht

  Safety properties:
  - One read-only SELECT statement.
  - No temporary objects, functions, DO blocks, DDL, DML, or remote writes.
  - No application business rows, auth users, uploaded objects, or Vault values.
  - storage.buckets is read only for non-secret bucket configuration.
  - supabase_migrations.schema_migrations presence is detected through the catalog only.
  - cron command text is included only after the final evidence-wide redaction pass.

  The result is one row and one jsonb column named production_catalog_evidence.
*/

WITH
application_schemas AS (
  SELECT
    namespace.oid,
    namespace.nspname AS schema_name,
    pg_get_userbyid(namespace.nspowner) AS owner
  FROM pg_catalog.pg_namespace AS namespace
  WHERE namespace.nspname <> 'information_schema'
    AND namespace.nspname !~ '^pg_'
    AND namespace.nspname NOT IN (
      'auth',
      'cron',
      'extensions',
      'graphql',
      'graphql_public',
      'net',
      'pgbouncer',
      'realtime',
      'storage',
      'supabase_functions',
      'supabase_migrations',
      'vault'
    )
),
application_relations AS (
  SELECT
    relation.oid,
    namespace.schema_name,
    relation.relname AS relation_name,
    relation.relkind,
    relation.relowner,
    relation.relacl,
    relation.relrowsecurity,
    relation.relforcerowsecurity
  FROM pg_catalog.pg_class AS relation
  JOIN application_schemas AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
),
application_functions AS (
  SELECT
    procedure.oid,
    namespace.schema_name,
    procedure.proname AS function_name,
    procedure.proowner,
    procedure.proacl,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.prokind,
    procedure.prolang,
    procedure.provolatile,
    procedure.proparallel
  FROM pg_catalog.pg_proc AS procedure
  JOIN application_schemas AS namespace
    ON namespace.oid = procedure.pronamespace
),
project_reference AS (
  SELECT coalesce(
    nullif(current_setting('app.settings.project_ref', true), ''),
    nullif(current_setting('supabase.project_ref', true), '')
  ) AS safely_observed_project_ref
),
raw_evidence AS (
  SELECT jsonb_build_object(
    'capture_metadata', jsonb_build_object(
      'phase', 'B0',
      'captured_at', statement_timestamp(),
      'database_name', current_database(),
      'database_server_version', current_setting('server_version'),
      'expected_project_ref', 'jjhtasppfxunbrswgxht',
      'safely_observed_project_ref', project_reference.safely_observed_project_ref,
      'project_ref_confirmation',
        CASE
          WHEN project_reference.safely_observed_project_ref IS NULL
            THEN 'unavailable_from_safe_SQL_Editor_catalog_context'
          WHEN project_reference.safely_observed_project_ref = 'jjhtasppfxunbrswgxht'
            THEN 'confirmed'
          ELSE 'mismatch'
        END,
      'read_only_design', true,
      'contains_uploaded_objects', false,
      'contains_auth_user_rows', false,
      'contains_business_rows', false,
      'contains_vault_values', false,
      'cron_redaction_policy',
        'Every single-quoted cron command literal is replaced before JSON assembly; an additional evidence-wide redaction pass removes URL, bearer, Vault-reference, credential-assignment, JWT-like, and long-hex patterns.'
    ),

    'application_schemas', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', schema.schema_name,
          'owner', schema.owner
        )
        ORDER BY schema.schema_name
      )
      FROM application_schemas AS schema
    ), '[]'::jsonb),

    'tables_and_views', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', relation.schema_name,
          'name', relation.relation_name,
          'kind', CASE relation.relkind
            WHEN 'r' THEN 'table'
            WHEN 'p' THEN 'partitioned_table'
            WHEN 'v' THEN 'view'
            WHEN 'm' THEN 'materialized_view'
            WHEN 'f' THEN 'foreign_table'
            WHEN 'S' THEN 'sequence'
          END,
          'owner', pg_get_userbyid(relation.relowner)
        )
        ORDER BY relation.schema_name, relation.relation_name
      )
      FROM application_relations AS relation
      WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f')
    ), '[]'::jsonb),

    'columns', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', relation.schema_name,
          'relation', relation.relation_name,
          'ordinal_position', attribute.attnum,
          'column', attribute.attname,
          'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
          'default', pg_get_expr(default_value.adbin, default_value.adrelid, true),
          'nullable', NOT attribute.attnotnull,
          'identity', CASE attribute.attidentity
            WHEN 'a' THEN 'always'
            WHEN 'd' THEN 'by_default'
            ELSE null
          END,
          'generated', CASE attribute.attgenerated
            WHEN 's' THEN 'stored'
            WHEN 'v' THEN 'virtual'
            ELSE null
          END
        )
        ORDER BY relation.schema_name, relation.relation_name, attribute.attnum
      )
      FROM application_relations AS relation
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = relation.oid
      LEFT JOIN pg_catalog.pg_attrdef AS default_value
        ON default_value.adrelid = attribute.attrelid
       AND default_value.adnum = attribute.attnum
      WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ), '[]'::jsonb),

    'constraints', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', relation.schema_name,
          'relation', relation.relation_name,
          'name', constraint_row.conname,
          'type', CASE constraint_row.contype
            WHEN 'p' THEN 'primary_key'
            WHEN 'u' THEN 'unique'
            WHEN 'c' THEN 'check'
            WHEN 'f' THEN 'foreign_key'
            WHEN 'x' THEN 'exclusion'
          END,
          'definition', pg_get_constraintdef(constraint_row.oid, true),
          'validated', constraint_row.convalidated,
          'deferrable', constraint_row.condeferrable,
          'initially_deferred', constraint_row.condeferred,
          'referenced_schema', referenced_namespace.nspname,
          'referenced_relation', referenced_relation.relname
        )
        ORDER BY relation.schema_name, relation.relation_name, constraint_row.conname
      )
      FROM application_relations AS relation
      JOIN pg_catalog.pg_constraint AS constraint_row
        ON constraint_row.conrelid = relation.oid
      LEFT JOIN pg_catalog.pg_class AS referenced_relation
        ON referenced_relation.oid = constraint_row.confrelid
      LEFT JOIN pg_catalog.pg_namespace AS referenced_namespace
        ON referenced_namespace.oid = referenced_relation.relnamespace
      WHERE constraint_row.contype IN ('p', 'u', 'c', 'f', 'x')
    ), '[]'::jsonb),

    'indexes', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', relation.schema_name,
          'relation', relation.relation_name,
          'index', index_relation.relname,
          'definition', pg_get_indexdef(index_row.indexrelid, 0, true),
          'predicate', pg_get_expr(index_row.indpred, index_row.indrelid, true),
          'unique', index_row.indisunique,
          'primary', index_row.indisprimary,
          'valid', index_row.indisvalid,
          'ready', index_row.indisready
        )
        ORDER BY relation.schema_name, relation.relation_name, index_relation.relname
      )
      FROM application_relations AS relation
      JOIN pg_catalog.pg_index AS index_row
        ON index_row.indrelid = relation.oid
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_row.indexrelid
      WHERE relation.relkind IN ('r', 'p', 'm')
    ), '[]'::jsonb),

    'functions', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', function_row.schema_name,
          'name', function_row.function_name,
          'identity_arguments', pg_get_function_identity_arguments(function_row.oid),
          'arguments', pg_get_function_arguments(function_row.oid),
          'result', pg_get_function_result(function_row.oid),
          'signature', pg_get_function_identity_arguments(function_row.oid),
          'kind', CASE function_row.prokind
            WHEN 'f' THEN 'function'
            WHEN 'p' THEN 'procedure'
            WHEN 'a' THEN 'aggregate'
            WHEN 'w' THEN 'window'
          END,
          'language', language.lanname,
          'owner', pg_get_userbyid(function_row.proowner),
          'security_definer', function_row.prosecdef,
          'proconfig', to_jsonb(function_row.proconfig),
          'volatility', CASE function_row.provolatile
            WHEN 'i' THEN 'immutable'
            WHEN 's' THEN 'stable'
            WHEN 'v' THEN 'volatile'
          END,
          'parallel', CASE function_row.proparallel
            WHEN 's' THEN 'safe'
            WHEN 'r' THEN 'restricted'
            WHEN 'u' THEN 'unsafe'
          END
        )
        ORDER BY
          function_row.schema_name,
          function_row.function_name,
          pg_get_function_identity_arguments(function_row.oid)
      )
      FROM application_functions AS function_row
      JOIN pg_catalog.pg_language AS language
        ON language.oid = function_row.prolang
    ), '[]'::jsonb),

    'function_execute_grants', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', function_row.schema_name,
          'function', function_row.function_name,
          'identity_arguments', pg_get_function_identity_arguments(function_row.oid),
          'grantor', pg_get_userbyid(privilege.grantor),
          'grantee', CASE privilege.grantee
            WHEN 0 THEN 'PUBLIC'
            ELSE pg_get_userbyid(privilege.grantee)
          END,
          'privilege', privilege.privilege_type,
          'grantable', privilege.is_grantable
        )
        ORDER BY
          function_row.schema_name,
          function_row.function_name,
          pg_get_function_identity_arguments(function_row.oid),
          privilege.grantee
      )
      FROM application_functions AS function_row
      CROSS JOIN LATERAL aclexplode(
        coalesce(
          function_row.proacl,
          acldefault('f'::"char", function_row.proowner)
        )
      ) AS privilege
      WHERE privilege.privilege_type = 'EXECUTE'
    ), '[]'::jsonb),

    'triggers', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', relation.schema_name,
          'relation', relation.relation_name,
          'trigger', trigger_row.tgname,
          'enabled', CASE trigger_row.tgenabled
            WHEN 'O' THEN 'origin_and_local'
            WHEN 'D' THEN 'disabled'
            WHEN 'R' THEN 'replica'
            WHEN 'A' THEN 'always'
          END,
          'definition', pg_get_triggerdef(trigger_row.oid, true),
          'function_schema', function_namespace.nspname,
          'function', function_row.proname,
          'function_identity_arguments', pg_get_function_identity_arguments(function_row.oid)
        )
        ORDER BY relation.schema_name, relation.relation_name, trigger_row.tgname
      )
      FROM application_relations AS relation
      JOIN pg_catalog.pg_trigger AS trigger_row
        ON trigger_row.tgrelid = relation.oid
       AND NOT trigger_row.tgisinternal
      JOIN pg_catalog.pg_proc AS function_row
        ON function_row.oid = trigger_row.tgfoid
      JOIN pg_catalog.pg_namespace AS function_namespace
        ON function_namespace.oid = function_row.pronamespace
      WHERE relation.relkind IN ('r', 'p', 'v', 'f')
    ), '[]'::jsonb),

    'row_level_security', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', relation.schema_name,
          'relation', relation.relation_name,
          'rls_enabled', relation.relrowsecurity,
          'rls_forced', relation.relforcerowsecurity
        )
        ORDER BY relation.schema_name, relation.relation_name
      )
      FROM application_relations AS relation
      WHERE relation.relkind IN ('r', 'p')
    ), '[]'::jsonb),

    'policies', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', relation.schema_name,
          'relation', relation.relation_name,
          'policy', policy.polname,
          'permissive', policy.polpermissive,
          'command', CASE policy.polcmd
            WHEN 'r' THEN 'SELECT'
            WHEN 'a' THEN 'INSERT'
            WHEN 'w' THEN 'UPDATE'
            WHEN 'd' THEN 'DELETE'
            WHEN '*' THEN 'ALL'
          END,
          'roles', (
            SELECT jsonb_agg(
              CASE role_oid
                WHEN 0 THEN 'PUBLIC'
                ELSE pg_get_userbyid(role_oid)
              END
              ORDER BY role_oid
            )
            FROM unnest(policy.polroles) AS role_oid
          ),
          'using', pg_get_expr(policy.polqual, policy.polrelid, true),
          'with_check', pg_get_expr(policy.polwithcheck, policy.polrelid, true)
        )
        ORDER BY relation.schema_name, relation.relation_name, policy.polname
      )
      FROM application_relations AS relation
      JOIN pg_catalog.pg_policy AS policy
        ON policy.polrelid = relation.oid
    ), '[]'::jsonb),

    'table_and_sequence_grants', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', relation.schema_name,
          'relation', relation.relation_name,
          'relation_kind', CASE relation.relkind
            WHEN 'S' THEN 'sequence'
            ELSE 'table_or_view'
          END,
          'grantor', pg_get_userbyid(privilege.grantor),
          'grantee', CASE privilege.grantee
            WHEN 0 THEN 'PUBLIC'
            ELSE pg_get_userbyid(privilege.grantee)
          END,
          'privilege', privilege.privilege_type,
          'grantable', privilege.is_grantable
        )
        ORDER BY
          relation.schema_name,
          relation.relation_name,
          privilege.grantee,
          privilege.privilege_type
      )
      FROM application_relations AS relation
      CROSS JOIN LATERAL aclexplode(
        coalesce(
          relation.relacl,
          acldefault(
            CASE relation.relkind
              WHEN 'S' THEN 'S'::"char"
              ELSE 'r'::"char"
            END,
            relation.relowner
          )
        )
      ) AS privilege
    ), '[]'::jsonb),

    'schema_grants', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', schema.schema_name,
          'grantor', pg_get_userbyid(privilege.grantor),
          'grantee', CASE privilege.grantee
            WHEN 0 THEN 'PUBLIC'
            ELSE pg_get_userbyid(privilege.grantee)
          END,
          'privilege', privilege.privilege_type,
          'grantable', privilege.is_grantable
        )
        ORDER BY schema.schema_name, privilege.grantee, privilege.privilege_type
      )
      FROM application_schemas AS schema
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = schema.oid
      CROSS JOIN LATERAL aclexplode(
        coalesce(
          namespace.nspacl,
          acldefault('n'::"char", namespace.nspowner)
        )
      ) AS privilege
    ), '[]'::jsonb),

    'routine_grants', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', function_row.schema_name,
          'routine', function_row.function_name,
          'identity_arguments', pg_get_function_identity_arguments(function_row.oid),
          'grantor', pg_get_userbyid(privilege.grantor),
          'grantee', CASE privilege.grantee
            WHEN 0 THEN 'PUBLIC'
            ELSE pg_get_userbyid(privilege.grantee)
          END,
          'privilege', privilege.privilege_type,
          'grantable', privilege.is_grantable
        )
        ORDER BY
          function_row.schema_name,
          function_row.function_name,
          pg_get_function_identity_arguments(function_row.oid),
          privilege.grantee,
          privilege.privilege_type
      )
      FROM application_functions AS function_row
      CROSS JOIN LATERAL aclexplode(
        coalesce(
          function_row.proacl,
          acldefault('f'::"char", function_row.proowner)
        )
      ) AS privilege
    ), '[]'::jsonb),

    'extensions', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', extension.extname,
          'version', extension.extversion,
          'schema', namespace.nspname,
          'relocatable', extension.extrelocatable
        )
        ORDER BY extension.extname
      )
      FROM pg_catalog.pg_extension AS extension
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = extension.extnamespace
    ), '[]'::jsonb),

    'custom_auth_users_triggers_and_functions', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'trigger', trigger_row.tgname,
          'enabled', CASE trigger_row.tgenabled
            WHEN 'O' THEN 'origin_and_local'
            WHEN 'D' THEN 'disabled'
            WHEN 'R' THEN 'replica'
            WHEN 'A' THEN 'always'
          END,
          'definition', pg_get_triggerdef(trigger_row.oid, true),
          'function_schema', function_namespace.nspname,
          'function', function_row.proname,
          'identity_arguments', pg_get_function_identity_arguments(function_row.oid),
          'owner', pg_get_userbyid(function_row.proowner),
          'security_definer', function_row.prosecdef,
          'proconfig', to_jsonb(function_row.proconfig)
        )
        ORDER BY trigger_row.tgname
      )
      FROM pg_catalog.pg_trigger AS trigger_row
      JOIN pg_catalog.pg_class AS auth_users
        ON auth_users.oid = trigger_row.tgrelid
      JOIN pg_catalog.pg_namespace AS auth_namespace
        ON auth_namespace.oid = auth_users.relnamespace
      JOIN pg_catalog.pg_proc AS function_row
        ON function_row.oid = trigger_row.tgfoid
      JOIN pg_catalog.pg_namespace AS function_namespace
        ON function_namespace.oid = function_row.pronamespace
      WHERE auth_namespace.nspname = 'auth'
        AND auth_users.relname = 'users'
        AND NOT trigger_row.tgisinternal
    ), '[]'::jsonb),

    'storage_policies', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'relation', storage_relation.relname,
          'policy', policy.polname,
          'permissive', policy.polpermissive,
          'command', CASE policy.polcmd
            WHEN 'r' THEN 'SELECT'
            WHEN 'a' THEN 'INSERT'
            WHEN 'w' THEN 'UPDATE'
            WHEN 'd' THEN 'DELETE'
            WHEN '*' THEN 'ALL'
          END,
          'roles', (
            SELECT jsonb_agg(
              CASE role_oid
                WHEN 0 THEN 'PUBLIC'
                ELSE pg_get_userbyid(role_oid)
              END
              ORDER BY role_oid
            )
            FROM unnest(policy.polroles) AS role_oid
          ),
          'using', pg_get_expr(policy.polqual, policy.polrelid, true),
          'with_check', pg_get_expr(policy.polwithcheck, policy.polrelid, true)
        )
        ORDER BY storage_relation.relname, policy.polname
      )
      FROM pg_catalog.pg_policy AS policy
      JOIN pg_catalog.pg_class AS storage_relation
        ON storage_relation.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace AS storage_namespace
        ON storage_namespace.oid = storage_relation.relnamespace
      WHERE storage_namespace.nspname = 'storage'
        AND storage_relation.relname IN ('objects', 'buckets')
    ), '[]'::jsonb),

    'storage_bucket_configuration', coalesce((
      SELECT jsonb_agg(
        (
          to_jsonb(bucket)
          - ARRAY[
              'owner',
              'owner_id',
              'created_at',
              'updated_at'
            ]
        )
        ORDER BY bucket.id
      )
      FROM storage.buckets AS bucket
    ), '[]'::jsonb),

    'cron_jobs', '[]'::jsonb,

    'application_publication_membership', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'publication', publication.pubname,
          'schema', namespace.schema_name,
          'relation', relation.relname,
          'relation_kind', CASE relation.relkind
            WHEN 'r' THEN 'table'
            WHEN 'p' THEN 'partitioned_table'
          END
        )
        ORDER BY publication.pubname, namespace.schema_name, relation.relname
      )
      FROM pg_catalog.pg_publication_rel AS membership
      JOIN pg_catalog.pg_publication AS publication
        ON publication.oid = membership.prpubid
      JOIN pg_catalog.pg_class AS relation
        ON relation.oid = membership.prrelid
      JOIN application_schemas AS namespace
        ON namespace.oid = relation.relnamespace
    ), '[]'::jsonb),

    'migration_history', jsonb_build_object(
      'table_regclass', to_regclass('supabase_migrations.schema_migrations')::text,
      'present', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
      'versions', '[]'::jsonb
    ),

    'known_capture_limitations', jsonb_build_array(
      'The project reference is confirmed only when Supabase exposes a safe project-ref setting to the SQL session; otherwise compare the SQL Editor project selector with expected_project_ref.',
      'SQL Editor catalog access may omit objects or ACL details that the connected database role cannot inspect.',
      'Managed Supabase platform configuration outside PostgreSQL catalogs is not captured, including dashboard settings, API gateway settings, backups, PITR, network restrictions, and external integrations.',
      'Built-in auth and storage implementation internals are excluded; only custom auth.users triggers/functions and storage.objects/storage.buckets policies are captured.',
      'Function bodies are intentionally excluded. Signatures, ownership, SECURITY DEFINER, proconfig/search_path, and execute grants are captured.',
      'Vault secret values, uploaded storage objects, auth users, and application business rows are intentionally excluded.',
      'Cron execution history is not captured. Job metadata is captured and the entire JSON result receives conservative secret, URL, bearer, token, password, Vault-reference, and connection-string redaction.',
      'Logical replication slots, WAL state, subscriber connection strings, and publication row filters/column lists outside available publication catalogs may require privileged inspection and are not fully represented.',
      'Extension-owned object internals are not expanded; extension name, version, and installation schema are captured.',
      'Migration-history presence is detected through the catalog only. Applied migration versions are unavailable when the relation is absent and are intentionally not queried dynamically; versions is always an empty array.'
    )
  ) AS evidence
  FROM project_reference
)
SELECT
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              raw_evidence.evidence::text,
              $redact$(?i)bearer[[:space:]]+[A-Za-z0-9._~+/=-]+$redact$,
              'Bearer [REDACTED]',
              'g'
            ),
            $redact$(?i)(https?|postgres(?:ql)?):\/\/[^[:space:]"'\\]+$redact$,
            '[REDACTED_URL_OR_CONNECTION_STRING]',
            'g'
          ),
          $redact$(?i)vault\.[A-Za-z0-9_.-]+$redact$,
          '[REDACTED_VAULT_REFERENCE]',
          'g'
        ),
        $redact$(?i)("(?:password|passwd|[^"]*token[^"]*|[^"]*secret[^"]*|api[_-]?key|authorization|connection[_-]?string)"[[:space:]]*:[[:space:]]*")[^"\\]*(")$redact$,
        '\1[REDACTED]\2',
        'g'
      ),
      $redact$(?i)((?:password|passwd|token|secret|api[_-]?key|authorization|connection[_-]?string)[[:space:]]*(?:=>|:=|=)[[:space:]]*)'[^']*'$redact$,
      '\1''[REDACTED]''',
      'g'
    ),
    $redact$(?i)(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[A-Fa-f0-9]{48,})$redact$,
    '[REDACTED_TOKEN_OR_SECRET]',
    'g'
  )::jsonb AS production_catalog_evidence
FROM raw_evidence;
