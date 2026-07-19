import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCreateTaskApplicationService } from '../lib/brain/tasks/application/create-task-application-service.ts';
import { createTaskCommandHandler } from '../lib/brain/tasks/commands/create-task-command-handler.ts';

const actor = Object.freeze({
  actorId: '11111111-1111-4111-8111-111111111111',
  authUserId: '11111111-1111-4111-8111-111111111111',
  profileId: '11111111-1111-4111-8111-111111111111',
  companyId: '22222222-2222-4222-8222-222222222222',
  role: 'manager', status: 'active', actorType: 'human',
  correlationId: '33333333-3333-4333-8333-333333333333', displayName: 'Manager',
});
const tenant = Object.freeze({ scopeType: 'company', tenantId: actor.companyId, companyId: actor.companyId });
const context = Object.freeze({ actor, tenant });
const proposalId = '44444444-4444-4444-8444-444444444444';
const taskId = '55555555-5555-4555-8555-555555555555';

const storedPayload = Object.freeze({
  title: '  Inspect freezer  ', description: '  Before service  ',
  priority: 'high', status: 'pending', assigned_employee_id: null,
  due_date: '2026-07-21', unknown: 'remove',
});

function safeResult(extra = {}) {
  return {
    taskId, title: 'Inspect freezer', status: 'pending', priority: 'high',
    assignedEmployeeId: null, assignedEmployeeName: null, dueDate: '2026-07-21',
    ...extra,
  };
}

test('application service creates one trusted command and invokes handler once', async () => {
  const commands = [];
  const service = createCreateTaskApplicationService({
    handler: { async execute(command) { commands.push(command); return safeResult(); } },
  });
  const result = await service.execute({ context, payload: storedPayload, proposalId });
  assert.equal(commands.length, 1);
  const command = commands[0];
  assert.equal(command.commandType, 'task.create');
  assert.equal(command.actor, actor);
  assert.equal(command.tenant, tenant);
  assert.equal(command.correlationId, actor.correlationId);
  assert.equal(command.causationId, proposalId);
  assert.equal(command.payload.title, 'Inspect freezer');
  assert.equal('unknown' in command.payload, false);
  assert.deepEqual(result, safeResult());
  assert.equal(Object.isFrozen(result), true);
});

test('payload cannot override command identity, context, or causation', async () => {
  let received;
  const service = createCreateTaskApplicationService({
    handler: { async execute(command) { received = command; return safeResult(); } },
  });
  await assert.rejects(service.execute({
    context,
    proposalId,
    payload: { ...storedPayload, actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  }), error => error.code === 'INVALID_COMMAND_PAYLOAD');
  await service.execute({ context, proposalId, payload: storedPayload });
  assert.equal(received.actor.actorId, actor.actorId);
  assert.equal(received.tenant.tenantId, tenant.tenantId);
  assert.equal(received.causationId, proposalId);
});

test('service returns only the explicit safe application projection', async () => {
  const service = createCreateTaskApplicationService({
    handler: { async execute() { return safeResult({ commandId: 'hidden', eventId: 'hidden', rawDatabase: { secret: true } }); } },
  });
  const result = await service.execute({ context, payload: storedPayload, proposalId });
  assert.deepEqual(Object.keys(result).sort(), [
    'assignedEmployeeId', 'assignedEmployeeName', 'dueDate', 'priority',
    'status', 'taskId', 'title',
  ]);
  assert.equal('commandId' in result, false);
  assert.equal('eventId' in result, false);
  assert.equal('rawDatabase' in result, false);
});

test('existing K4 handler records exactly one causally linked K5 event', async () => {
  const events = [];
  const handler = createTaskCommandHandler({ createTaskRecord: async () => safeResult() }, {
    record: async event => { events.push(event); },
  });
  const service = createCreateTaskApplicationService({ handler });
  await service.execute({ context, payload: storedPayload, proposalId });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'task.created');
  assert.equal(events[0].causationId, events[0].commandId);
  assert.equal(events[0].correlationId, context.actor.correlationId);
  assert.equal(events[0].payload.taskId, taskId);
});

test('handler failure passes through without returning internal state', async () => {
  const failure = new Error('safe-handler-error');
  const service = createCreateTaskApplicationService({
    handler: { execute: async () => { throw failure; } },
  });
  await assert.rejects(service.execute({ context, payload: storedPayload, proposalId }), failure);
});

test('approved create_task route delegates K3-K5 orchestration to the application service', async () => {
  const route = await readFile(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  const branch = route.slice(route.indexOf("case 'create_task':"), route.indexOf("case 'record_inventory_movement':"));
  assert.match(branch, /createTaskApplicationService\.execute\(\{ context, payload, proposalId \}\)/);
  assert.doesNotMatch(branch, /createTaskCommand|taskCreateHandler\.execute|createTaskCreatedEvent|eventRecorder\.record/);
  assert.ok(route.indexOf('claimProposalForExecution') < route.indexOf('executeStoredProposal('));
  assert.ok(route.indexOf('executeStoredProposal(') < route.indexOf('markProposalExecuted('));
  assert.match(route, /markProposalFailed\(proposalStore, stored\.id, stored\.payloadHash/);
});

test('application service owns no HTTP, proposal lifecycle, OpenAI, or conversation concerns', async () => {
  const source = await readFile(new URL('../lib/brain/tasks/application/create-task-application-service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /NextRequest|NextResponse|OpenAI|claimProposal|markProposal|rejectProposal|conversation/i);
  assert.doesNotMatch(source, /dispatch\(|registry|workflow|middleware|retry/i);
});

test('other approved mutation branches remain delegated to existing handlers', async () => {
  const route = await readFile(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  for (const action of ['create_employee', 'record_inventory_movement', 'create_shift', 'create_maintenance_ticket', 'create_incident']) {
    assert.match(route, new RegExp(`case '${action}': return handlers\\.`));
  }
});
