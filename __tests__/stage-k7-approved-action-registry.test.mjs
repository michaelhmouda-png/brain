import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ApprovedActionRegistryError,
  createApprovedActionRegistry,
} from '../lib/brain/actions/approved-action-registry.ts';
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

const legacyActions = [
  'create_employee', 'record_inventory_movement',
  'create_shift', 'update_shift', 'delete_shift',
  'create_maintenance_ticket', 'update_maintenance_ticket', 'delete_maintenance_ticket', 'complete_maintenance_ticket',
  'create_announcement', 'update_announcement', 'delete_announcement',
  'create_incident', 'update_incident', 'delete_incident',
];

function legacyExecutors(overrides = {}) {
  return Object.fromEntries(legacyActions.map(action => [action, async () => ({ success: true })]).concat(Object.entries(overrides)));
}

test('create_task selects the K6 application service exactly once with trusted inputs unchanged', async () => {
  const calls = [];
  const payload = Object.freeze({ title: 'Task', priority: 'high', status: 'pending' });
  const registry = createApprovedActionRegistry({
    createTaskApplicationService: {
      async execute(input) { calls.push(input); return { taskId, title: 'Task', priority: 'high', status: 'pending', assignedEmployeeId: null, assignedEmployeeName: null, dueDate: null }; },
    },
    legacyExecutors: legacyExecutors(),
  });
  const output = await registry.execute({ context, action: 'create_task', payload, proposalId });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context, context);
  assert.equal(calls[0].payload, payload);
  assert.equal(calls[0].proposalId, proposalId);
  assert.deepEqual(output, { success: true });
  assert.equal(Object.isFrozen(output), true);
});

test('supported legacy action invokes only its existing executor and preserves safe success', async () => {
  const calls = [];
  const executors = legacyExecutors({
    create_shift: async payload => { calls.push(['create_shift', payload]); return { success: true, raw: 'hidden' }; },
    delete_shift: async payload => { calls.push(['delete_shift', payload]); return { success: true }; },
  });
  const registry = createApprovedActionRegistry({ createTaskApplicationService: null, legacyExecutors: executors });
  const output = await registry.execute({ context, action: 'create_shift', payload: { employee_id: taskId }, proposalId });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'create_shift');
  assert.deepEqual(calls[0][1], { employee_id: taskId, confirmed: true });
  assert.deepEqual(output, { success: true });
  assert.equal('raw' in output, false);
});

test('failed legacy result is projected to the common safe result', async () => {
  const registry = createApprovedActionRegistry({
    createTaskApplicationService: null,
    legacyExecutors: legacyExecutors({ create_incident: async () => ({ error: 'raw internal detail' }) }),
  });
  assert.deepEqual(await registry.execute({ context, action: 'create_incident', payload: {}, proposalId }), { success: false });
});

test('unsupported action fails closed and invokes no executor', async () => {
  let calls = 0;
  const executors = legacyExecutors(Object.fromEntries(legacyActions.map(action => [action, async () => { calls += 1; return { success: true }; }])));
  const registry = createApprovedActionRegistry({
    createTaskApplicationService: { execute: async () => { calls += 1; return {}; } },
    legacyExecutors: executors,
  });
  await assert.rejects(
    registry.execute({ context, action: 'client_invented_action', payload: {}, proposalId }),
    error => error instanceof ApprovedActionRegistryError && error.code === 'UNSUPPORTED_APPROVED_ACTION',
  );
  assert.equal(calls, 0);
});

test('payload cannot replace separately trusted context or proposal causation', async () => {
  let received;
  const registry = createApprovedActionRegistry({
    createTaskApplicationService: { execute: async input => { received = input; return { taskId, title: 'Task', priority: 'high', status: 'pending', assignedEmployeeId: null, assignedEmployeeName: null, dueDate: null }; } },
    legacyExecutors: legacyExecutors(),
  });
  const payload = { title: 'Task', actorId: 'attacker', tenantId: 'attacker', correlationId: 'attacker', proposalId: 'attacker' };
  await registry.execute({ context, action: 'create_task', payload, proposalId });
  assert.equal(received.context, context);
  assert.equal(received.proposalId, proposalId);
  assert.equal(received.payload, payload);
});

test('K6 through K5 still creates one command and one causally linked event', async () => {
  const commands = [];
  const events = [];
  const handler = createTaskCommandHandler({
    async createTaskRecord(input) { commands.push(input); return { taskId, title: input.payload.title, priority: input.payload.priority, status: input.payload.status, assignedEmployeeId: null, assignedEmployeeName: null, dueDate: null }; },
  }, { record: async event => { events.push(event); } });
  const service = createCreateTaskApplicationService({ handler });
  const registry = createApprovedActionRegistry({ createTaskApplicationService: service, legacyExecutors: legacyExecutors() });
  await registry.execute({ context, action: 'create_task', payload: { title: 'Task', priority: 'high', status: 'pending' }, proposalId });
  assert.equal(commands.length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].commandId, events[0].causationId);
  assert.equal(events[0].correlationId, context.actor.correlationId);
});

test('registry owns no proposal, HTTP, authentication, OpenAI, or dynamic registration behavior', async () => {
  const source = await readFile(new URL('../lib/brain/actions/approved-action-registry.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /NextRequest|NextResponse|OpenAI|claimProposal|markProposal|rejectProposal|authenticate|conversation/i);
  assert.doesNotMatch(source, /\.register\(|\.add\(|\.remove\(|dynamic import|import\(|plugin|mediator|eventBus|commandBus|workflow|container/i);
});

test('route claims before registry, completes afterward, and no longer selects executors', async () => {
  const route = await readFile(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  const claim = route.indexOf('claimProposalForExecution');
  const execute = route.indexOf('approvedActionRegistry.execute({');
  const complete = route.indexOf('markProposalExecuted(', execute);
  assert.ok(claim > 0 && execute > claim && complete > execute);
  assert.match(route, /markProposalFailed\(proposalStore, stored\.id, stored\.payloadHash/);
  assert.ok(execute < route.indexOf('new OpenAI('));
  assert.doesNotMatch(route, /createTaskApplicationService\.execute\(/);
  assert.doesNotMatch(route, /taskCreateHandler\.execute|createTaskCommand\(|createTaskCreatedEvent|eventRecorder\.record/);
});

test('all 16 existing canonical proposal actions are explicitly represented', async () => {
  const source = await readFile(new URL('../lib/brain/actions/approved-action-registry.ts', import.meta.url), 'utf8');
  for (const action of ['create_task', ...legacyActions]) assert.match(source, new RegExp(`case '${action}'`));
});
