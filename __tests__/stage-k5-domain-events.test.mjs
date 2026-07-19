import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createDomainEventEnvelope } from '../lib/brain/kernel/events/domain-event-envelope.ts';
import { DomainEventError } from '../lib/brain/kernel/events/domain-event-errors.ts';
import { createDomainEventRecorder } from '../lib/brain/kernel/events/domain-event-recorder.ts';
import { createTaskCommand } from '../lib/brain/tasks/commands/create-task-command.ts';
import { createTaskCommandHandler } from '../lib/brain/tasks/commands/create-task-command-handler.ts';
import { createTaskCreatedEvent, TASK_CREATED_EVENT } from '../lib/brain/tasks/events/task-created-event.ts';

const actor = Object.freeze({
  actorId: '11111111-1111-4111-8111-111111111111',
  authUserId: '11111111-1111-4111-8111-111111111111',
  profileId: '11111111-1111-4111-8111-111111111111',
  companyId: '22222222-2222-4222-8222-222222222222',
  role: 'manager', status: 'active', actorType: 'human',
  correlationId: '33333333-3333-4333-8333-333333333333', displayName: 'Manager',
});
const tenant = Object.freeze({ scopeType: 'company', tenantId: actor.companyId, companyId: actor.companyId });
const proposalId = '44444444-4444-4444-8444-444444444444';
const taskId = '55555555-5555-4555-8555-555555555555';

function command() {
  return createTaskCommand({
    context: { actor, tenant }, proposalId,
    payload: { title: 'Inspect freezer', description: 'Sensitive notes', priority: 'high', status: 'pending', due_date: '2026-07-21' },
  });
}

function result(overrides = {}) {
  return {
    taskId, title: 'Inspect freezer', priority: 'high', status: 'pending',
    assignedEmployeeId: null, assignedEmployeeName: null, dueDate: '2026-07-21',
    ...overrides,
  };
}

test('creates an immutable task.created envelope with trusted causal identity', () => {
  const issued = command();
  const event = createTaskCreatedEvent({ command: issued, result: result(), occurredAt: new Date('2026-07-20T12:00:00Z') });
  assert.match(event.eventId, /^[0-9a-f-]{36}$/i);
  assert.notEqual(event.eventId, issued.commandId);
  assert.notEqual(event.eventId, issued.causationId);
  assert.notEqual(event.eventId, taskId);
  assert.equal(event.eventType, 'task.created');
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.aggregateType, 'task');
  assert.equal(event.aggregateId, taskId);
  assert.equal(event.actor, issued.actor);
  assert.equal(event.tenant, issued.tenant);
  assert.equal(event.correlationId, issued.correlationId);
  assert.equal(event.commandId, issued.commandId);
  assert.equal(event.causationId, issued.commandId);
  assert.equal(issued.causationId, proposalId);
  assert.equal(event.occurredAt, '2026-07-20T12:00:00.000Z');
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.payload), true);
});

test('event payload is the safe K4 result projection and prunes unknown data', () => {
  const event = createTaskCreatedEvent({
    command: command(),
    result: result({ description: 'do not include', employeeRecord: { email: 'private' }, eventId: 'client-value' }),
  });
  assert.deepEqual(event.payload, {
    taskId, title: 'Inspect freezer', priority: 'high', status: 'pending',
    assignedEmployeeId: null, dueDate: '2026-07-21',
  });
  assert.equal('description' in event.payload, false);
  assert.equal('employeeRecord' in event.payload, false);
  assert.notEqual(event.eventId, 'client-value');
});

test('unsupported event type and version fail closed', () => {
  assert.throws(() => createDomainEventEnvelope({
    definition: { ...TASK_CREATED_EVENT, eventType: 'task.deleted' },
    command: command(), payload: result(),
  }), error => error instanceof DomainEventError && error.code === 'UNSUPPORTED_EVENT_TYPE');
  assert.throws(() => createTaskCreatedEvent({ command: command(), result: result(), schemaVersion: 2 }),
    error => error.code === 'UNSUPPORTED_EVENT_VERSION');
});

test('malformed payload and mismatched command context fail closed', () => {
  assert.throws(() => createTaskCreatedEvent({ command: command(), result: result({ taskId: 'bad' }) }),
    error => error.code === 'INVALID_EVENT_PAYLOAD');
  const issued = command();
  assert.throws(() => createTaskCreatedEvent({
    command: { ...issued, tenant: { ...tenant, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } },
    result: result(),
  }), error => error.code === 'EVENT_CONTEXT_MISMATCH');
});

