import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  TaskEditInputError,
  canonicalizeTaskEditPatch,
  parseTaskEditRequest,
  resolveTaskDeadlinePatch,
  taskDeadlineFormValues,
} from '../lib/task-edit.ts';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = await read('supabase/migrations/202607280001_management_task_edit_workflow.sql');
const route = await read('app/api/tasks/route.ts');
const service = await read('lib/task-edit.server.ts');
const page = await read('app/dashboard/tasks/page.tsx');
const panel = await read('components/tasks/TaskEditPanel.tsx');
const authorization = await read('lib/company-api-authorization.ts');
const baseline = await read('supabase/migrations/202607240000_current_state_baseline.sql');
const completion = await read('supabase/migrations/202607250002_camera_evidence_c4_manager_approval_completion.sql');
const i18n = await read('lib/i18n.ts');

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const LOCATION_ID = '33333333-3333-4333-8333-333333333333';
const UPDATED_AT = '2026-07-28T10:15:30.123456Z';

function request(patch) {
  return { taskId: TASK_ID, expectedUpdatedAt: UPDATED_AT, patch };
}

test('task edit parser accepts only canonical editable fields and preserves omission', () => {
  assert.deepEqual(parseTaskEditRequest(request({ title: '  Open the bar  ' })), {
    taskId: TASK_ID,
    expectedUpdatedAt: UPDATED_AT,
    patch: { title: 'Open the bar' },
  });
  assert.deepEqual(parseTaskEditRequest(request({ description: null })).patch, {
    description: null,
  });
  assert.deepEqual(
    parseTaskEditRequest(request({
      assignedEmployeeId: EMPLOYEE_ID,
      locationId: LOCATION_ID,
      priority: 'critical',
      status: 'in_progress',
    })).patch,
    {
      assignedEmployeeId: EMPLOYEE_ID,
      locationId: LOCATION_ID,
      priority: 'critical',
      status: 'in_progress',
    },
  );
});

test('malformed UUID, date, time, priority, status, unknown authority, and empty patches fail', () => {
  const invalid = [
    { ...request({ title: 'Valid' }), taskId: 'not-a-uuid' },
    request({ dueDate: '2026-02-30' }),
    request({ dueTime: '24:00' }),
    request({ priority: 'High' }),
    request({ status: 'Completed' }),
    request({ companyId: LOCATION_ID }),
    request({}),
    request({ title: '' }),
    request({ description: '' }),
  ];
  for (const value of invalid) {
    assert.throws(() => parseTaskEditRequest(value), TaskEditInputError);
  }
});

test('date-only, timed, unrelated, and explicit-clear deadline semantics are deterministic', () => {
  const dateOnly = canonicalizeTaskEditPatch(
    { dueDate: '2026-08-02' },
    { dueDate: '2026-08-01', dueAt: null },
    'Asia/Beirut',
  );
  assert.deepEqual(dateOnly, { due_date: '2026-08-02', due_at: null });

  const current = { dueDate: '2026-07-28', dueAt: '2026-07-28T09:30:00.000Z' };
  assert.deepEqual(resolveTaskDeadlinePatch({}, current, 'Asia/Beirut'), {});
  assert.deepEqual(canonicalizeTaskEditPatch({ title: 'Only title' }, current, 'Asia/Beirut'), {
    title: 'Only title',
  });

  const movedDate = resolveTaskDeadlinePatch(
    { dueDate: '2026-07-29' },
    current,
    'Asia/Beirut',
  );
  assert.equal(movedDate.due_date, '2026-07-29');
  assert.equal(movedDate.due_at, '2026-07-29T09:30:00.000Z');

  const movedTime = resolveTaskDeadlinePatch(
    { dueTime: '16:45' },
    current,
    'Asia/Beirut',
  );
  assert.equal(movedTime.due_date, '2026-07-28');
  assert.equal(movedTime.due_at, '2026-07-28T13:45:00.000Z');

  assert.deepEqual(resolveTaskDeadlinePatch(
    { dueDate: null, dueTime: null },
    current,
    'Asia/Beirut',
  ), { due_date: null, due_at: null });
  assert.deepEqual(resolveTaskDeadlinePatch(
    { dueTime: null },
    current,
    'Asia/Beirut',
  ), { due_date: '2026-07-28', due_at: null });
});

