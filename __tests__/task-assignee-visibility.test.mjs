import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  classifyTaskRequestScope,
  resolveCompanyTaskEmployee,
  resolveTaskResultLimit,
  resolveTaskVisibilityScope,
  shouldApplyModelTaskAssigneeFilter,
  taskRequestExplicitlyIncludesFilter,
  taskRequestUsesCompanyScope,
  taskRequestNeedsUnfilteredCompanyTasks,
  taskRequestReferencesCompanyEmployee,
  taskRequestUsesSelfScope,
} from '../lib/task-visibility.ts';
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
      resolveTaskVisibilityScope({ role, employeeId: EMPLOYEE }, 'self'),
      { kind: 'assigned', employeeId: EMPLOYEE },
    );
  }
  assert.deepEqual(
    resolveTaskVisibilityScope({ role: 'manager', employeeId: null }, 'self'),
    { kind: 'missing_employee_link' },
  );
  assert.deepEqual(
    resolveTaskVisibilityScope({ role: 'manager', employeeId: EMPLOYEE }, 'default'),
    { kind: 'company' },
  );
});

test('explicit company task intent overrides model assignee filters for privileged roles', () => {
  for (const wording of [
    'Show all pending tasks',
    'Show all tasks',
    'List company tasks',
    'Show team tasks',
    'Tasks across the company',
  ]) {
    assert.equal(taskRequestUsesCompanyScope(wording), true);
    assert.equal(classifyTaskRequestScope(wording), 'company');
  }

  for (const role of ['super_admin', 'owner', 'manager']) {
    const visibility = resolveTaskVisibilityScope({ role, employeeId: EMPLOYEE }, 'company');
    assert.deepEqual(visibility, { kind: 'company' });
    assert.equal(shouldApplyModelTaskAssigneeFilter(visibility, 'company'), false);
  }

  const employeeVisibility = resolveTaskVisibilityScope({ role: 'employee', employeeId: EMPLOYEE }, 'company');
  assert.deepEqual(employeeVisibility, { kind: 'assigned', employeeId: EMPLOYEE });
  assert.equal(shouldApplyModelTaskAssigneeFilter(employeeVisibility, 'company'), false);
});

test('task scope is derived independently for sequential and fresh requests', () => {
  const manager = { role: 'manager', employeeId: EMPLOYEE };
  const firstIntent = classifyTaskRequestScope('Show me my tasks');
  const secondIntent = classifyTaskRequestScope('Show all pending tasks');

  assert.equal(firstIntent, 'self');
  assert.deepEqual(resolveTaskVisibilityScope(manager, firstIntent), { kind: 'assigned', employeeId: EMPLOYEE });
  assert.equal(secondIntent, 'company');
  assert.deepEqual(resolveTaskVisibilityScope(manager, secondIntent), { kind: 'company' });
  assert.equal(classifyTaskRequestScope('Show all pending tasks'), 'company');
  assert.equal(classifyTaskRequestScope('Find cleaning tasks'), 'default');
});

test('company-wide all-task intent is unfiltered while pending company intent remains filtered', () => {
  assert.equal(taskRequestNeedsUnfilteredCompanyTasks('Show all tasks (any status)'), true);
  assert.equal(taskRequestNeedsUnfilteredCompanyTasks('Show all tasks'), true);
  assert.equal(taskRequestNeedsUnfilteredCompanyTasks('Show company tasks'), true);
  assert.equal(taskRequestNeedsUnfilteredCompanyTasks('Show all pending tasks'), false);
  assert.equal(taskRequestNeedsUnfilteredCompanyTasks('Show all tasks due tomorrow'), false);
  assert.equal(taskRequestNeedsUnfilteredCompanyTasks('Show all tasks assigned to Carla'), false);
  assert.equal(taskRequestNeedsUnfilteredCompanyTasks('Show my tasks'), false);
});

test('named task assignees resolve uniquely inside the authorized company directory', () => {
  const employees = [
    { id: '33333333-3333-4333-8333-333333333333', first_name: 'Carla', last_name: 'el rayes' },
    { id: '44444444-4444-4444-8444-444444444444', first_name: 'Elie', last_name: 'Bteish' },
    { id: '55555555-5555-4555-8555-555555555555', first_name: 'Khaled', last_name: 'Ismaeil' },
    { id: EMPLOYEE, first_name: 'Maroun', last_name: 'Mhanna' },
  ];
  assert.deepEqual(resolveCompanyTaskEmployee(employees, 'Carla'), {
    kind: 'matched',
    employee: { id: employees[0].id, firstName: 'Carla', lastName: 'el rayes' },
  });
  const carla = resolveCompanyTaskEmployee(employees, 'Carla');
  assert.equal(carla.kind === 'matched' && taskRequestReferencesCompanyEmployee(
    "Show me Carla's tasks",
    carla.employee,
  ), true);
  assert.equal(resolveCompanyTaskEmployee(employees, 'Carla’s').kind, 'matched');
  assert.equal(resolveCompanyTaskEmployee(employees, 'Nobody').kind, 'not_found');
  assert.equal(resolveCompanyTaskEmployee([
    ...employees,
    { id: '66666666-6666-4666-8666-666666666666', first_name: 'Carla', last_name: 'Other' },
  ], 'Carla').kind, 'ambiguous');
});