function memoryStore() {
  const rows = [];
  return {
    rows,
    store: {
      async insert(record) {
        if (rows.some(row => row.command_id === record.command_id && row.event_type === record.event_type)) return 'duplicate';
        rows.push(structuredClone(record));
        return 'inserted';
      },
      async findByCommand(commandId, eventType) {
        return rows.find(row => row.command_id === commandId && row.event_type === eventType) ?? null;
      },
    },
  };
}

test('recorder stores exactly one event per command and accepts an identical retry', async () => {
  const memory = memoryStore();
  const recorder = createDomainEventRecorder(memory.store);
  const issued = command();
  await recorder.record(createTaskCreatedEvent({ command: issued, result: result() }));
  await recorder.record(createTaskCreatedEvent({ command: issued, result: result() }));
  assert.equal(memory.rows.length, 1);
  assert.equal(memory.rows[0].company_id, tenant.tenantId);
  assert.equal(memory.rows[0].actor_id, actor.actorId);
});

test('conflicting duplicate and raw store failure map to safe recording errors', async () => {
  const memory = memoryStore();
  const recorder = createDomainEventRecorder(memory.store);
  const issued = command();
  await recorder.record(createTaskCreatedEvent({ command: issued, result: result() }));
  await assert.rejects(
    recorder.record(createTaskCreatedEvent({ command: issued, result: result({ title: 'Different' }) })),
    error => error.code === 'EVENT_RECORDING_FAILED',
  );
  const failed = createDomainEventRecorder({
    insert: async () => { throw new Error('password=secret host details'); },
    findByCommand: async () => null,
  });
  await assert.rejects(failed.record(createTaskCreatedEvent({ command: issued, result: result() })),
    error => error.code === 'EVENT_RECORDING_FAILED' && !error.message.includes('secret'));
});

test('handler records task.created only after successful task creation', async () => {
  const order = [];
  const events = [];
  const handler = createTaskCommandHandler({
    async createTaskRecord() { order.push('task'); return result(); },
  }, {
    async record(event) { order.push('event'); events.push(event); },
  });
  const issued = command();
  await handler.execute(issued);
  assert.deepEqual(order, ['task', 'event']);
  assert.equal(events[0].commandId, issued.commandId);
  assert.equal(events[0].payload.taskId, taskId);
});

test('handler records no event when task creation fails', async () => {
  let eventCalls = 0;
  const handler = createTaskCommandHandler({
    createTaskRecord: async () => { throw new Error('database detail'); },
  }, { record: async () => { eventCalls += 1; } });
  await assert.rejects(handler.execute(command()), error => error.code === 'TASK_CREATION_FAILED');
  assert.equal(eventCalls, 0);
});

test('event recording failure prevents successful handler completion', async () => {
  const handler = createTaskCommandHandler({ createTaskRecord: async () => result() }, {
    record: async () => { throw new Error('raw event database detail'); },
  });
  await assert.rejects(handler.execute(command()),
    error => error.code === 'EVENT_RECORDING_FAILED' && !error.message.includes('database detail'));
});

test('route completes proposal only after cohesive task handler succeeds', async () => {
  const route = await readFile(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  const handler = await readFile(new URL('../lib/brain/tasks/commands/create-task-command-handler.ts', import.meta.url), 'utf8');
  assert.ok(handler.indexOf('createTaskRecord({') < handler.indexOf('eventRecorder.record(event)'));
  assert.ok(route.indexOf('executeStoredProposal(') < route.indexOf('markProposalExecuted('));
  assert.match(route, /markProposalFailed\(proposalStore, stored\.id, stored\.payloadHash/);
  assert.ok(route.indexOf('createTaskApplicationService.execute(') < route.indexOf('new OpenAI('));
});

test('migration is server-only and enforces one event type per command', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202607200001_stage_k5_brain_domain_events.sql', import.meta.url), 'utf8');
  assert.match(sql, /UNIQUE \(command_id, event_type\)/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL[^;]+anon, authenticated/i);
  assert.match(sql, /GRANT SELECT, INSERT[^;]+service_role/i);
});

test('K5 contains no bus, dispatcher, registry, worker, subscription, or OpenAI dependency', async () => {
  const files = await Promise.all([
    '../lib/brain/kernel/events/domain-event-envelope.ts',
    '../lib/brain/kernel/events/domain-event-recorder.ts',
    '../lib/brain/tasks/events/task-created-event.ts',
    '../lib/brain/events/infrastructure/record-domain-event.server.ts',
  ].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  assert.doesNotMatch(files.join('\n'), /eventBus|dispatch\(|subscribe|registry|worker|OpenAI/i);
});