test('company-local rendering is stable and ambiguous or nonexistent DST times fail closed', () => {
  assert.deepEqual(
    taskDeadlineFormValues('2026-07-28', '2026-07-28T09:30:00.000Z', 'Asia/Beirut'),
    { dueDate: '2026-07-28', dueTime: '12:30' },
  );
  assert.throws(
    () => resolveTaskDeadlinePatch(
      { dueDate: '2026-03-29', dueTime: '01:30' },
      { dueDate: null, dueAt: null },
      'Europe/London',
    ),
    TaskEditInputError,
  );
  assert.throws(
    () => resolveTaskDeadlinePatch(
      { dueDate: '2026-10-25', dueTime: '01:30' },
      { dueDate: null, dueAt: null },
      'Europe/London',
    ),
    TaskEditInputError,
  );
});

test('management RPC is one atomic, locked, optimistic update with idempotent no-op', () => {
  assert.match(migration, /^--[^\n]+\r?\nBEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.equal((migration.match(/\bCREATE FUNCTION public\.update_management_task/g) ?? []).length, 1);
  assert.match(migration, /FROM public\.tasks AS task[\s\S]*FOR UPDATE/);
  assert.match(migration, /v_task\.updated_at IS DISTINCT FROM p_expected_updated_at[\s\S]*TASK_EDIT_STALE/);
  assert.match(migration, /IS NOT DISTINCT FROM ROW\([\s\S]*RETURN QUERY SELECT v_task\.id, 'unchanged'/);
  assert.ok(
    migration.indexOf("RETURN QUERY SELECT v_task.id, 'unchanged'")
      < migration.indexOf('v_task.updated_at IS DISTINCT FROM p_expected_updated_at'),
    'an identical duplicate must return unchanged before the stale check',
  );
  assert.match(migration, /UPDATE public\.tasks AS task[\s\S]*WHERE task\.id = v_task\.id[\s\S]*task\.updated_at = v_task\.updated_at/);
  assert.doesNotMatch(migration, /\bINSERT INTO public\.tasks\b|\bDELETE FROM public\.tasks\b/);
  assert.doesNotMatch(migration, /task\.created|task\.completed|brain_event_outbox/);
});

test('RPC revalidates active management authority, company, employee, and location', () => {
  assert.match(migration, /profile\.id = p_actor_profile_id[\s\S]*profile\.company_id = p_company_id[\s\S]*profile\.status = 'active'[\s\S]*profile\.role IN \('manager', 'owner', 'super_admin'\)/);
  assert.match(migration, /task\.id = p_task_id[\s\S]*task\.company_id = p_company_id/);
  assert.match(migration, /employee\.id = v_assigned_employee_id[\s\S]*employee\.company_id = p_company_id[\s\S]*employee\.status = 'active'/);
  assert.match(migration, /location\.id = v_location_id[\s\S]*location\.company_id = p_company_id[\s\S]*location\.status = 'active'/);
  assert.match(service, /isTaskEditRole\(authorization\.role\)/);
  assert.match(route, /authorization\.role === 'employee'[\s\S]*'patch' in body[\s\S]*TASK_EDIT_FORBIDDEN[\s\S]*status: 403/);
  assert.match(authorization, /profile\.status !== 'active'/);
  assert.match(authorization, /ACCOUNT_NOT_PROVISIONED/);
  assert.doesNotMatch(route, /body\.(company|companyId|company_id|role|profileId|actorId)/);
});

test('RPC is service-role-only with owner postgres and empty search_path', () => {
  assert.match(migration, /SECURITY DEFINER\s+SET search_path TO ''/);
  assert.match(migration, /ALTER FUNCTION public\.update_management_task\([\s\S]*\)\s+OWNER TO postgres/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.update_management_task\([\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.update_management_task\([\s\S]*TO service_role/);
  assert.doesNotMatch(migration, /GRANT EXECUTE[\s\S]*TO authenticated/);
  assert.match(service, /createSupabase|serviceRole\.rpc\('update_management_task'/);
});

test('generic edit cannot complete, reopen, or mutate terminal tasks', () => {
  assert.match(migration, /v_task\.status IN \('completed', 'cancelled'\)[\s\S]*TASK_TERMINAL_EDIT_FORBIDDEN/);
  assert.match(migration, /v_status = 'completed'[\s\S]*TASK_COMPLETION_WORKFLOW_REQUIRED/);
  assert.match(migration, /v_task\.status IN \('pending', 'in_progress'\)[\s\S]*v_status IN \('pending', 'in_progress', 'cancelled'\)/);
  assert.match(completion, /private\.complete_task_transition/);
  assert.match(completion, /v_task\.status NOT IN \('pending', 'in_progress'\)/);
  assert.doesNotMatch(migration, /complete_task_transition|review_task_evidence/);
});

test('API provides deterministic no-store status contracts and updated projection', () => {
  assert.match(route, /export const dynamic = 'force-dynamic'/);
  assert.match(route, /export const revalidate = 0/);
  assert.match(route, /Cache-Control': 'private, no-store/);
  assert.match(route, /parseTaskEditRequest\(body\)/);
  assert.match(route, /updateManagementTask\(/);
  assert.match(route, /status: 200/);
  assert.match(route, /status: 400/);
  assert.match(service, /TASK_EDIT_FORBIDDEN', 403/);
  assert.match(service, /TASK_EDIT_NOT_FOUND', 404/);
  assert.match(service, /TASK_EDIT_STALE', 409/);
  assert.match(service, /TASK_EDIT_UNAVAILABLE', 500/);
  assert.match(route, /\{ data: result\.task, outcome: result\.outcome \}/);
});

test('reassignment, reminder, and localization effects reuse existing durable mechanisms', () => {
  assert.match(baseline, /NEW\.assigned_employee_id IS DISTINCT FROM OLD\.assigned_employee_id THEN v_type:='task\.reassigned'/);
  assert.match(baseline, /ON CONFLICT\(company_id,event_key\) DO NOTHING/);
  assert.match(baseline, /task\.assigned_employee_id = profile\.employee_id/);
  assert.match(baseline, /v_outbox\.event_type IN \('task\.assigned', 'task\.reassigned'\)/);
  assert.match(baseline, /'task\.due_30m:' \|\| task\.id::text \|\| ':'/);
  assert.match(baseline, /v_outbox\.event_key =[\s\S]*'task\.due_30m:'[\s\S]*task\.due_at AT TIME ZONE 'UTC'/);
  assert.match(baseline, /CREATE TRIGGER tasks_enqueue_arabic_localization AFTER INSERT OR UPDATE OF title, description, assigned_employee_id/);
  assert.match(baseline, /source_hash = EXCLUDED\.source_hash[\s\S]*status = CASE/);
  assert.doesNotMatch(panel, /translate|localization_jobs|notification_outbox|due_30m/i);
});

test('desktop/mobile editor uses canonical values, conflict refresh, localization, and confirmed success', () => {
  assert.match(page, /role !== 'employee'[\s\S]*setEditingTaskId\(task\.id\)/);
  assert.match(page, /task\.status !== 'completed' && task\.status !== 'cancelled'/);
  assert.match(panel, /task\.title/);
  assert.match(panel, /task\.description/);
  assert.match(panel, /expectedUpdatedAt: task\.updatedAt/);
  assert.match(panel, /disabled=\{saving \|\| isTerminal\}/);
  assert.match(panel, /response\.ok/);
  assert.ok(panel.indexOf('if (!response.ok)') < panel.indexOf('onUpdated(updated)'));
  assert.match(panel, /onUpdated\(updated\)[\s\S]*onClose\(\)[\s\S]*await onRefresh\(\)/);
  assert.match(panel, /sm:max-w-2xl|sm:items-center/);
  assert.match(panel, /TASK_EDIT_STALE[\s\S]*editLoadLatest/);
  assert.match(i18n, /editTitle: 'Edit task'/);
  assert.match(i18n, /editTitle: 'تعديل المهمة'/);
  assert.match(i18n, /editConflict: 'تغيّرت هذه المهمة/);
});
