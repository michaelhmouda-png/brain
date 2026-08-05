import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { migrationSha256 } from '../scripts/migration-hash.mjs';

import {
  canManageEmployees,
  employeeSaveMessages,
  normalizeEmployeeMutationError,
  parseEmployeeMutation,
} from '../lib/employees/contracts.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/202607310001_fix_employee_department_persistence.sql');
const baseline = read('supabase/migrations/202607240000_current_state_baseline.sql');
const recurringRepair = read('supabase/migrations/202607300003_fix_recurring_task_materialization_v1.sql');
const service = read('lib/employees/service.server.ts');
const createRoute = read('app/api/employees/route.ts');
const itemRoute = read('app/api/employees/[id]/route.ts');
const form = read('components/EmployeeForm.tsx');
const newPage = read('app/dashboard/employees/new/page.tsx');
const editPage = read('app/dashboard/employees/[id]/page.tsx');

const valid = {
  company_id: 'browser-company-must-be-ignored',
  location_id: '11111111-1111-4111-8111-111111111111',
  department_id: '22222222-2222-4222-8222-222222222222',
  department: 'Browser supplied name must be ignored',
  department_name: 'Also ignored',
  first_name: 'Kitchen',
  last_name: 'A',
  role: 'kitchen',
  phone: null,
  email: null,
  employment_type: 'full-time',
  salary: 0,
  hire_date: '2026-08-01',
  status: 'active',
  notes: null,
};

test('selected department UUID is the only browser department authority', () => {
  const parsed = parseEmployeeMutation(valid);
  assert.equal(parsed.departmentId, valid.department_id);
  assert.equal('department' in parsed, false);
  assert.equal('departmentName' in parsed, false);
  assert.equal('companyId' in parsed, false);
  assert.match(form, /department_id: values\.department_id \|\| null/);
  const payload = form.slice(form.indexOf('const payload = {'), form.indexOf('const endpoint'));
  assert.doesNotMatch(payload, /company_id|department:|department_name/);
});

test('same-company active department is locked and persists UUID plus canonical name atomically', () => {
  assert.match(migration, /SELECT department\.\* INTO v_department[\s\S]*department\.id=NEW\.department_id/);
  assert.match(migration, /department\.company_id=NEW\.company_id/);
  assert.match(migration, /department\.status='active'[\s\S]*FOR SHARE/);
  assert.match(migration, /NEW\.department_id:=v_department\.id/);
  assert.match(migration, /NEW\.department:=v_department\.name/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF[\s\S]*department_id[\s\S]*ON public\.employees/);
});

test('current schema keeps the required compatibility column and canonical FK', () => {
  const employees = baseline.slice(
    baseline.indexOf('CREATE TABLE "public"."employees"'),
    baseline.indexOf('ALTER TABLE "public"."employees" OWNER'),
  );
  assert.match(employees, /"department" text NOT NULL/);
  assert.match(employees, /"department_id" uuid/);
  assert.match(baseline, /employees_department_id_fkey[\s\S]*FOREIGN KEY \(department_id\) REFERENCES departments\(id\)/);
  assert.doesNotMatch(migration, /DROP NOT NULL|ALTER COLUMN department|CREATE TABLE public\.departments/);
});

test('creation and editing share the same trusted consistency boundary', () => {
  assert.match(service, /export async function createEmployee/);
  assert.match(service, /export async function updateEmployee/);
  assert.equal((service.match(/payload\(actor, value\)/g) ?? []).length, 2);
  assert.match(service, /company_id: actor\.companyId/);
  assert.match(service, /department_id: input\.departmentId/);
  assert.doesNotMatch(service, /department:\s*input|department_name/);
  assert.match(service, /\.eq\('company_id', actor\.companyId\)/);
  assert.match(createRoute, /createEmployee\(authenticated, actor, body\)/);
  assert.match(itemRoute, /updateEmployee\(authenticated, actor, id, body\)/);
});

test('missing, malformed, cross-company, and inactive departments fail safely', () => {
  assert.throws(() => parseEmployeeMutation({ ...valid, department_id: null }), /EMPLOYEE_DEPARTMENT_REQUIRED/);
  assert.throws(() => parseEmployeeMutation({ ...valid, department_id: 'not-a-uuid' }), /EMPLOYEE_DEPARTMENT_REQUIRED/);
  assert.match(migration, /NEW\.department_id IS NULL[\s\S]*EMPLOYEE_DEPARTMENT_REQUIRED/);
  assert.match(migration, /IF NOT FOUND THEN[\s\S]*EMPLOYEE_DEPARTMENT_INVALID/);
  assert.match(migration, /department\.company_id=NEW\.company_id/);
  assert.match(migration, /department\.status='active'/);
});

test('location is revalidated from trusted same-company active state', () => {
  assert.match(migration, /SELECT location\.id INTO v_location_id/);
  assert.match(migration, /location\.id=NEW\.location_id/);
  assert.match(migration, /location\.company_id=NEW\.company_id/);
  assert.match(migration, /location\.status='active'/);
  assert.match(migration, /EMPLOYEE_LOCATION_INVALID/);
  assert.match(newPage, /\.eq\('company_id', actor\.companyId\)\.eq\('status', 'active'\)/);
  assert.match(editPage, /\.eq\('company_id', actor\.companyId\)\.eq\('status', 'active'\)/);
});

