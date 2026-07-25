import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateTaskMetrics, isTaskOverdue } from '../lib/task-metrics.ts';
import {
  resolveTaskVisibilityScope,
  taskRequestUsesOverdueCountIntent,
} from '../lib/task-visibility.ts';
import {
  TASK_COUNT_HISTORY_SUPPORTED,
  brainScoreRequestUsesCurrentScoreIntent,
  formatCurrentOverdueCount,
  formatDeterministicBrainScore,
  formatEarlierOverdueCountWithoutHistory,
  responseClaimsUnsupportedServerOperation,
  taskRequestQuestionsEarlierOverdueCount,
} from '../lib/brain/task-fact-contract.ts';

const at = new Date('2026-07-23T10:00:00.000Z');
const row = (overrides = {}) => ({
  id: crypto.randomUUID(), status: 'pending', priority: 'medium',
  due_date: null, due_at: null, ...overrides,
});

test('canonical overdue rules exclude inactive/null/future deadlines and include past active due_at', () => {
  assert.equal(isTaskOverdue(row({ status: 'completed', due_at: '2026-07-22T00:00:00Z' }), at, 'Asia/Beirut'), false);
  assert.equal(isTaskOverdue(row({ status: 'cancelled', due_at: '2026-07-22T00:00:00Z' }), at, 'Asia/Beirut'), false);
  assert.equal(isTaskOverdue(row(), at, 'Asia/Beirut'), false);
  assert.equal(isTaskOverdue(row({ due_at: '2026-07-24T00:00:00Z' }), at, 'Asia/Beirut'), false);
  assert.equal(isTaskOverdue(row({ status: 'in_progress', due_at: '2026-07-23T09:59:59Z' }), at, 'Asia/Beirut'), true);
});

test('date-only deadlines expire after the company-local date, not UTC midnight', () => {
  const beforeLocalMidnight = new Date('2026-07-22T21:30:00Z');
  assert.equal(isTaskOverdue(row({ due_date: '2026-07-23' }), beforeLocalMidnight, 'Asia/Beirut'), false);
  assert.equal(isTaskOverdue(row({ due_date: '2026-07-22' }), beforeLocalMidnight, 'Asia/Beirut'), true);
});

test('shared metrics shape is internally consistent and canonical', () => {
  const metrics = calculateTaskMetrics([
    row({ due_at: '2026-07-23T09:00:00Z' }),
    row({ status: 'in_progress', due_date: '2026-07-23' }),
    row({ status: 'completed', due_at: '2026-07-01T00:00:00Z' }),
    row({ status: 'cancelled', due_at: '2026-07-01T00:00:00Z' }),
  ], at, 'Asia/Beirut');
  assert.deepEqual(metrics, {
    total: 4, active: 2, pending: 1, inProgress: 1,
    completed: 1, overdue: 1, dueToday: 1,
  });
});

test('all task count consumers use the shared contract and authenticated APIs are uncached', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.match(read('lib/brainScoreService.ts'), /loadTaskSnapshot/);
  assert.match(read('lib/dailyBriefingService.ts'), /loadTaskSnapshot/);
  assert.match(read('app/api/brain/chat/route.ts'), /isTaskOverdue/);
  assert.match(read('app/api/tasks/route.ts'), /buildTaskSnapshot/);
  assert.match(read('components/EmployeeHome.tsx'), /metrics\?\.overdue/);
  for (const route of ['app/api/tasks/route.ts', 'app/api/brain/daily-briefing/route.ts']) {
    const source = read(route);
    assert.match(source, /private, no-store, max-age=0/);
    assert.match(source, /Vary:\s*'Cookie, Authorization'/);
    assert.match(source, /revalidate = 0/);
  }
});

test('server query enforces persisted company and optional trusted employee scope', () => {
  const source = fs.readFileSync(new URL('../lib/task-metrics.server.ts', import.meta.url), 'utf8');
  assert.match(source, /\.eq\('company_id', companyId\)/);
  assert.match(source, /\.eq\('assigned_employee_id', assignedEmployeeId\)/);
  assert.doesNotMatch(source, /request\.json|searchParams|company_id\s*:/);
});

test('production four-row pattern returns four canonical management overdue tasks', () => {
  const rows = [
    row({ id: 'organize-bar', due_date: '2026-07-23', due_at: '2026-07-23T09:00:00Z' }),
    row({ id: 'clean-bar', due_date: '2026-07-23', due_at: '2026-07-23T09:00:00Z' }),
    row({ id: 'reminder-test', due_date: '2026-07-22', due_at: '2026-07-22T14:00:00Z' }),
    row({ id: 'clean-office', due_date: '2026-07-22', due_at: null }),
    row({ id: 'completed', status: 'completed', due_at: '2026-07-01T00:00:00Z' }),
    row({ id: 'cancelled', status: 'cancelled', due_at: '2026-07-01T00:00:00Z' }),
  ];
  assert.equal(calculateTaskMetrics(rows, at, 'Asia/Beirut').overdue, 4);
});

