import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadCompanyTasks } from '../lib/task-list.ts';

const COMPANY = '22222222-2222-4222-8222-222222222222';
const OTHER_COMPANY = '33333333-3333-4333-8333-333333333333';
const TASK = {
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Clean the bar',
  description: null,
  priority: 'critical',
  status: 'pending',
  due_date: '2026-07-21T19:00:00.000Z',
  assigned_employee_id: null,
  created_at: '2026-07-20T10:00:00.000Z',
  updated_at: '2026-07-20T10:00:00.000Z',
};

function access(rowsByCompany, { failTasks = false } = {}) {
  return {
    taskScopes: [],
    employeeScopes: [],
    async listTasks(companyId) {
      this.taskScopes.push(companyId);
      return failTasks
        ? { data: null, error: { message: 'database unavailable' } }
        : { data: rowsByCompany.get(companyId) ?? [], error: null };
    },
    async listEmployees(companyId, employeeIds) {
      this.employeeScopes.push({ companyId, employeeIds });
      return { data: [], error: null };
    },
  };
}

test('returns authenticated company tasks without crossing tenant scope', async () => {
  const repository = access(new Map([[COMPANY, [TASK]], [OTHER_COMPANY, [{ ...TASK, title: 'Private other task' }]]]));
  const tasks = await loadCompanyTasks(repository, COMPANY);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Clean the bar');
  assert.deepEqual(repository.taskScopes, [COMPANY]);
});

test('returns a genuine empty result', async () => {
  const tasks = await loadCompanyTasks(access(new Map()), COMPANY);
  assert.deepEqual(tasks, []);
});

test('fails closed when the task query fails', async () => {
  await assert.rejects(loadCompanyTasks(access(new Map(), { failTasks: true }), COMPANY), /TASK_LIST_QUERY_FAILED/);
});

test('a newly persisted task is visible on the next uncached read', async () => {
  const rows = new Map([[COMPANY, []]]);
  const repository = access(rows);
  assert.deepEqual(await loadCompanyTasks(repository, COMPANY), []);
  rows.set(COMPANY, [TASK]);
  assert.equal((await loadCompanyTasks(repository, COMPANY))[0].id, TASK.id);
  assert.deepEqual(repository.taskScopes, [COMPANY, COMPANY]);
});

test('the API uses centralized authorization, persisted scope, and no-store responses', async () => {
  const source = await readFile(new URL('../app/api/tasks/route.ts', import.meta.url), 'utf8');
  assert.match(source, /authorizeCompanyApiRequestFromSupabase\(supabase\)/);
  assert.match(source, /authorization\.companyId/);
  assert.doesNotMatch(source, /searchParams|get\(['"]company/);
  assert.match(source, /dynamic = 'force-dynamic'/);
  assert.match(source, /revalidate = 0/);
  assert.match(source, /private, no-store, max-age=0/);
});

test('the briefing identity and score endpoint is server-authoritative and uncached', async () => {
  const route = await readFile(new URL('../app/api/brain/daily-briefing/route.ts', import.meta.url), 'utf8');
  const score = await readFile(new URL('../lib/brainScoreService.ts', import.meta.url), 'utf8');
  assert.match(route, /authorizeCompanyApiRequestFromSupabase\(supabase\)/);
  assert.match(route, /authorization\.profileId/);
  assert.match(route, /authorization\.companyId/);
  assert.match(route, /private, no-store, max-age=0/);
  assert.doesNotMatch(score, /['"]Completed['"]|['"]Critical['"]/);
});
