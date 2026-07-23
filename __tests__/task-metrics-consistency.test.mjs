import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateTaskMetrics, isTaskOverdue } from '../lib/task-metrics.ts';

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
  assert.match(read('app/api/tasks/route.ts'), /calculateTaskMetrics/);
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
