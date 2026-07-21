import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/202607210012_d1_employee_foundation_expand.sql',
  import.meta.url,
);

const k8MigrationUrl = new URL(
  '../supabase/migrations/202607210002_fix_k8_create_task_rpc_ambiguous_columns.sql',
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
  assert.match(migration, /D1_012_TARGET_(?:COLUMN|OBJECT|CONSTRAINT)_ALREADY_EXISTS/);
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
  assert.match(table, /id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
  assert.match(table, /field_name IN \('status', 'employment_type', 'role', 'department'\)/);
  assert.match(table, /source_value_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(table, /resolution_status IN \('pending', 'approved', 'rejected'\)/);
  assert.match(table, /UNIQUE \(employee_id, field_name\)/);
  assert.match(table, /FOREIGN KEY \(company_id, employee_id\)[\s\S]+REFERENCES public\.employees\(company_id, id\)[\s\S]+ON DELETE RESTRICT/);
  assert.match(table, /reviewed_by_profile_id uuid[\s\S]+REFERENCES public\.profiles\(id\)[\s\S]+ON DELETE RESTRICT/);
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
  assert.match(backfill, /lifecycle_effective_at = coalesce\(employee\.updated_at, employee\.created_at\)/);
  const setClause = backfill.slice(
    backfill.indexOf('SET'),
    backfill.indexOf('WHERE'),
  );
  assert.doesNotMatch(setClause, /\b(?:employee\.)?status\s*=/i);
  assert.doesNotMatch(backfill, /employment_type\s*=|role\s*=|department\s*=/i);
  assert.equal((executableSql(migration).match(/UPDATE public\.employees/g) ?? []).length, 1);
  assert.match(migration, /employee\.lifecycle_effective_at IS NULL/);
  assert.match(migration, /employee\.lifecycle_effective_at > employee\.updated_at/);
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
    'canonical_backfill_exact_and_legacy_unchanged',
    'exception_table_service_role_exact_privileges',
    'migration_010_protections_remain_valid',
    'k8_exact_rpc_contract_unchanged',
  ]) assert.match(verification, new RegExp(`'${check}'`));
});
