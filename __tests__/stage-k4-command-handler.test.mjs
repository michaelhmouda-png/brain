import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createTaskCommand } from '../lib/brain/tasks/commands/create-task-command.ts';
import {
  CreateTaskCommandError,
  createTaskCommandHandler,
} from '../lib/brain/tasks/commands/create-task-command-handler.ts';

const actor = Object.freeze({
  actorId: '11111111-1111-4111-8111-111111111111',
  authUserId: '11111111-1111-4111-8111-111111111111',
  profileId: '11111111-1111-4111-8111-111111111111',
  companyId: '22222222-2222-4222-8222-222222222222',
  role: 'manager', status: 'active', actorType: 'human',
  correlationId: '33333333-3333-4333-8333-333333333333', displayName: 'Manager',
});
const tenant = Object.freeze({
  scopeType: 'company', tenantId: actor.companyId, companyId: actor.companyId,
});
const context = Object.freeze({ actor, tenant });
const proposalId = '44444444-4444-4444-8444-444444444444';
const eventRecorder = { record: async () => {} };

function command(overrides = {}) {
  return createTaskCommand({
    context,
    proposalId,
    payload: {
      title: '  Inspect freezer  ', description: '  Before service  ',
      priority: 'high', status: 'pending', assigned_employee_id: null,
      due_date: '2026-07-21', ignored: 'drop me', ...overrides,
    },
  });
}

function dependencyHarness() {
  const calls = [];
  return {
    calls,
    dependencies: {
      async createTaskRecord(input) {
        calls.push(input);
        return {
          taskId: '55555555-5555-4555-8555-555555555555',
          title: input.payload.title,
          status: input.payload.status,
          priority: input.payload.priority,
          assignedEmployeeId: input.payload.assignedEmployeeId,
          assignedEmployeeName: input.payload.assignedEmployeeName,
          dueDate: input.payload.dueDate,
          rawDatabaseMetadata: 'must not escape',
        };
      },
    },
  };
}

test('valid task.create command executes through the focused handler', async () => {
  const harness = dependencyHarness();
  const issued = command();
  const result = await createTaskCommandHandler(harness.dependencies, eventRecorder).execute(issued);
  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0], {
    tenantId: tenant.tenantId,
    actorId: actor.actorId,
    payload: issued.payload,
  });
  assert.deepEqual(result, {
    taskId: '55555555-5555-4555-8555-555555555555',
    title: 'Inspect freezer', status: 'pending', priority: 'high',
    assignedEmployeeId: null, assignedEmployeeName: null, dueDate: '2026-07-21',
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal('rawDatabaseMetadata' in result, false);
});

test('handler receives canonical payload only and unknown fields do not reach infrastructure', async () => {
  const harness = dependencyHarness();
  await createTaskCommandHandler(harness.dependencies, eventRecorder).execute(command());
  assert.deepEqual(Object.keys(harness.calls[0].payload).sort(), [
    'assignedEmployeeId', 'assignedEmployeeName', 'description', 'dueDate',
    'priority', 'status', 'title', 'urgency',
  ]);
  assert.equal(harness.calls[0].payload.title, 'Inspect freezer');
  assert.equal(harness.calls[0].payload.description, 'Before service');
});

test('malicious business input cannot override tenant or actor identity', async () => {
  assert.throws(
    () => command({ companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    error => error.code === 'INVALID_COMMAND_PAYLOAD',
  );
  const harness = dependencyHarness();
  await createTaskCommandHandler(harness.dependencies, eventRecorder).execute(command());
  assert.equal(harness.calls[0].tenantId, tenant.tenantId);
  assert.equal(harness.calls[0].actorId, actor.actorId);
});

test('unsupported command type and schema version fail closed', async () => {
  const handler = createTaskCommandHandler(dependencyHarness().dependencies, eventRecorder);
  const valid = command();
  await assert.rejects(
    handler.execute({ ...valid, commandType: 'task.delete' }),
    error => error instanceof CreateTaskCommandError && error.code === 'UNSUPPORTED_COMMAND_TYPE',
  );
  await assert.rejects(
    handler.execute({ ...valid, schemaVersion: 2 }),
    error => error instanceof CreateTaskCommandError && error.code === 'UNSUPPORTED_COMMAND_VERSION',
  );
});

test('actor and tenant context mismatch fails before infrastructure', async () => {
  const harness = dependencyHarness();
  const valid = command();
  await assert.rejects(
    createTaskCommandHandler(harness.dependencies, eventRecorder).execute({
      ...valid,
      tenant: { ...valid.tenant, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    }),
    error => error.code === 'COMMAND_CONTEXT_MISMATCH',
  );
  assert.equal(harness.calls.length, 0);
});

test('infrastructure failures map to a stable safe handler error', async () => {
  const raw = new Error('password=secret database host details');
  const handler = createTaskCommandHandler({ createTaskRecord: async () => { throw raw; } }, eventRecorder);
  await assert.rejects(
    handler.execute(command()),
    error => error instanceof CreateTaskCommandError &&
      error.code === 'TASK_CREATION_FAILED' && !error.message.includes('secret'),
  );
});

test('command identity and idempotency remain unchanged across execution', async () => {
  const issued = command();
  const before = { commandId: issued.commandId, idempotencyKey: issued.idempotencyKey };
  await createTaskCommandHandler(dependencyHarness().dependencies, eventRecorder).execute(issued);
  assert.deepEqual({ commandId: issued.commandId, idempotencyKey: issued.idempotencyKey }, before);
  assert.equal(issued.causationId, proposalId);
});

test('approved route calls handler after claim and preserves proposal transitions', async () => {
  const route = await readFile(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  const service = await readFile(new URL('../lib/brain/tasks/application/create-task-application-service.ts', import.meta.url), 'utf8');
  const registry = await readFile(new URL('../lib/brain/actions/approved-action-registry.ts', import.meta.url), 'utf8');
  assert.match(route, /approvedActionRegistry\.execute/);
  assert.match(registry, /createTaskApplicationService\.execute/);
  assert.match(service, /dependencies\.handler\.execute\(command\)/);
  assert.ok(route.indexOf('claimProposalForExecution') < route.indexOf('approvedActionRegistry.execute'));
  assert.ok(route.indexOf('approvedActionRegistry.execute') < route.indexOf('markProposalExecuted('));
  assert.match(route, /markProposalFailed\(proposalStore, stored\.id, stored\.payloadHash/);
});

test('approved proposal branch executes before OpenAI initialization', async () => {
  const route = await readFile(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  assert.ok(route.indexOf('claimProposalForExecution') < route.indexOf('new OpenAI('));
  assert.ok(route.indexOf('approvedActionRegistry.execute(') < route.indexOf('new OpenAI('));
});

test('K4 handler remains focused without dispatch, middleware, or retry behavior', async () => {
  const handler = await readFile(new URL('../lib/brain/tasks/commands/create-task-command-handler.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(handler, /executeCommand|dispatch\(|registry|middleware|retry/i);
});
