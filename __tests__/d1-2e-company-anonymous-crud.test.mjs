import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/202607210010_d1_security_close_anonymous_company_crud.sql',
  import.meta.url,
);
const authSchemaUrl = new URL('../auth_schema.sql', import.meta.url);
const k8MigrationUrl = new URL(
  '../supabase/migrations/202607210001_stage_k8_create_task_transactional_outbox.sql',
  import.meta.url,
);

async function sources() {
  const [migration, authSchema, k8] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(authSchemaUrl, 'utf8'),
    readFile(k8MigrationUrl, 'utf8'),
  ]);
  return { migration, authSchema, k8 };
}

function executableSql(sql) {
  return sql.replace(/^\s*--.*$/gm, '');
}

function companyPolicy(authSchema, name) {
  const start = authSchema.indexOf(`create policy "${name}" on public.companies`);
  assert.notEqual(start, -1, `${name} must exist`);
  const nextPolicy = authSchema.indexOf('create policy ', start + 1);
  return authSchema.slice(start, nextPolicy === -1 ? undefined : nextPolicy);
}

test('anonymous SELECT is denied by structural policy removal and privilege revocation', async () => {
  const { migration } = await sources();
  assert.match(migration, /FOREACH v_command IN ARRAY ARRAY\['r', 'a', 'w', 'd'\]/);
  assert.match(migration, /WHEN 'r' THEN lower\(btrim\(pg_catalog\.pg_get_expr\(p\.polqual, p\.polrelid\)\)\) = 'true'/);
  assert.match(migration, /DROP POLICY %I ON public\.companies/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.companies FROM anon/);
});

test('anonymous INSERT is denied and unconditional WITH CHECK is detected', async () => {
  const { migration } = await sources();
  assert.match(migration, /WHEN 'a' THEN lower\(btrim\(pg_catalog\.pg_get_expr\(p\.polwithcheck, p\.polrelid\)\)\) = 'true'/);
  assert.doesNotMatch(migration, /GRANT\s+(?:ALL|INSERT)[^;]*\bTO\s+anon/i);
});

test('anonymous UPDATE is denied only when both unconditional policy clauses are identified', async () => {
  const { migration } = await sources();
  assert.match(
    migration,
    /WHEN 'w' THEN\s+lower\(btrim\(pg_catalog\.pg_get_expr\(p\.polqual, p\.polrelid\)\)\) = 'true'\s+AND lower\(btrim\(pg_catalog\.pg_get_expr\(p\.polwithcheck, p\.polrelid\)\)\) = 'true'/,
  );
  assert.doesNotMatch(migration, /GRANT\s+(?:ALL|UPDATE)[^;]*\bTO\s+anon/i);
});

test('anonymous DELETE is denied and no anonymous recovery is introduced', async () => {
  const { migration } = await sources();
  assert.match(migration, /WHEN 'd' THEN lower\(btrim\(pg_catalog\.pg_get_expr\(p\.polqual, p\.polrelid\)\)\) = 'true'/);
  assert.doesNotMatch(migration, /GRANT\s+(?:ALL|DELETE)[^;]*\bTO\s+anon/i);
  assert.match(migration, /do not restore unconditional anonymous policies/i);
});

test('migration discovers unsafe policies by catalog structure and preserves legitimate authenticated access', async () => {
  const { migration, authSchema } = await sources();
  const executable = executableSql(migration);
  assert.match(migration, /p\.polrelid = 'public\.companies'::regclass/);
  assert.match(migration, /0::oid = ANY \(p\.polroles\) OR v_anon_oid = ANY \(p\.polroles\)/);
  assert.match(migration, /v_authenticated_oid = ANY \(p\.polroles\)/);
  assert.doesNotMatch(migration, /Temporary public (?:read|insert|update|delete) companies/);
  assert.doesNotMatch(executable, /DROP POLICY "companies_(?:select|insert|update|delete)"/i);
  assert.doesNotMatch(executable, /(?:REVOKE|GRANT)[^;]+authenticated/i);

  for (const name of ['companies_select', 'companies_insert', 'companies_update', 'companies_delete']) {
    assert.match(companyPolicy(authSchema, name), /private\.is_active_user\(\)/);
  }
});

test('authenticated company SELECT remains persisted-tenant scoped and cross-tenant reads remain denied', async () => {
  const { authSchema } = await sources();
  const selectPolicy = companyPolicy(authSchema, 'companies_select');
  assert.match(selectPolicy, /id = private\.current_user_company_id\(\)/);
  assert.match(selectPolicy, /private\.is_super_admin\(\)/);
  assert.match(selectPolicy, /private\.is_active_user\(\)/);
  assert.doesNotMatch(selectPolicy, /using\s*\(\s*true\s*\)/i);

  const managerHelperStart = authSchema.indexOf('create or replace function private.can_manage_company');
  const managerHelperEnd = authSchema.indexOf('-- ---', managerHelperStart);
  const managerHelper = authSchema.slice(managerHelperStart, managerHelperEnd);
  assert.match(managerHelper, /private\.current_user_company_id\(\) = target_company_id/);
  assert.match(managerHelper, /private\.current_user_role\(\) in \('owner', 'manager'\)/);
  assert.match(managerHelper, /private\.is_active_user\(\)/);
});

test('migration leaves the K8 create_task contract and database objects unaffected', async () => {
  const { migration, k8 } = await sources();
  assert.doesNotMatch(
    migration,
    /create_task_with_outbox_event|brain_action_proposals|brain_event_outbox|brain_domain_events|public\.tasks/i,
  );
  assert.match(k8, /CREATE OR REPLACE FUNCTION public\.create_task_with_outbox_event/i);
  assert.match(k8, /INSERT INTO public\.tasks/i);
  assert.match(k8, /INSERT INTO public\.brain_event_outbox/i);
  assert.match(k8, /GRANT EXECUTE ON FUNCTION public\.create_task_with_outbox_event[\s\S]+TO service_role/i);
});

test('migration is transactional, fail-closed, and limited to companies anonymous access', async () => {
  const { migration } = await sources();
  assert.match(migration, /^-- D1\.2E migration 010/);
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
  assert.match(migration, /v_unsafe_count <> 1/);
  assert.match(migration, /v_safe_authenticated_count < 1/);
  assert.match(migration, /D1_010_UNSAFE_ANON_POLICY_REMAINS/);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\./i);
  assert.doesNotMatch(migration, /\b(?:ALTER|CREATE)\s+TABLE\b/i);
});