test('employee overdue count remains trusted-assignment scoped', () => {
  const employeeId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const rows = [
    row({ assigned_employee_id: employeeId, due_at: '2026-07-22T00:00:00Z' }),
    row({ assigned_employee_id: otherId, due_at: '2026-07-22T00:00:00Z' }),
  ];
  const assigned = rows.filter((task) => task.assigned_employee_id === employeeId);
  assert.equal(calculateTaskMetrics(assigned, at, 'Asia/Beirut').overdue, 1);
  assert.deepEqual(resolveTaskVisibilityScope({ role: 'employee', employeeId }), { kind: 'assigned', employeeId });
  for (const role of ['manager', 'owner', 'super_admin']) {
    assert.deepEqual(resolveTaskVisibilityScope({ role, employeeId }), { kind: 'company' });
  }
});

test('explicit current count intent suppresses model authority and returns canonical provenance', () => {
  assert.equal(taskRequestUsesOverdueCountIntent('How many overdue tasks do we have?'), true);
  assert.equal(taskRequestUsesOverdueCountIntent('Show pending work'), false);
  const conversation = [
    { role: 'user', content: 'Only show tasks for Sam tomorrow' },
    { role: 'assistant', content: 'Okay' },
    { role: 'user', content: 'How many overdue tasks do we have?' },
  ];
  assert.equal(taskRequestUsesOverdueCountIntent([...conversation].reverse().find((item) => item.role === 'user').content), true);

  const route = fs.readFileSync(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  const branch = route.indexOf('if (deterministicOverdueCountRequest || deterministicOverdueHistoryFollowUp)');
  const openai = route.indexOf('// 5. Initialize OpenAI client');
  assert.ok(branch > 0 && openai > branch);
  assert.match(route.slice(branch, openai), /loadTaskSnapshot/);
  assert.match(route.slice(branch, openai), /assignedEmployeeId: visibility\.kind === 'assigned'/);
  assert.match(route.slice(branch, openai), /formatCurrentOverdueCount\(snapshot\.metrics\.overdue\)/);
  assert.match(route.slice(branch, openai), /taskSnapshot: taskSnapshotProvenance\(snapshot\)/);
  assert.doesNotMatch(route.slice(branch, openai), /toolInput|params\.status|params\.due_date|assigned_employee_name/);
});

test('Brain and Tasks API share the same task metrics implementation', () => {
  const brain = fs.readFileSync(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  const tasksApi = fs.readFileSync(new URL('../app/api/tasks/route.ts', import.meta.url), 'utf8');
  assert.match(brain, /loadTaskSnapshot/);
  assert.match(tasksApi, /buildTaskSnapshot/);
  assert.match(tasksApi, /taskSnapshotProvenance/);
  assert.match(brain, /TASK_DEADLINE_RULE_VERSION/);
});

test('current overdue answers are deterministic and grammatically stable', () => {
  assert.equal(formatCurrentOverdueCount(0), 'You have 0 overdue tasks.');
  assert.equal(formatCurrentOverdueCount(1), 'You have 1 overdue task.');
  assert.equal(formatCurrentOverdueCount(4), 'You have 4 overdue tasks.');
});

test('follow-up questioning an earlier overdue count is detected from topic context only', () => {
  const conversation = [
    { role: 'user', content: 'How many overdue tasks are there?' },
    { role: 'assistant', content: 'You have 1 overdue task.' },
    { role: 'user', content: 'You said there was one earlier.' },
  ];
  assert.equal(
    taskRequestQuestionsEarlierOverdueCount(conversation.at(-1).content, conversation),
    true,
  );
  assert.equal(
    taskRequestQuestionsEarlierOverdueCount('You said it was busy earlier.', [
      { role: 'user', content: 'How many customers visited?' },
    ]),
    false,
  );
});

test('no historical evidence uses the exact required response and never invents a cause', () => {
  assert.equal(TASK_COUNT_HISTORY_SUPPORTED, false);
  assert.equal(
    formatEarlierOverdueCountWithoutHistory(0),
    'The current live count is 0. I do not have a stored historical snapshot proving why the earlier answer differed.',
  );
  const message = formatEarlierOverdueCountWithoutHistory(2);
  assert.doesNotMatch(message, /completed|reassigned|cache|timing|refresh|audit|re-checked/i);

  const baseline = fs.readFileSync(
    new URL('../supabase/migrations/202607240000_current_state_baseline.sql', import.meta.url),
    'utf8',
  );
  const forwardMigrationNames = fs.readdirSync(
    new URL('../supabase/migrations/', import.meta.url),
  ).filter((name) => name.endsWith('.sql') && name !== '202607240000_current_state_baseline.sql');
  const forwardMigrations = forwardMigrationNames.map((name) =>
    fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(`${baseline}\n${forwardMigrations}`, /brain_score_snapshots|task_count_snapshots|brain_score_history/i);
});

test('Brain Score current factual questions return a server-owned deterministic contract', () => {
  assert.equal(brainScoreRequestUsesCurrentScoreIntent('What is the Brain Score?'), true);
  assert.equal(brainScoreRequestUsesCurrentScoreIntent('Show the business brain score breakdown'), true);
  assert.equal(brainScoreRequestUsesCurrentScoreIntent('Show overdue tasks'), false);
  assert.equal(formatDeterministicBrainScore({
    total: 81,
    categories: {
      operations: 70, employees: 90, inventory: 80, customers: 75, data_quality: 95,
    },
    activeTasks: 3,
    overdueTasks: 1,
  }), [
    'Business Brain Score: 81/100.',
    'Operations 70, employees 90, inventory 80, customers 75, data quality 95.',
    'The canonical task snapshot contains 3 active tasks and 1 overdue task.',
  ].join('\n'));
});

test('dashboard score and priority cards receive the exact same request-scoped task snapshot', () => {
  const daily = fs.readFileSync(new URL('../lib/dailyBriefingService.ts', import.meta.url), 'utf8');
  assert.equal((daily.match(/loadTaskSnapshot\(/g) ?? []).length, 1);
  assert.match(daily, /new BrainScoreService\(this\.supabase, this\.userCompanyId, taskSnapshot\)/);
  assert.match(daily, /const overdueTasks = taskSnapshot\.rows\.filter/);
  assert.match(daily, /task_snapshot: taskSnapshotProvenance\(taskSnapshot\)/);

  const score = fs.readFileSync(new URL('../lib/brainScoreService.ts', import.meta.url), 'utf8');
  assert.match(score, /this\.taskSnapshot \?\? await loadTaskSnapshot/);
  assert.match(score, /task_snapshot: taskSnapshotProvenance\(this\.taskSnapshot!\)/);
});

test('safe task snapshot provenance contains the required fields and no tenant identifier', () => {
  const source = fs.readFileSync(new URL('../lib/task-metrics.server.ts', import.meta.url), 'utf8');
  for (const field of ['evaluatedAt', 'companyTimezone', 'taskRuleVersion', 'activeCount', 'overdueCount']) {
    assert.match(source, new RegExp(`${field}:`));
  }
  const provenanceBlock = source.slice(
    source.indexOf('export function taskSnapshotProvenance'),
    source.indexOf('export async function loadTaskSnapshot'),
  );
  assert.doesNotMatch(provenanceBlock, /companyId|employeeId|rows:/);
});

test('unsupported refresh, audit, and cache claims are rejected unless the operation is proven', () => {
  assert.equal(responseClaimsUnsupportedServerOperation({
    message: 'I re-checked the live tasks.',
    successfulDataRead: false,
  }), true);
  assert.equal(responseClaimsUnsupportedServerOperation({
    message: 'I re-checked the live tasks.',
    successfulDataRead: true,
    successfulReadOperations: ['get_tasks'],
  }), false);
  assert.equal(responseClaimsUnsupportedServerOperation({
    message: 'I re-checked the live tasks.',
    successfulDataRead: true,
    successfulReadOperations: ['list_employees'],
  }), true);
  assert.equal(responseClaimsUnsupportedServerOperation({
    message: 'I ran an audit to see who changed the tasks.',
    successfulDataRead: true,
    taskAuditSupported: false,
  }), true);
  assert.equal(responseClaimsUnsupportedServerOperation({
    message: 'The earlier cached Brain Score caused the difference.',
    successfulDataRead: true,
    historicalSnapshotSupported: false,
  }), true);
  assert.equal(responseClaimsUnsupportedServerOperation({
    message: 'There are 2 overdue tasks.',
    successfulDataRead: false,
  }), false);
});

test('chat prompt and final-response guard prohibit fabricated execution and unsupported task audit claims', () => {
  const route = fs.readFileSync(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  assert.match(route, /Conversation messages are not evidence that a server operation occurred/);
  assert.match(route, /There is no supported task-change audit capability/);
  assert.match(route, /responseClaimsUnsupportedServerOperation/);
  assert.match(route, /successfulReadOperations/);
  assert.match(route, /historicalSnapshotSupported: TASK_COUNT_HISTORY_SUPPORTED/);
});
