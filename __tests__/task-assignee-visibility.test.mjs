import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolveTaskVisibilityScope, taskRequestUsesSelfScope } from '../lib/task-visibility.ts';
import { loadCompanyTasks } from '../lib/task-list.ts';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE = '22222222-2222-4222-8222-222222222222';
const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('managing roles retain company visibility while linked employees receive assigned scope', () => {
  for (const role of ['super_admin', 'owner', 'manager']) {
    assert.deepEqual(resolveTaskVisibilityScope({ role, employeeId: EMPLOYEE }), { kind: 'company' });
  }
  assert.deepEqual(resolveTaskVisibilityScope({ role: 'employee', employeeId: EMPLOYEE }), { kind: 'assigned', employeeId: EMPLOYEE });
  assert.deepEqual(resolveTaskVisibilityScope({ role: 'employee', employeeId: null }), { kind: 'missing_employee_link' });
});

test('self-referential task wording scopes every canonical role to its trusted employee UUID', () => {
  for (const wording of [
    'show me my tasks',
    'tasks assigned to me',
    'Which tasks am I assigned?',
    "Show me what I'm assigned",
    'What do I need to do?',
    'Show my workload',
    'List the tasks for me',
  ]) {
    assert.equal(taskRequestUsesSelfScope(wording), true);
  }
  assert.equal(taskRequestUsesSelfScope('show all pending tasks'), false);

  for (const role of ['super_admin', 'owner', 'manager', 'employee']) {
    assert.deepEqual(
      resolveTaskVisibilityScope({ role, employeeId: EMPLOYEE }, true),
      { kind: 'assigned', employeeId: EMPLOYEE },
    );
  }
  assert.deepEqual(
    resolveTaskVisibilityScope({ role: 'manager', employeeId: null }, true),
    { kind: 'missing_employee_link' },
  );
  assert.deepEqual(
    resolveTaskVisibilityScope({ role: 'manager', employeeId: EMPLOYEE }, false),
    { kind: 'company' },
  );
});

test('assigned task list scope is passed as an immutable employee UUID', async () => {
  const calls = [];
  const tasks = await loadCompanyTasks({
    async listTasks(companyId, assignedEmployeeId) {
      calls.push({ companyId, assignedEmployeeId });
      return { data: [{ id: crypto.randomUUID(), title: 'Assigned', description: null, priority: 'high', status: 'pending', due_date: null, assigned_employee_id: EMPLOYEE, created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z' }], error: null };
    },
    async listEmployees() { return { data: [{ id: EMPLOYEE, first_name: 'Assigned', last_name: null }], error: null }; },
  }, COMPANY, EMPLOYEE);
  assert.equal(tasks.length, 1);
  assert.deepEqual(calls, [{ companyId: COMPANY, assignedEmployeeId: EMPLOYEE }]);
});

test('migration grants managers company reads and linked users only their own same-company assignments', () => {
  const sql = read('supabase/migrations/202607210006_task_assignee_select_visibility.sql');
  assert.match(sql, /DROP POLICY IF EXISTS tasks_select/);
  assert.match(sql, /FOR SELECT[\s\S]*TO authenticated/);
  assert.match(sql, /tasks\.company_id = private\.current_user_company_id\(\)/);
  assert.match(sql, /current_user_role\(\) IN \('super_admin', 'owner', 'manager'\)/);
  assert.match(sql, /pr\.employee_id = public\.tasks\.assigned_employee_id/);
  assert.match(sql, /emp\.company_id = pr\.company_id/);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS tasks_(?:insert|update|delete)/);
});

test('Tasks API and Brain apply the same canonical employee scope before optional filters', () => {
  const api = read('app/api/tasks/route.ts');
  const brain = read('app/api/brain/chat/route.ts');
  assert.match(api, /resolveTaskVisibilityScope\(authorization\)/);
  assert.match(api, /query = query\.eq\('assigned_employee_id', assignedEmployeeId\)/);
  assert.match(brain, /resolveTaskVisibilityScope\(\{[\s\S]*employeeId: this\.employeeId/);
  assert.match(brain, /taskRequestUsesSelfScope\(latestUserMessage\.content\)/);
  const getTasks = brain.slice(brain.indexOf('async getTasks('), brain.indexOf('// Update Task'));
  const ownScope = getTasks.indexOf("query = query.eq('assigned_employee_id', visibility.employeeId)");
  const modelNameFilter = getTasks.indexOf('params.assigned_employee_name');
  assert.ok(ownScope > 0 && modelNameFilter > ownScope);
  assert.doesNotMatch(getTasks, /params\.assigned_employee_id/);
  assert.match(getTasks, /!this\.trustedTaskSelfReference && params\.assigned_employee_name/);
});

test('missing link, RLS drift, and zero assignments have distinct safe diagnostics', () => {
  const api = read('app/api/tasks/route.ts');
  const brain = read('app/api/brain/chat/route.ts');
  for (const source of [api, brain]) {
    assert.match(source, /TASK_EMPLOYEE_LINK_MISSING/);
    assert.match(source, /TASK_VISIBILITY_BLOCKED_BY_RLS/);
    assert.match(source, /TASK_VISIBILITY_DIAGNOSTIC_FAILED/);
    assert.match(source, /NO_ASSIGNED_TASKS/);
  }
  assert.match(brain, /NO_MATCHING_ASSIGNED_TASKS/);
  const sql = read('supabase/migrations/202607210006_task_assignee_select_visibility.sql');
  assert.match(sql, /get_my_task_visibility_diagnostic/);
  assert.match(sql, /WHERE t\.company_id = pr\.company_id[\s\S]*t\.assigned_employee_id = pr\.employee_id/);
});

test('canonical profile loading carries employee_id without accepting client scope', () => {
  const companyAuth = read('lib/company-api-authorization.server.ts');
  const actorAuth = read('lib/brain/kernel/actor-context.server.ts');
  assert.match(companyAuth, /select\('id, company_id, role, status, employee_id'\)/);
  assert.match(actorAuth, /select\('id, full_name, role, status, company_id, employee_id'\)/);
  assert.doesNotMatch(read('app/api/tasks/route.ts'), /searchParams.*employee|request.*employeeId/i);
});