test('named assignee requests reject hidden model filters unless explicitly requested', () => {
  const request = "Show me Carla's tasks";
  for (const filter of ['title', 'status', 'priority', 'due_date']) {
    assert.equal(taskRequestExplicitlyIncludesFilter(request, filter), false);
  }
  assert.equal(taskRequestExplicitlyIncludesFilter("Show Carla's pending tasks", 'status'), true);
  assert.equal(taskRequestExplicitlyIncludesFilter("Show Carla's critical tasks", 'priority'), true);
  assert.equal(taskRequestExplicitlyIncludesFilter("Show Carla's tasks due tomorrow", 'due_date'), true);
  assert.equal(taskRequestExplicitlyIncludesFilter("Show Carla's task titled Clean bar", 'title'), true);
});

test('an active named employee with exactly one task is selected by UUID before pagination', () => {
  const carlaId = 'c28a6273-79f9-4ca6-ae02-e5be6c472db7';
  const tasks = [
    { id: 'carla-only', assigned_employee_id: carlaId, status: 'completed' },
    { id: 'maroun', assigned_employee_id: EMPLOYEE, status: 'pending' },
    { id: 'unassigned', assigned_employee_id: null, status: 'pending' },
  ];
  const result = tasks.filter((task) => task.assigned_employee_id === carlaId).slice(0, 100);
  assert.deepEqual(result, [{ id: 'carla-only', assigned_employee_id: carlaId, status: 'completed' }]);
});

test('task result limits are server-bounded and all-company requests ignore model limits', () => {
  assert.equal(resolveTaskResultLimit(5, true), 100);
  assert.equal(resolveTaskResultLimit(10, false), 10);
  assert.equal(resolveTaskResultLimit(1000, false), 100);
  assert.equal(resolveTaskResultLimit(-5, false), 1);
  assert.equal(resolveTaskResultLimit('20', false), 20);
});

test('multiple employees and unassigned tasks survive an unfiltered company result', () => {
  const rows = [
    { id: 'task-carla', assigned_employee_id: '33333333-3333-4333-8333-333333333333' },
    { id: 'task-khaled', assigned_employee_id: '55555555-5555-4555-8555-555555555555' },
    { id: 'task-maroun', assigned_employee_id: EMPLOYEE },
    { id: 'task-unassigned', assigned_employee_id: null },
  ];
  assert.equal(rows.length, 4);
  assert.equal(rows.some((task) => task.assigned_employee_id === null), true);
  assert.equal(rows.filter((task) => task.assigned_employee_id === EMPLOYEE).length, 1);
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
  assert.match(brain, /classifyTaskRequestScope\(latestUserMessage\.content\)/);
  assert.match(brain, /taskRequestNeedsUnfilteredCompanyTasks\(latestUserMessage\.content\)/);
  const getTasks = brain.slice(brain.indexOf('async getTasks('), brain.indexOf('// Update Task'));
  const ownScope = getTasks.indexOf("query = query.eq('assigned_employee_id', visibility.employeeId)");
  const namedScope = getTasks.indexOf("query = query.eq('assigned_employee_id', requestedAssigneeId)");
  const namedResolution = getTasks.indexOf('resolveCompanyTaskEmployee');
  const taskLimit = getTasks.indexOf('query.limit(limit)');
  assert.ok(ownScope > 0 && namedScope > 0 && namedResolution > 0);
  assert.ok(namedResolution < namedScope && namedScope < taskLimit);
  assert.doesNotMatch(getTasks, /params\.assigned_employee_id/);
  assert.match(getTasks, /shouldApplyModelTaskAssigneeFilter/);
  assert.match(getTasks, /applyModelAssigneeFilter && params\.assigned_employee_name/);
  assert.match(getTasks, /taskRequestReferencesCompanyEmployee/);
  assert.match(getTasks, /taskRequestExplicitlyIncludesFilter/);
  assert.doesNotMatch(getTasks, /fullName\.includes\(searchName\)/);
  assert.match(brain, /report every task returned by get_tasks, including unassigned tasks/);
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
