import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/202607210011_d1_employee_catalog_baseline.sql',
  import.meta.url,
);
const k8MigrationUrl = new URL(
  '../supabase/migrations/202607210002_fix_k8_create_task_rpc_ambiguous_columns.sql',
  import.meta.url,
);

async function sources() {
  const [migration, k8] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(k8MigrationUrl, 'utf8'),
  ]);
  return { migration, k8 };
}

function executableSql(sql) {
  return sql.replace(/^\s*--.*$/gm, '');
}

test('migration 011 creates exactly one versioned server-only checkpoint structure', async () => {
  const { migration } = await sources();
  assert.match(migration, /CREATE TABLE public\.d1_employee_migration_checkpoints/);
  assert.match(migration, /migration_name text PRIMARY KEY/);
  assert.match(migration, /baseline_version integer NOT NULL CHECK \(baseline_version = 1\)/);
  assert.match(migration, /catalog_fingerprint text NOT NULL CHECK \(catalog_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(migration, /aggregate_counts jsonb NOT NULL CHECK \(jsonb_typeof\(aggregate_counts\) = 'object'\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.d1_employee_migration_checkpoints\s+FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.d1_employee_migration_checkpoints\s+TO service_role/);
  assert.doesNotMatch(executableSql(migration), /GRANT (?:UPDATE|DELETE|TRUNCATE)[^;]*d1_employee_migration_checkpoints/i);
});

test('migration fails closed unless migration 010 security outcomes remain intact', async () => {
  const { migration } = await sources();
  assert.match(migration, /D1_011_MIGRATION_010_ANON_GRANT_REGRESSION/);
  assert.match(migration, /D1_011_MIGRATION_010_POLICY_REGRESSION/);
  assert.match(migration, /D1_011_AUTHENTICATED_COMPANY_POLICY_MISSING/);
  assert.match(migration, /g\.grantee = 'anon'/);
  assert.match(migration, /FOREACH v_command IN ARRAY ARRAY\['r', 'a', 'w', 'd'\]/);
  assert.match(migration, /c\.relrowsecurity/);
});

test('baseline rejects reconstructed migration history, missing required objects, and unavailable SHA-256', async () => {
  const { migration } = await sources();
  assert.match(migration, /to_regclass\('supabase_migrations\.schema_migrations'\) IS NOT NULL/);
  assert.match(migration, /D1_011_UNEXPECTED_STANDARD_MIGRATION_HISTORY/);
  assert.match(migration, /D1_011_REQUIRED_RELATION_MISSING/);
  assert.match(migration, /to_regprocedure\('extensions\.digest\(bytea,text\)'\) IS NULL/);
  assert.match(migration, /D1_011_SHA256_DIGEST_UNAVAILABLE/);
  for (const relation of [
    'auth.users', 'public.companies', 'public.profiles', 'public.employees',
    'public.tasks', 'public.brain_action_proposals', 'public.brain_domain_events',
    'public.brain_event_outbox',
  ]) assert.match(migration, new RegExp(relation.replace('.', '\\.')));
});

test('fingerprint deterministically covers structural metadata without function bodies or row values', async () => {
  const { migration } = await sources();
  for (const section of [
    "'relations'", "'columns'", "'constraints'", "'indexes'", "'policies'",
    "'table_grants'", "'functions'", "'routine_grants'",
  ]) assert.match(migration, new RegExp(section));
  assert.match(migration, /jsonb_agg\([^;]+ORDER BY/s);
  assert.match(migration, /extensions\.digest\(convert_to\(catalog_evidence\.evidence::text, 'UTF8'\), 'sha256'\)/);
  assert.doesNotMatch(migration, /pg_get_functiondef/i);
  assert.doesNotMatch(migration, /SELECT\s+(?:first_name|last_name|email|phone|salary|notes)\b/i);
});

test('aggregate evidence contains counts and grouped vocabularies but no personal employee values', async () => {
  const { migration } = await sources();
  assert.match(migration, /'employee_status_counts'/);
  assert.match(migration, /'employment_type_counts'/);
  assert.match(migration, /coalesce\(e\.status, '__null__'\)/);
  assert.match(migration, /coalesce\(e\.employment_type, '__null__'\)/);
  assert.match(migration, /'duplicate_employee_links'/);
  assert.match(migration, /'profile_employee_tenant_mismatches'/);
  assert.match(migration, /'migration_010_validated', true/);
  assert.doesNotMatch(migration, /jsonb_build_object\([^;]*(?:first_name|last_name|email|phone|salary|notes)/i);
});

test('one immutable approved checkpoint is inserted and postconditions validate it', async () => {
  const { migration } = await sources();
  assert.equal((migration.match(/INSERT INTO public\.d1_employee_migration_checkpoints/g) ?? []).length, 1);
  assert.match(migration, /'202607210011_d1_employee_catalog_baseline'/);
  assert.match(migration, /'D1_2E_FINAL_IMPLEMENTATION_SPECIFICATION\.md \(approved\)'/);
  assert.match(migration, /D1_011_CHECKPOINT_CARDINALITY_INVALID/);
  assert.match(migration, /D1_011_CHECKPOINT_POSTCONDITION_FAILED/);
  assert.match(migration, /D1_011_CHECKPOINT_GRANT_POSTCONDITION_FAILED/);
  assert.doesNotMatch(executableSql(migration), /UPDATE public\.d1_employee_migration_checkpoints|DELETE FROM public\.d1_employee_migration_checkpoints/i);
});

test('K8 create_task signature, security, grants, and forced-RLS kernel tables are preflight invariants', async () => {
  const { migration, k8 } = await sources();
  const signature = /create_task_with_outbox_event\(uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,uuid,text,integer,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz\)/;
  assert.match(migration, signature);
  assert.match(migration, /p\.prosecdef/);
  assert.match(migration, /search_path=public, pg_temp/);
  assert.match(migration, /has_function_privilege\('service_role'/);
  assert.match(migration, /has_function_privilege\('anon'/);
  assert.match(migration, /has_function_privilege\('authenticated'/);
  assert.match(migration, /D1_011_KERNEL_RLS_SECURITY_DRIFT/);
  assert.match(k8, /CREATE OR REPLACE FUNCTION public\.create_task_with_outbox_event/);
  assert.doesNotMatch(executableSql(migration), /CREATE OR REPLACE FUNCTION public\.create_task_with_outbox_event|ALTER TABLE public\.tasks|INSERT INTO public\.tasks/i);
});

test('migration is transactional, preserves existing rows, and documents validation and safe recovery', async () => {
  const { migration } = await sources();
  const executable = executableSql(migration);
  assert.match(migration, /^-- D1\.2E migration 011/);
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
  assert.match(migration, /Post-deployment validation \(read-only/);
  assert.match(migration, /Safe rollback\/recovery:/);
  assert.doesNotMatch(executable, /\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:TABLE\s+|FROM\s+)?public\./i);
  assert.doesNotMatch(executable, /ALTER TABLE public\.(?!d1_employee_migration_checkpoints)/i);
  assert.doesNotMatch(executable, /CREATE TABLE public\.(?!d1_employee_migration_checkpoints)/i);
});
