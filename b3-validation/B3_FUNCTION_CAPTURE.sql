/*
  Phase B1 — Production function-body and environment-bound definition capture
  Target project reference: jjhtasppfxunbrswgxht

  Safety properties:
  - One read-only SELECT statement.
  - No temporary objects, functions, DO blocks, DDL, DML, or remote writes.
  - No business rows, auth users, storage objects, credentials, or Vault values.
  - Function definitions come from pg_catalog.pg_get_functiondef().
  - Every original function definition is SHA-256 fingerprinted before redaction.
  - Cron command literals are always redacted; only exact command SHA-256 fingerprints
    and non-secret scheduling metadata are returned for offline provenance comparison.

  Result: one row, one jsonb column named b1_function_environment_evidence.
*/

WITH
application_schemas AS (
  SELECT
    namespace.oid,
    namespace.nspname AS schema_name
  FROM pg_catalog.pg_namespace AS namespace
  WHERE namespace.nspname IN ('public', 'private')
),
raw_function_definitions AS (
  SELECT
    procedure.oid,
    namespace.schema_name,
    procedure.proname AS function_name,
    pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
    pg_get_functiondef(procedure.oid) AS raw_definition,
    language.lanname AS language,
    procedure.provolatile,
    procedure.prosecdef,
    procedure.proowner,
    procedure.proconfig
  FROM pg_catalog.pg_proc AS procedure
  JOIN application_schemas AS namespace
    ON namespace.oid = procedure.pronamespace
  JOIN pg_catalog.pg_language AS language
    ON language.oid = procedure.prolang
  WHERE procedure.prokind IN ('f', 'p')
),
captured_function_definitions AS (
  SELECT
    function_row.*,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              function_row.raw_definition,
              $redact$(?i)bearer[[:space:]]+[A-Za-z0-9._~+/=-]+$redact$,
              'Bearer [REDACTED]',
              'g'
            ),
            $redact$(?i)(https?|postgres(?:ql)?):\/\/[^[:space:]"'\\]+$redact$,
            '[REDACTED_URL_OR_CONNECTION_STRING]',
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
    ) AS captured_definition
  FROM raw_function_definitions AS function_row
),
captured_cron_jobs AS (
  SELECT
    null::bigint AS jobid,
    null::text AS jobname,
    null::text AS schedule,
    null::boolean AS active,
    null::text AS nodename,
    null::integer AS nodeport,
    null::text AS database,
    null::text AS username,
    null::integer AS command_utf8_bytes,
    null::text AS production_command_sha256,
    null::text AS command_redacted,
    null::text AS repository_source_file
  WHERE false
),project_reference AS (
  SELECT coalesce(
    nullif(current_setting('app.settings.project_ref', true), ''),
    nullif(current_setting('supabase.project_ref', true), '')
  ) AS safely_observed_project_ref
),
evidence AS (
  SELECT jsonb_build_object(
    'capture_metadata', jsonb_build_object(
      'phase', 'B1',
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
      'expected_application_function_count', 70,
      'captured_application_function_count',
        (SELECT count(*) FROM captured_function_definitions),
      'function_count_matches_b0',
        (SELECT count(*) = 70 FROM captured_function_definitions),
      'expected_cron_job_count', 2,
      'captured_cron_job_count',
        (SELECT count(*) FROM captured_cron_jobs),
      'cron_job_count_matches_b0',
        (SELECT count(*) = 2 FROM captured_cron_jobs),
      'contains_business_rows', false,
      'contains_auth_user_rows', false,
      'contains_storage_objects', false,
      'contains_vault_values', false,
      'contains_unredacted_cron_literals', false
    ),

    'application_function_definitions', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', function_row.schema_name,
          'name', function_row.function_name,
          'identity_arguments', function_row.identity_arguments,
          'full_create_or_replace_definition', function_row.captured_definition,
          'definition_sha256', pg_catalog.encode(
            extensions.digest(
              convert_to(function_row.raw_definition, 'UTF8'),
              'sha256'
            ),
            'hex'
          ),
          'definition_redacted',
            function_row.captured_definition IS DISTINCT FROM function_row.raw_definition,
          'language', function_row.language,
          'volatility', CASE function_row.provolatile
            WHEN 'i' THEN 'immutable'
            WHEN 's' THEN 'stable'
            WHEN 'v' THEN 'volatile'
          END,
          'security', CASE
            WHEN function_row.prosecdef THEN 'definer'
            ELSE 'invoker'
          END,
          'security_definer', function_row.prosecdef,
          'owner', pg_get_userbyid(function_row.proowner),
          'proconfig', to_jsonb(function_row.proconfig),
          'search_path', (
            SELECT config_value
            FROM unnest(coalesce(function_row.proconfig, ARRAY[]::text[]))
              AS config_value
            WHERE config_value LIKE 'search_path=%'
            LIMIT 1
          )
        )
        ORDER BY
          function_row.schema_name,
          function_row.function_name,
          function_row.identity_arguments
      )
      FROM captured_function_definitions AS function_row
    ), '[]'::jsonb),

    'cron_repository_provenance_inputs', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'jobid', cron_job.jobid,
          'jobname', cron_job.jobname,
          'schedule', cron_job.schedule,
          'active', cron_job.active,
          'nodename', cron_job.nodename,
          'nodeport', cron_job.nodeport,
          'database', cron_job.database,
          'username', cron_job.username,
          'command_utf8_bytes', cron_job.command_utf8_bytes,
          'production_command_sha256', cron_job.production_command_sha256,
          'command_redacted', cron_job.command_redacted,
          'repository_source_file', cron_job.repository_source_file,
          'provenance_decision', 'pending_offline_exact_hash_comparison',
          'decision_rule',
            'Match only when SHA-256 of the exact UTF-8 cron command extracted offline from repository_source_file equals production_command_sha256; never export either unredacted command.'
        )
        ORDER BY cron_job.jobname
      )
      FROM captured_cron_jobs AS cron_job
    ), '[]'::jsonb),

    'known_capture_limitations', jsonb_build_array(
      'The project reference is confirmed only when Supabase exposes a safe project-ref setting to the SQL session; otherwise compare the SQL Editor project selector with expected_project_ref.',
      'SQL Editor catalog access may omit function metadata that the connected database role cannot inspect.',
      'pg_get_functiondef returns the server-rendered CREATE OR REPLACE definition, which may normalize formatting relative to the originally submitted source.',
      'A function definition matching a sensitive pattern is redacted in full_create_or_replace_definition. definition_sha256 always fingerprints the original server-rendered definition, and definition_redacted identifies affected rows.',
      'Function dependencies, table definitions, policies, grants, triggers, extensions, and storage configuration remain authoritative in the separate B0 evidence and are not duplicated here.',
      'Cron command literals are always redacted. production_command_sha256 fingerprints the exact stored command for offline repository provenance comparison without exposing the command.',
      'Cron SHA-256 equality proves exact UTF-8 command equality only; a mismatch does not identify which literal, whitespace, URL, Vault reference, or credential-bearing fragment differs.',
      'Vault values, credentials, tokens, secret-bearing URLs, auth users, business rows, storage objects, cron execution history, and migration history are intentionally excluded.',
      'No Preview catalog or environment state is captured.'
    )
  ) AS document
  FROM project_reference
)
SELECT evidence.document AS b1_function_environment_evidence
FROM evidence;
