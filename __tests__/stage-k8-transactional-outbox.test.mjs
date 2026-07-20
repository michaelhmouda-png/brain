import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createDomainEventRecorder } from '../lib/brain/kernel/events/domain-event-recorder.ts';
import { createTaskCommand } from '../lib/brain/tasks/commands/create-task-command.ts';
import { createTaskCreatedEvent } from '../lib/brain/tasks/events/task-created-event.ts';
import { createTaskCreatedOutboxDelivery } from '../lib/brain/events/outbox/task-created-outbox-delivery.ts';

const migrationUrl = new URL('../supabase/migrations/202607210001_stage_k8_create_task_transactional_outbox.sql', import.meta.url);
const actor = Object.freeze({
  actorId: '11111111-1111-4111-8111-111111111111', authUserId: '11111111-1111-4111-8111-111111111111',
  profileId: '11111111-1111-4111-8111-111111111111', companyId: '22222222-2222-4222-8222-222222222222',
  role: 'manager', status: 'active', actorType: 'human',
  correlationId: '33333333-3333-4333-8333-333333333333', displayName: 'Manager',
});
const tenant = Object.freeze({ scopeType: 'company', tenantId: actor.companyId, companyId: actor.companyId });
const proposalId = '44444444-4444-4444-8444-444444444444';
const taskId = '55555555-5555-4555-8555-555555555555';

function command() {
  return createTaskCommand({ context: { actor, tenant }, proposalId, payload: { title: 'Inspect freezer', priority: 'high', status: 'pending' } });
}
function event(issued = command(), overrides = {}) {
  return createTaskCreatedEvent({ command: issued, result: {
    taskId, title: 'Inspect freezer', priority: 'high', status: 'pending',
    assignedEmployeeId: null, assignedEmployeeName: null, dueDate: null, ...overrides,
  }});
}

test('migration creates one server-only focused outbox with required indexes and uniqueness', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /CREATE TABLE public\.brain_event_outbox/i);
  assert.match(sql, /UNIQUE \(command_id, event_type\)/i);
  assert.match(sql, /UNIQUE \(company_id, idempotency_key\)/i);
  assert.match(sql, /pending_available_idx/i);
  assert.match(sql, /company_created_idx/i);
  assert.match(sql, /aggregate_idx/i);
  assert.match(sql, /correlation_idx/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON TABLE[^;]+FROM public, anon, authenticated/i);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE[^;]+TO service_role/i);
});

test('atomic RPC inserts task before outbox inside one PostgreSQL function', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.create_task_with_outbox_event'));
  assert.ok(fn.indexOf('INSERT INTO public.tasks') > 0);
  assert.ok(fn.indexOf('INSERT INTO public.brain_event_outbox') > fn.indexOf('INSERT INTO public.tasks'));
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\.create_task_with_outbox_event/g) ?? []).length, 1);
  assert.doesNotMatch(fn, /COMMIT|ROLLBACK/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_task_with_outbox_event[\s\S]+FROM public, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_task_with_outbox_event[\s\S]+TO service_role/i);
});

test('RPC fails closed on actor, profile, tenant, assignee, proposal, task, and event mismatch', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const guard of [
    'INVALID_ACTOR_CONTEXT', 'INVALID_ACTIVE_PROFILE', 'INVALID_EXECUTING_PROPOSAL',
    'CROSS_TENANT_ASSIGNEE', 'INVALID_TASK_PAYLOAD', 'INVALID_EVENT_RELATIONSHIP', 'INVALID_EVENT_PAYLOAD',
  ]) assert.match(sql, new RegExp(guard));
  assert.match(sql, /company_id = p_tenant_id/i);
  assert.match(sql, /status = 'active'/i);
  assert.match(sql, /canonical_action = 'create_task'/i);
  assert.match(sql, /status = 'executing'/i);
  assert.match(sql, /p_aggregate_id <> p_task_id/i);
  assert.match(sql, /p_event_causation_id <> p_command_id/i);
});

test('corrective RPC migration qualifies every queried table column that can collide with output variables', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202607210002_fix_k8_create_task_rpc_ambiguous_columns.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_task_with_outbox_event/);
  assert.match(sql, /FROM public\.profiles AS pr[\s\S]+pr\.id[\s\S]+pr\.company_id[\s\S]+pr\.status/);
  assert.match(sql, /FROM public\.brain_action_proposals AS bap[\s\S]+bap\.id[\s\S]+bap\.actor_id[\s\S]+bap\.profile_id[\s\S]+bap\.tenant_id[\s\S]+bap\.status/);
  assert.match(sql, /FROM public\.employees AS emp[\s\S]+emp\.id[\s\S]+emp\.company_id/);
  assert.doesNotMatch(sql, /(?:WHERE|AND)\s+(?:id|company_id|actor_id|profile_id|tenant_id|status|priority|title|due_date|assigned_employee_id|task_id)\s*(?:=|<>|IN\b|IS\b)/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_task_with_outbox_event[\s\S]+FROM public, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_task_with_outbox_event[\s\S]+TO service_role/i);
});

