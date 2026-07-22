import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { canonicalizeProposalArguments } from '../lib/brain/action-proposals.ts';
import { localDateTimeToInstant } from '../lib/brain/tasks/batch/task-batch-time.ts';
import { taskRequestUsesTodayScope } from '../lib/task-visibility.ts';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const khaledId = 'ceeb043a-7e6c-42b3-9514-28786aa0c206';

test('named employee work-today query keeps the UUID and trusted local-day predicates and ignores model filters', () => {
  assert.equal(taskRequestUsesTodayScope("How was Khaled's work today?"), true);
  const rows = [
    { id: 'valid', company_id: 'company-a', assigned_employee_id: khaledId, due_date: '2026-07-22', status: 'pending' },
    { id: 'progress', company_id: 'company-a', assigned_employee_id: khaledId, due_date: '2026-07-22', status: 'in_progress' },
    { id: 'completed', company_id: 'company-a', assigned_employee_id: khaledId, due_date: '2026-07-22', status: 'completed' },
    { id: 'cancelled', company_id: 'company-a', assigned_employee_id: khaledId, due_date: '2026-07-22', status: 'cancelled' },
    { id: 'future', company_id: 'company-a', assigned_employee_id: khaledId, due_date: '2026-07-23', status: 'completed' },
    { id: 'other-company', company_id: 'company-b', assigned_employee_id: khaledId, due_date: '2026-07-22', status: 'completed' },
  ];
  const result = rows.filter((row) => row.company_id === 'company-a' && row.assigned_employee_id === khaledId && row.due_date === '2026-07-22');
  assert.deepEqual(result.map(({ id, status }) => ({ id, status })), [
    { id: 'valid', status: 'pending' },
    { id: 'progress', status: 'in_progress' },
    { id: 'completed', status: 'completed' },
    { id: 'cancelled', status: 'cancelled' },
  ]);

  const route = read('app/api/brain/chat/route.ts');
  assert.match(route, /requestedAssigneeId = resolution\.employee\.id/);
  assert.match(route, /namedAssigneeRequest && trustedTodayRequest[\s\S]*query = query\.eq\('due_date', today\)/);
  assert.match(route, /ignoreImplicitModelFilters = [^;]*namedAssigneeRequest/);
  assert.match(route, /loadTrustedCompanyTimezone\(\)[\s\S]*companyLocalDate\(\)/);
});

test('company timezone converts an explicit local time to one canonical instant', () => {
  assert.deepEqual(localDateTimeToInstant('2026-07-22T16:30', 'Asia/Beirut'), {
    dueAt: '2026-07-22T13:30:00.000Z',
    dueDate: '2026-07-22',
  });
});

test('timed proposal is fully canonical while date-only proposal retains a null due_at path', () => {
  const timed = canonicalizeProposalArguments('create_task', {
    title: 'Clean the office desk', assigned_employee_id: khaledId,
    assigned_employee_name: 'Khaled Ismaeil', priority: 'high', status: 'pending',
    due_date: '2026-07-22', due_time: '16:30', due_local: '2026-07-22T16:30',
    due_at: '2026-07-22T13:30:00.000Z', timezone: 'Asia/Beirut',
  });
  assert.equal(timed.payload.due_at, '2026-07-22T13:30:00.000Z');
  assert.equal(timed.payload.timezone, 'Asia/Beirut');
  const dateOnly = canonicalizeProposalArguments('create_task', {
    title: 'Clean the office desk', priority: 'high', status: 'pending', due_date: '2026-07-22',
  });
  assert.equal(Object.hasOwn(dateOnly.payload, 'due_at'), false);
});

test('preview exposes the exact local time and timezone and confirmation never recomputes it', () => {
  const route = read('app/api/brain/chat/route.ts');
  const repository = read('lib/brain/tasks/infrastructure/create-task-record.server.ts');
  assert.match(route, /due_local: `\$\{resolvedDueDate\}T\$\{resolvedDueTime\}`/);
  assert.match(route, /due_at: resolvedDueAt/);
  assert.match(route, /`\$\{resolvedDueDate\} \$\{resolvedDueTime\} \(\$\{dueTimezone\}\)`/);
  assert.match(repository, /dueAt: input\.payload\.dueAt/);
  assert.match(repository, /p_due_at: preparedResult\.dueAt/);
  assert.doesNotMatch(repository, /localDateTimeToInstant|company\.timezone/);
});

test('timed singular creation is atomic and leaves the original date-only K8 RPC unchanged', () => {
  const sql = read('supabase/migrations/202607220011_create_task_due_at.sql');
  const oldK8 = read('supabase/migrations/202607210002_fix_k8_create_task_rpc_ambiguous_columns.sql');
  assert.match(sql, /^--[\s\S]*BEGIN;[\s\S]*CREATE FUNCTION public\.create_task_with_outbox_event_due_at/);
  assert.match(sql, /INSERT INTO public\.tasks[\s\S]*INSERT INTO public\.brain_event_outbox/);
  assert.match(sql, /v_proposal_payload->>'due_at'[\s\S]*IS DISTINCT FROM p_due_at/);
  assert.match(sql, /AT TIME ZONE v_timezone/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_task_with_outbox_event_due_at[\s\S]*FROM public, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_task_with_outbox_event_due_at[\s\S]*TO service_role/);
  assert.match(oldK8, /CREATE OR REPLACE FUNCTION public\.create_task_with_outbox_event\(/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.create_task_with_outbox_event\(/);
});

test('N2 eligibility recognizes the newly persisted timed task in its exact 30-minute window', () => {
  const dueAt = new Date('2026-07-22T13:30:00.000Z').getTime();
  const now = new Date('2026-07-22T13:00:00.000Z').getTime();
  assert.equal(now >= dueAt - 30 * 60 * 1000 && now < dueAt, true);
  const n2 = read('supabase/migrations/202607220010_task_due_30m_notifications.sql');
  assert.match(n2, /v_database_now >= task\.due_at - interval '30 minutes'/);
  assert.match(n2, /v_database_now < task\.due_at/);
});