test('ActorContext owns company and management authorization for every mutation', () => {
  for (const role of ['manager', 'owner', 'super_admin']) assert.equal(canManageEmployees(role), true);
  assert.equal(canManageEmployees('employee'), false);
  assert.match(createRoute, /resolveActorContext\(authenticated\)/);
  assert.match(itemRoute, /resolveActorContext\(authenticated\)/);
  assert.match(service, /if \(!canManageEmployees\(actor\.role\)\) throw new Error\('EMPLOYEE_FORBIDDEN'\)/);
  assert.match(newPage, /resolveActorContext\(supabase\)/);
  assert.match(editPage, /resolveActorContext\(supabase\)/);
  assert.match(newPage, /\.eq\('id', actor\.companyId\)/);
  assert.match(editPage, /\.eq\('id', actor\.companyId\)/);
});

test('raw PostgreSQL messages are normalized and never returned or logged', () => {
  assert.equal(normalizeEmployeeMutationError(new Error('null value in column department violates not-null constraint')), 'EMPLOYEE_SAVE_UNAVAILABLE');
  assert.equal(normalizeEmployeeMutationError(new Error('EMPLOYEE_DEPARTMENT_INVALID')), 'EMPLOYEE_DEPARTMENT_INVALID');
  for (const route of [createRoute, itemRoute]) {
    assert.doesNotMatch(route, /error\.message|message:\s*error/);
    assert.match(route, /NextResponse\.json\(\{ error: code \}/);
    assert.match(route, /console\.warn\('\[Employee mutation\] rejected', \{ operation[,:\w\s']*requestId, code \}\)/);
  }
  assert.doesNotMatch(createRoute + itemRoute, /first_name|last_name|email|phone|salary|notes/);
});

test('stable employee errors have English and Arabic presentation', () => {
  for (const code of [
    'EMPLOYEE_INPUT_INVALID', 'EMPLOYEE_FORBIDDEN', 'EMPLOYEE_DEPARTMENT_REQUIRED',
    'EMPLOYEE_DEPARTMENT_INVALID', 'EMPLOYEE_LOCATION_INVALID', 'EMPLOYEE_SAVE_UNAVAILABLE',
  ]) {
    assert.ok(employeeSaveMessages.en[code]);
    assert.ok(employeeSaveMessages.ar[code]);
  }
  assert.match(form, /employeeSaveMessages\[language\]/);
  assert.match(form, /body\?\.error/);
  assert.match(form, /role="alert"/);
  assert.doesNotMatch(form, /body\?\.message/);
});

test('existing lifecycle, profile linkage, archive, versioning, and security remain intact', () => {
  assert.doesNotMatch(migration, /UPDATE public\.employees|INSERT INTO public\.employees|DELETE FROM public\.employees/);
  assert.doesNotMatch(migration, /public\.profiles|ALTER TABLE public\.employees|ROW LEVEL SECURITY|CREATE POLICY|DROP POLICY/);
  assert.match(migration, /OLD\.lifecycle_status='archived'[\s\S]*EMPLOYEE_ARCHIVED/);
  assert.match(migration, /NEW\.version:=OLD\.version\+1/);
  const trigger = migration.slice(migration.indexOf('CREATE TRIGGER employees_department_consistency'));
  assert.doesNotMatch(trigger, /lifecycle_status|archived_at|archived_by_profile_id|termination_reason_code/);
  assert.match(baseline, /CREATE POLICY "employees_insert"[\s\S]*private\.can_manage_company\(company_id\)/);
  assert.match(baseline, /CREATE POLICY "employees_update"[\s\S]*private\.can_manage_company\(company_id\)/);
});

test('normal UI can create Kitchen A and Kitchen B without direct SQL', () => {
  const first = parseEmployeeMutation(valid);
  const second = parseEmployeeMutation({ ...valid, last_name: 'B' });
  assert.equal(first.departmentId, second.departmentId);
  assert.notEqual(first.lastName, second.lastName);
  assert.match(form, /mode === "create" \? "\/api\/employees"/);
  assert.match(form, /method = mode === "create" \? "POST" : "PATCH"/);
  assert.match(form, /required[\s\S]*value=\{values\.department_id\}/);
  assert.doesNotMatch(migration, /UNIQUE[^;]*department_id|INSERT INTO public\.departments/);
});

test('migration is forward-only, private, and preserves the applied recurring repair', () => {
  assert.match(migration, /^-- Employee department compatibility persistence repair\./);
  assert.match(migration, /\bBEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path TO ''/);
  assert.match(migration, /ALTER FUNCTION private\.enforce_employee_department_consistency\(\) OWNER TO postgres/);
  assert.match(migration, /REVOKE ALL ON FUNCTION private\.enforce_employee_department_consistency\(\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  const executable = migration.replace(/^--.*$/gm, '');
  assert.doesNotMatch(executable, /GRANT EXECUTE|DO \$|CREATE TEMP|\bUPDATE public\.employees\b|\bINSERT INTO public\.employees\b/i);
  assert.equal(migrationSha256(recurringRepair), '95780e5e82db29b4940bb52a0e733f0efde8260ad2fe766d3b93f6a8d57cfc51');
});
