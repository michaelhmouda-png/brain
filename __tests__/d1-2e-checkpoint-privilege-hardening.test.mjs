import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/202607210011a_d1_employee_checkpoint_service_role_privilege_hardening.sql',
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

test('approved contract retains only SELECT and INSERT for service_role', async () => {
  const { migration } = await sources();
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.d1_employee_migration_checkpoints FROM service_role/);
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.d1_employee_migration_checkpoints TO service_role/);
  assert.match(migration, /count\(\*\)[\s\S]+g\.grantee = 'service_role'[\s\S]+<> 2/);
  assert.match(migration, /g\.privilege_type = 'SELECT'/);
  assert.match(migration, /g\.privilege_type = 'INSERT'/);
  assert.doesNotMatch(migration, /GRANT (?:UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)[^;]+service_role/i);
});

test('ordinary roles retain zero checkpoint access and no RLS policy is added', async () => {
  const { migration } = await sources();
  const executable = executableSql(migration);
  assert.match(migration, /D1_011A_UNEXPECTED_ORDINARY_ROLE_GRANT/);
  assert.match(migration, /D1_011A_ORDINARY_ROLE_GRANT_POSTCONDITION_FAILED/);
  assert.match(migration, /g\.grantee IN \('PUBLIC', 'anon', 'authenticated'\)/);
  assert.doesNotMatch(executable, /CREATE POLICY|ALTER POLICY/);
  assert.deepEqual(
    executable.match(/EXECUTE 'GRANT[^']+'/gi),
    ["EXECUTE 'GRANT SELECT, INSERT ON TABLE public.d1_employee_migration_checkpoints TO service_role'"],
  );
});

test('migration fails closed unless one accepted checkpoint and forced RLS exist', async () => {
  const { migration } = await sources();
  assert.match(migration, /D1_011A_CHECKPOINT_TABLE_MISSING/);
  assert.match(migration, /D1_011A_CHECKPOINT_RLS_DRIFT/);
  assert.match(migration, /D1_011A_ACCEPTED_CHECKPOINT_CARDINALITY_INVALID/);
  assert.match(migration, /D1_011A_ACCEPTED_CHECKPOINT_MISSING/);
  assert.match(migration, /migration_name = '202607210011_d1_employee_catalog_baseline'/);
  assert.match(migration, /baseline_version = 1/);
  assert.match(migration, /approval_reference = 'D1_2E_FINAL_IMPLEMENTATION_SPECIFICATION\.md \(approved\)'/);
});

test('checkpoint row, stored fingerprint, and aggregates remain logically byte-for-byte unchanged', async () => {
  const { migration } = await sources();
  assert.match(migration, /SELECT to_jsonb\(c\), c\.catalog_fingerprint\s+INTO v_checkpoint_before, v_stored_fingerprint/);
  assert.match(migration, /v_live_fingerprint IS DISTINCT FROM v_stored_fingerprint/);
  assert.match(migration, /D1_011A_STORED_FINGERPRINT_NO_LONGER_MATCHES_LIVE_CATALOG/);
  assert.match(migration, /SELECT to_jsonb\(c\)[\s\S]+IS DISTINCT FROM v_checkpoint_before/);
  assert.match(migration, /D1_011A_CHECKPOINT_ROW_CHANGED/);
  assert.doesNotMatch(executableSql(migration), /UPDATE public\.d1_employee_migration_checkpoints|DELETE FROM public\.d1_employee_migration_checkpoints|TRUNCATE[^;]*d1_employee_migration_checkpoints/i);
});

test('preflight recomputes the exact migration-011 structural fingerprint', async () => {
  const { migration } = await sources();
  for (const section of [
    "'relations'", "'columns'", "'constraints'", "'indexes'", "'policies'",
    "'table_grants'", "'functions'", "'routine_grants'",
  ]) assert.match(migration, new RegExp(section));
  assert.match(migration, /extensions\.digest\(convert_to\(ce\.evidence::text, 'UTF8'\), 'sha256'\)/);
  assert.doesNotMatch(migration, /pg_get_functiondef/i);
});

test('migration 010 and exact K8 invariants fail closed on drift', async () => {
  const { migration, k8 } = await sources();
  assert.match(migration, /D1_011A_MIGRATION_010_ANON_GRANT_REGRESSION/);
  assert.match(migration, /D1_011A_MIGRATION_010_POLICY_REGRESSION/);
  assert.match(migration, /D1_011A_AUTHENTICATED_COMPANY_POLICY_MISSING/);
  assert.match(migration, /create_task_with_outbox_event\(uuid,uuid,uuid,uuid,text,text,text,text,uuid,date,uuid,text,integer,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz\)/);
  assert.match(migration, /pg_get_userbyid\(p\.proowner\) = 'postgres'/);
  assert.match(migration, /search_path=public, pg_temp/);
  assert.match(migration, /D1_011A_KERNEL_RLS_SECURITY_DRIFT/);
  assert.match(k8, /CREATE OR REPLACE FUNCTION public\.create_task_with_outbox_event/);
  assert.doesNotMatch(executableSql(migration), /CREATE OR REPLACE FUNCTION public\.create_task_with_outbox_event|ALTER TABLE public\.tasks|INSERT INTO public\.tasks/i);
});

test('migration is transactional, grant-only, and documents safe forward recovery', async () => {
  const { migration } = await sources();
  const executable = executableSql(migration);
  assert.match(migration, /^-- D1\.2E migration 011a/);
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
  assert.match(migration, /Post-deployment verification \(read-only\)/);
  assert.match(migration, /Safe rollback\/recovery:/);
  assert.match(migration, /GO criteria:/);
  assert.match(migration, /NO-GO:/);
  assert.doesNotMatch(executable, /\b(?:CREATE|DROP|ALTER)\s+TABLE\b/i);
  assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b\s+(?:INTO\s+|FROM\s+)?public\./i);
});
