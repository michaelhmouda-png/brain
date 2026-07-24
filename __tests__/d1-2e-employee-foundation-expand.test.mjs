import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migration_audit/pre_baseline_20260724/202607210012_d1_employee_foundation_expand.sql',
  import.meta.url,
);

const k8MigrationUrl = new URL(
  '../supabase/migration_audit/pre_baseline_20260724/202607210002_fix_k8_create_task_rpc_ambiguous_columns.sql',
  import.meta.url,
);

const verificationUrl = new URL(
  '../D1_2E_MIGRATION_012_POST_DEPLOYMENT_VERIFICATION.sql',
  import.meta.url,
);

async function sources() {
  const [migration, k8, verification] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(k8MigrationUrl, 'utf8'),
    readFile(verificationUrl, 'utf8'),
  ]);
  return { migration, k8, verification };
}

function executableSql(sql) {
  return sql.replace(/^\s*--.*$/gm, '');
}

test('migration 012 is one transaction and fails closed against the accepted production baseline', async () => {
  const { migration } = await sources();
  assert.match(migration, /^-- D1\.2E migration 012/);
  assert.equal((migration.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((migration.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.match(migration, /D1_012_ACCEPTED_CHECKPOINT_DRIFT/);
  assert.match(migration, /1fdf16c9af0cba0bd7b76de8dffba5acc5bd5427a4dec704675d665f83e73a99/);
  assert.match(migration, /D1_012_EMPLOYEE_STATUS_EVIDENCE_DRIFT/);
  assert.match(migration, /\(SELECT count\(\*\) FROM public\.employees\) <> 6/);
  assert.match(migration, /employee\.status IS DISTINCT FROM 'active'/);
  assert.match(migration, /D1_012_EMPLOYEE_VOCABULARY_EVIDENCE_DRIFT/);
  assert.match(migration, /'\{"full-time": 5, "full time": 1\}'::jsonb/);
  assert.match(migration, /'\{"employee": 1, "manager": 2, "owner": 2, "Owner": 1\}'::jsonb/);
  assert.match(migration, /'\{"Floor": 1, "General": 2, "management": 2, "Waiter": 1\}'::jsonb/);
  assert.match(migration, /D1_012_TARGET_(?:COLUMN|OBJECT|CONSTRAINT)_ALREADY_EXISTS/);
});

test('updated_at trigger is intentionally retained and verified before the backfill', async () => {
  const { migration } = await sources();
  assert.match(migration, /updated_at policy \(Revision 2\)/);
  assert.match(migration, /trigger_row\.tgname = 'employees_update_timestamp'/);
  assert.match(migration, /trigger_row\.tgenabled = 'O'/);
  assert.match(migration, /trigger_row\.tgtype = 19/);
  assert.match(migration, /procedure\.proname = 'update_timestamp'/);
  assert.match(migration, /'beginnew\.updated_at=now\(\);returnnew;end;'/);
  assert.match(migration, /D1_012_EMPLOYEE_UPDATED_AT_TRIGGER_DRIFT/);
  assert.match(migration, /D1_012_EMPLOYEE_UPDATED_AT_IN_FUTURE/);
  assert.doesNotMatch(executableSql(migration), /DISABLE TRIGGER|DROP TRIGGER|CREATE OR REPLACE FUNCTION public\.update_timestamp/i);
});

test('transaction-local snapshot proves UUID, tenant, and every approved legacy field are preserved', async () => {
  const { migration } = await sources();
  const snapshot = migration.match(/CREATE TEMPORARY TABLE pg_temp\.d1_012_employee_before[\s\S]+?FROM public\.employees AS employee;/)?.[0];
  assert.ok(snapshot);
  for (const field of [
    'id', 'company_id', 'status', 'employment_type', 'role', 'department',
    'first_name', 'last_name', 'location_id', 'department_id', 'hire_date',
    'email', 'phone', 'notes', 'salary', 'created_at', 'updated_at',
  ]) assert.match(snapshot, new RegExp(`employee\\.${field}`));
  assert.match(migration, /FULL JOIN public\.employees AS employee ON employee\.id = before_row\.id/);
  for (const field of [
    'company_id', 'status', 'employment_type', 'role', 'department', 'first_name',
    'last_name', 'location_id', 'department_id', 'hire_date', 'email', 'phone',
    'notes', 'salary', 'created_at',
  ]) assert.match(migration, new RegExp(`employee\\.${field} IS DISTINCT FROM before_row\\.${field}`));
  assert.match(migration, /employee\.lifecycle_effective_at IS DISTINCT FROM before_row\.updated_at/);
  assert.match(migration, /employee\.updated_at < before_row\.updated_at/);
  assert.match(migration, /employee\.updated_at IS DISTINCT FROM CURRENT_TIMESTAMP/);
  assert.match(migration, /D1_012_EMPLOYEE_LEGACY_PRESERVATION_FAILED/);
});

test('temporary snapshot is consistently pg_temp-qualified and survives until postconditions', async () => {
  const { migration } = await sources();
  const executable = executableSql(migration);
  const createPosition = executable.indexOf('CREATE TEMPORARY TABLE pg_temp.d1_012_employee_before');
  const snapshotCheckPosition = executable.indexOf("to_regclass('pg_temp.d1_012_employee_before')");
  const legacyPostconditionPosition = executable.indexOf('FROM pg_temp.d1_012_employee_before AS before_row');
  const commitPosition = executable.lastIndexOf('COMMIT;');

  assert.ok(createPosition > executable.indexOf('BEGIN;'));
  assert.ok(snapshotCheckPosition > createPosition);
  assert.ok(legacyPostconditionPosition > snapshotCheckPosition);
  assert.ok(commitPosition > legacyPostconditionPosition);
  assert.match(executable, /CREATE TEMPORARY TABLE pg_temp\.d1_012_employee_before\s+ON COMMIT DROP\s+AS/);
  assert.match(executable, /D1_012_EMPLOYEE_SNAPSHOT_UNAVAILABLE/);
  assert.doesNotMatch(executable, /(?<!pg_temp\.)\bd1_012_employee_before\b/);
  assert.doesNotMatch(executable, /EXECUTE\s+[^;]*d1_012_employee_before/i);
});

test('employee foundation columns are additive with the approved nullability and default', async () => {
  const { migration } = await sources();
  const alter = migration.match(
    /ALTER TABLE public\.employees\s+ADD COLUMN employee_number[\s\S]+?ADD COLUMN termination_reason_code text;/,
  )?.[0];
  assert.ok(alter);
  assert.match(alter, /ADD COLUMN employee_number text/);
  assert.match(alter, /ADD COLUMN lifecycle_status text/);
  assert.match(alter, /ADD COLUMN version bigint NOT NULL DEFAULT 1/);
  assert.match(alter, /ADD COLUMN lifecycle_effective_at timestamptz/);
  assert.match(alter, /ADD COLUMN archived_at timestamptz/);
  assert.match(alter, /ADD COLUMN archived_by_profile_id uuid/);
  assert.match(alter, /ADD COLUMN termination_reason_code text/);
  assert.doesNotMatch(alter, /employee_number text NOT NULL|lifecycle_status text NOT NULL/);
});

test('canonical lifecycle, version, archive shape, and restrictive profile reference are enforced', async () => {
  const { migration } = await sources();
  for (const value of ['draft', 'active', 'on_leave', 'inactive', 'terminated', 'archived']) {
    assert.match(migration, new RegExp(`'${value}'`));
  }
  assert.match(migration, /employees_lifecycle_status_check/);
  assert.match(migration, /lifecycle_status IS NULL/);
  assert.match(migration, /employees_version_positive[\s\S]+CHECK \(version > 0\)/);
  assert.match(migration, /employees_archive_shape[\s\S]+lifecycle_status IS DISTINCT FROM 'archived'[\s\S]+archived_at IS NOT NULL/);
  assert.match(migration, /employees_archived_by_profile_id_fkey[\s\S]+REFERENCES public\.profiles\(id\)[\s\S]+ON DELETE RESTRICT/);
  for (const constraint of [
    'employees_lifecycle_status_check',
    'employees_version_positive',
    'employees_archive_shape',
  ]) assert.match(migration, new RegExp(`VALIDATE CONSTRAINT ${constraint}`));
});

test('tenant identity and nullable employee-number uniqueness indexes are exact', async () => {
  const { migration } = await sources();
  assert.match(
    migration,
    /CREATE UNIQUE INDEX employees_company_id_id_uidx\s+ON public\.employees\(company_id, id\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX employees_company_employee_number_uidx\s+ON public\.employees\(company_id, employee_number\)\s+WHERE employee_number IS NOT NULL/,
  );
  assert.doesNotMatch(migration, /SET\s+employee_number\s*=/i);
});

test('exception register stores only controlled hashes and has restrictive relationship semantics', async () => {
  const { migration } = await sources();
  const table = migration.match(
    /CREATE TABLE public\.employee_migration_exceptions \([\s\S]+?\n\);/,
  )?.[0];
  assert.ok(table);
  assert.match(table, /id uuid NOT NULL DEFAULT gen_random_uuid\(\)/);
  assert.match(table, /CONSTRAINT employee_migration_exceptions_pkey\s+PRIMARY KEY \(id\)/);
  assert.match(table, /field_name IN \('status', 'employment_type', 'role', 'department'\)/);
  assert.match(table, /source_value_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(table, /resolution_status IN \('pending', 'approved', 'rejected'\)/);
  assert.match(table, /UNIQUE \(employee_id, field_name\)/);
  assert.match(table, /FOREIGN KEY \(company_id, employee_id\)[\s\S]+REFERENCES public\.employees\(company_id, id\)[\s\S]+ON DELETE RESTRICT/);
  assert.match(table, /reviewed_by_profile_id uuid[\s\S]+REFERENCES public\.profiles\(id\)[\s\S]+ON DELETE RESTRICT/);
  for (const constraint of [
    'employee_migration_exceptions_pkey',
    'employee_migration_exceptions_employee_field_key',
    'employee_migration_exceptions_employee_company_fkey',
    'employee_migration_exceptions_reviewed_by_profile_id_fkey',
    'employee_migration_exceptions_field_name_check',
    'employee_migration_exceptions_source_value_hash_check',
    'employee_migration_exceptions_resolution_status_check',
  ]) assert.match(table, new RegExp(`CONSTRAINT ${constraint}`));
  assert.doesNotMatch(table, /employee_migration_exceptions_review_shape_check/);
  assert.doesNotMatch(table, /first_name|last_name|email|phone|salary|notes|source_value text/i);
});

test('exception register has forced RLS, no policies, and exact service-role privileges', async () => {
  const { migration } = await sources();
  const executable = executableSql(migration);
  assert.match(migration, /ALTER TABLE public\.employee_migration_exceptions ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE public\.employee_migration_exceptions FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.employee_migration_exceptions\s+FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.employee_migration_exceptions\s+FROM service_role/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.employee_migration_exceptions\s+TO service_role/);
  assert.doesNotMatch(executable, /CREATE POLICY[^;]*employee_migration_exceptions/i);
  assert.doesNotMatch(executable, /GRANT (?:ALL|DELETE|TRUNCATE|REFERENCES|TRIGGER)[^;]*employee_migration_exceptions[^;]*service_role/i);
  assert.match(migration, /D1_012_EXCEPTION_GRANT_POSTCONDITION_FAILED/);
});

test('backfill maps only exact active and preserves all legacy vocabulary fields', async () => {
  const { migration } = await sources();
  const backfill = migration.match(
    /UPDATE public\.employees AS employee[\s\S]+?WHERE employee\.status = 'active'[\s\S]+?;/,
  )?.[0];
  assert.ok(backfill);
  assert.match(backfill, /lifecycle_status = 'active'/);
  assert.match(backfill, /lifecycle_effective_at = employee\.updated_at/);
  const setClause = backfill.slice(
    backfill.indexOf('SET'),
    backfill.indexOf('WHERE'),
  );
  assert.doesNotMatch(setClause, /\b(?:employee\.)?status\s*=/i);
  assert.doesNotMatch(backfill, /employment_type\s*=|role\s*=|department\s*=/i);
  assert.equal((executableSql(migration).match(/UPDATE public\.employees/g) ?? []).length, 1);
  assert.match(migration, /employee\.lifecycle_effective_at IS NULL/);
  assert.match(migration, /employee\.lifecycle_effective_at > employee\.updated_at/);
  assert.match(migration, /employee\.lifecycle_effective_at IS DISTINCT FROM before_row\.updated_at/);
});

test('unresolved status handling is hashed, unique, and never stores raw source text', async () => {
  const { migration } = await sources();
  const insert = migration.match(
    /INSERT INTO public\.employee_migration_exceptions[\s\S]+?ON CONFLICT \(employee_id, field_name\) DO NOTHING;/,
  )?.[0];
  assert.ok(insert);
  assert.match(insert, /employee\.status IS DISTINCT FROM 'active'/);
  assert.match(insert, /extensions\.digest\(convert_to\(employee\.status, 'UTF8'\), 'sha256'\)/);
  assert.doesNotMatch(insert, /source_value[^_]|first_name|last_name|email|phone|salary|notes/i);
});

test('migration preserves employee authorization, surrounding domains, and K8 contract', async () => {
  const { migration, k8 } = await sources();
  const executable = executableSql(migration);
  assert.doesNotMatch(executable, /(?:CREATE|ALTER|DROP) POLICY/i);
  assert.doesNotMatch(executable, /(?:GRANT|REVOKE)[^;]+ON TABLE public\.employees/i);
  assert.doesNotMatch(executable, /ALTER TABLE public\.(?:tasks|profiles|shifts|attendance_records|notifications|brain_action_proposals|brain_domain_events|brain_event_outbox)/i);
  assert.doesNotMatch(executable, /CREATE OR REPLACE FUNCTION public\.create_task_with_outbox_event/i);
  assert.match(migration, /D1_012_K8_RPC_CONTRACT_DRIFT/);
  assert.match(k8, /CREATE OR REPLACE FUNCTION public\.create_task_with_outbox_event/);
  assert.match(k8, /INSERT INTO public\.tasks/);
  assert.match(k8, /INSERT INTO public\.brain_event_outbox/);
});

test('postconditions and recovery guidance fail closed without destructive rollback', async () => {
  const { migration } = await sources();
  const executable = executableSql(migration);
  assert.match(migration, /D1_012_CANONICAL_BACKFILL_POSTCONDITION_FAILED/);
  assert.match(migration, /D1_012_UNEXPECTED_EXCEPTION_ROW/);
  assert.match(migration, /D1_012_EXCEPTION_RLS_POSTCONDITION_FAILED/);
  assert.match(migration, /D1_012_EMPLOYEE_CONSTRAINT_NOT_VALIDATED/);
  assert.match(migration, /Safe rollback\/recovery:/);
  assert.doesNotMatch(executable, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM public\./i);
});

test('post-deployment verification is one SELECT-only statement with explicit check columns', async () => {
  const { verification } = await sources();
  const executable = executableSql(verification).trim();
  assert.match(executable, /^WITH\s/i);
  assert.match(executable, /checks\(check_name, passed, details\) AS \(/);
  assert.match(executable, /'details', verification\.details/);
  assert.equal((executable.match(/;\s*$/g) ?? []).length, 1);
  assert.doesNotMatch(
    executable,
    /\b(?:INSERT\s+INTO|UPDATE\s+[a-z"']|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE\s+(?:TABLE\s+)?[a-z"']|ALTER\s+(?:TABLE|FUNCTION|POLICY)|CREATE\s+(?:TABLE|FUNCTION|POLICY|INDEX)|DROP\s+(?:TABLE|FUNCTION|POLICY|INDEX)|GRANT\s+\w+\s+ON|REVOKE\s+\w+\s+ON|CALL\s+\w+|DO\s+\$|COPY\s+\w+\s+TO)\b/i,
  );
  for (const check of [
    'employee_updated_at_trigger_expected_and_enabled',
    'employee_identity_and_company_relationships_preserved',
    'legacy_business_fields_preserved_by_atomic_snapshot',
    'legacy_vocabularies_exactly_preserved',
    'canonical_backfill_exact_and_legacy_unchanged',
    'exception_table_service_role_exact_privileges',
    'exception_table_contract_complete',
    'migration_010_protections_remain_valid',
    'k8_exact_rpc_contract_unchanged',
  ]) assert.match(verification, new RegExp(`'${check}'`));

  assert.match(verification, /employee_company_identity_set_hash/);
  assert.match(verification, /legacy_business_field_set_hash/);
  assert.doesNotMatch(verification, /jsonb_agg\([^)]*(?:first_name|last_name|email|phone|notes|salary)/i);
  assert.match(verification, /status_counts = '\{"active": 6\}'::jsonb/);
  assert.match(verification, /employment_type_counts = '\{"full-time": 5, "full time": 1\}'::jsonb/);
  assert.match(verification, /role_counts = '\{"employee": 1, "manager": 2, "owner": 2, "Owner": 1\}'::jsonb/);
  assert.match(verification, /department_counts = '\{"Floor": 1, "General": 2, "management": 2, "Waiter": 1\}'::jsonb/);
  assert.match(verification, /lifecycle_effective_count = 6/);
  assert.match(verification, /updated_at_at_or_after_lifecycle_count = 6/);
  assert.match(verification, /version_one_count = 6/);
  assert.match(verification, /ARRAY\['company_id', 'id'\]::name\[\]/);
  assert.match(verification, /ARRAY\['company_id', 'employee_number'\]::name\[\]/);
  assert.match(verification, /employee_numberISNOTNULL/);
  for (const constraint of [
    'employees_lifecycle_status_check',
    'employees_version_positive',
    'employees_archive_shape',
    'employees_archived_by_profile_id_fkey',
    'employee_migration_exceptions_pkey',
    'employee_migration_exceptions_employee_field_key',
    'employee_migration_exceptions_employee_company_fkey',
    'employee_migration_exceptions_reviewed_by_profile_id_fkey',
    'employee_migration_exceptions_field_name_check',
    'employee_migration_exceptions_source_value_hash_check',
    'employee_migration_exceptions_resolution_status_check',
  ]) assert.match(verification, new RegExp(constraint));
});