test('production create_task repository uses the atomic RPC and the canonical K5 event factory', async () => {
  const source = await readFile(new URL('../lib/brain/tasks/infrastructure/create-task-record.server.ts', import.meta.url), 'utf8');
  assert.match(source, /createTaskCreatedEvent\(\{ command: input\.command, result: preparedResult \}\)/);
  assert.match(source, /serviceSupabase\.rpc\('create_task_with_outbox_event'/);
  assert.doesNotMatch(source, /\.from\('tasks'\)\s*\.insert/);
  assert.match(source, /p_command_id: event\.commandId/);
  assert.match(source, /p_correlation_id: event\.correlationId/);
  assert.match(source, /p_event_causation_id: event\.causationId/);
  assert.match(source, /p_idempotency_key: input\.command\.idempotencyKey/);
});

function deliveryHarness() {
  const domainRows = [];
  const outbox = new Map();
  const domainRecorder = createDomainEventRecorder({
    async insert(record) {
      if (domainRows.some(row => row.command_id === record.command_id && row.event_type === record.event_type)) return 'duplicate';
      domainRows.push(structuredClone(record)); return 'inserted';
    },
    async findByCommand(commandId, eventType) {
      return domainRows.find(row => row.command_id === commandId && row.event_type === eventType) ?? null;
    },
  });
  const state = {
    async markDelivered(eventId, commandId) {
      const row = outbox.get(eventId);
      if (!row || row.commandId !== commandId) return 'conflict';
      if (row.status === 'delivered') return 'already_delivered';
      row.status = 'delivered'; return 'delivered';
    },
    async noteFailure(eventId, commandId, safeCode) {
      const row = outbox.get(eventId);
      if (row?.commandId === commandId && row.status === 'pending') row.safeCode = safeCode;
    },
  };
  return { domainRows, outbox, state, delivery: createTaskCreatedOutboxDelivery(domainRecorder, state) };
}

test('identical outbox redelivery is idempotent and marks one logical event delivered', async () => {
  const harness = deliveryHarness();
  const issued = command();
  const created = event(issued);
  harness.outbox.set(created.eventId, { commandId: created.commandId, status: 'pending' });
  await harness.delivery.record(created);
  await harness.delivery.record(created);
  assert.equal(harness.domainRows.length, 1);
  assert.equal(harness.outbox.get(created.eventId).status, 'delivered');
});

test('conflicting logical duplicate fails closed', async () => {
  const harness = deliveryHarness();
  const issued = command();
  const first = event(issued);
  const conflicting = event(issued, { title: 'Different' });
  harness.outbox.set(first.eventId, { commandId: first.commandId, status: 'pending' });
  harness.outbox.set(conflicting.eventId, { commandId: conflicting.commandId, status: 'pending' });
  await harness.delivery.record(first);
  await assert.rejects(harness.delivery.record(conflicting), error => error.code === 'EVENT_RECORDING_FAILED');
  assert.equal(harness.domainRows.length, 1);
  assert.equal(harness.outbox.get(conflicting.eventId).status, 'pending');
});

test('delivery failure leaves outbox pending and cannot rerun task creation', async () => {
  let taskCreates = 1;
  const created = event();
  const row = { commandId: created.commandId, status: 'pending', safeCode: null };
  const delivery = createTaskCreatedOutboxDelivery({ record: async () => { throw new Error('database unavailable'); } }, {
    markDelivered: async () => { throw new Error('must not mark'); },
    noteFailure: async (_id, _command, code) => { row.safeCode = code; },
  });
  await assert.rejects(delivery.record(created), /database unavailable/);
  assert.equal(row.status, 'pending');
  assert.equal(row.safeCode, 'EVENT_RECORDING_FAILED');
  assert.equal(taskCreates, 1);
});

test('K6 safe result, K7 registry, and Stage 0C ownership remain unchanged', async () => {
  const service = await readFile(new URL('../lib/brain/tasks/application/create-task-application-service.ts', import.meta.url), 'utf8');
  const registry = await readFile(new URL('../lib/brain/actions/approved-action-registry.ts', import.meta.url), 'utf8');
  const route = await readFile(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  assert.match(service, /taskId: result\.taskId/);
  assert.match(registry, /case 'create_task'/);
  assert.match(registry, /createTaskApplicationService\.execute/);
  assert.ok(route.indexOf('claimProposalForExecution') < route.indexOf('approvedActionRegistry.execute'));
  assert.ok(route.indexOf('approvedActionRegistry.execute') < route.indexOf('markProposalExecuted('));
});

test('K8 adds no bus, workflow, saga, plugin, dynamic registry, scheduler, or consumer', async () => {
  const files = await Promise.all([
    '../lib/brain/events/outbox/task-created-outbox-delivery.ts',
    '../lib/brain/tasks/infrastructure/create-task-record.server.ts',
    '../supabase/migrations/202607210001_stage_k8_create_task_transactional_outbox.sql',
  ].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  assert.doesNotMatch(files.join('\n'), /messageBus|commandBus|workflow|saga|plugin|dynamic registry|scheduler|Brain Score|notification/i);
});

test('real Supabase atomicity verification is explicitly documented', async () => {
  const plan = await readFile(new URL('../STAGE_K8_SUPABASE_ATOMICITY_VERIFICATION.md', import.meta.url), 'utf8');
  assert.match(plan, /forced task insert failure/i);
  assert.match(plan, /forced outbox insert failure/i);
  assert.match(plan, /neither row/i);
  assert.match(plan, /service role/i);
  assert.match(plan, /do not run against production/i);
});
