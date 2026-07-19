import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCommandEnvelope, COMMAND_SCHEMA_VERSION } from '../lib/brain/kernel/commands/command-envelope.ts';
import { CommandError } from '../lib/brain/kernel/commands/command-errors.ts';
import { canonicalizeCreateTaskPayload, createTaskCommand, CREATE_TASK_COMMAND } from '../lib/brain/tasks/commands/create-task-command.ts';

const ACTOR='11111111-1111-4111-8111-111111111111';
const TENANT='22222222-2222-4222-8222-222222222222';
const PROPOSAL='33333333-3333-4333-8333-333333333333';
const EMPLOYEE='44444444-4444-4444-8444-444444444444';
const actor={actorId:ACTOR,authUserId:ACTOR,profileId:ACTOR,companyId:TENANT,role:'manager',status:'active',actorType:'human',correlationId:'55555555-5555-4555-8555-555555555555',displayName:'Manager'};
const tenant=Object.freeze({tenantId:TENANT,companyId:TENANT,scopeType:'company'});
const context={actor,tenant};
const raw={title:'  Clean the bar  ',description:'  Before service  ',priority:'HIGH',status:'In Progress',assigned_employee_id:EMPLOYEE,assigned_employee_name:' Maroun ',due_date:'tomorrow',unknown:'discard'};

function command(overrides={}) { return createTaskCommand({payload:raw,context,proposalId:PROPOSAL,now:new Date('2026-07-20T10:00:00Z'),...overrides}); }

test('creates a valid immutable task.create command envelope',()=>{
  const c=command();
  assert.match(c.commandId,/^[0-9a-f-]{36}$/i);assert.equal(c.commandType,'task.create');assert.equal(c.schemaVersion,1);
  assert.equal(c.correlationId,actor.correlationId);assert.equal(c.causationId,PROPOSAL);assert.equal(c.actor,actor);assert.equal(c.tenant,tenant);
  assert.equal(c.issuedAt,'2026-07-20T10:00:00.000Z');assert.equal(Object.isFrozen(c),true);assert.equal(Object.isFrozen(c.payload),true);
});

test('canonical task payload trims, normalizes enums, maps fields, and removes unknowns',()=>{
  assert.deepEqual(canonicalizeCreateTaskPayload(raw),{title:'Clean the bar',description:'Before service',priority:'high',status:'in_progress',assignedEmployeeId:EMPLOYEE,assignedEmployeeName:'Maroun',urgency:null,dueDate:'tomorrow'});
  assert.equal('unknown'in command().payload,false);
});

test('empty optional strings normalize to null',()=>{
  const p=canonicalizeCreateTaskPayload({title:'Task',description:' ',assigned_employee_id:'',assigned_employee_name:'',urgency:'',due_date:''});
  assert.deepEqual({...p},{title:'Task',description:null,priority:'medium',status:'pending',assignedEmployeeId:null,assignedEmployeeName:null,urgency:null,dueDate:null});
});

test('current natural-language urgency behavior remains canonical',()=>{
  const p=canonicalizeCreateTaskPayload({title:'Task',urgency:'urgent'});
  assert.equal(p.priority,'critical');assert.equal(p.urgency,'urgent');
});

test('trusted fields are rejected inside business payload',()=>{
  for(const field of ['companyId','tenantId','role','actorId','profileId','confirmed','authorization','isAuthorized'])
    assert.throws(()=>canonicalizeCreateTaskPayload({title:'Task',[field]:'attacker'}),e=>e instanceof CommandError&&e.code==='INVALID_COMMAND_PAYLOAD');
});

test('malformed UUID and date values fail closed',()=>{
  assert.throws(()=>canonicalizeCreateTaskPayload({title:'Task',assigned_employee_id:'bad'}),/INVALID_COMMAND_PAYLOAD/);
  assert.throws(()=>canonicalizeCreateTaskPayload({title:'Task',due_date:'next someday'}),/INVALID_COMMAND_PAYLOAD/);
});

test('unsupported schema version and malformed causation fail closed',()=>{
  assert.throws(()=>command({schemaVersion:2}),e=>e instanceof CommandError&&e.code==='UNSUPPORTED_COMMAND_VERSION');
  assert.throws(()=>command({proposalId:'client-value'}),e=>e instanceof CommandError&&e.code==='INVALID_COMMAND');
  assert.equal(COMMAND_SCHEMA_VERSION,1);
});

test('idempotency is deterministic while commandId remains unique',()=>{
  const a=command(),b=command({now:new Date('2027-01-01T00:00:00Z')});
  assert.equal(a.idempotencyKey,b.idempotencyKey);assert.notEqual(a.commandId,b.commandId);
});

test('idempotency changes with payload, actor, tenant, version material, and causation',()=>{
  const base=command().idempotencyKey;
  assert.notEqual(base,command({payload:{...raw,title:'Other'}}).idempotencyKey);
  const otherActor='66666666-6666-4666-8666-666666666666';
  const otherTenant='77777777-7777-4777-8777-777777777777';
  assert.notEqual(base,command({context:{actor:{...actor,actorId:otherActor,authUserId:otherActor,profileId:otherActor},tenant}}).idempotencyKey);
  assert.notEqual(base,command({context:{actor:{...actor,companyId:otherTenant},tenant:{tenantId:otherTenant,companyId:otherTenant,scopeType:'company'}}}).idempotencyKey);
  assert.notEqual(base,command({proposalId:'88888888-8888-4888-8888-888888888888'}).idempotencyKey);
});

test('payload cannot override actor, tenant, command identity, correlation, or causation',()=>{
  const c=createTaskCommand({payload:{title:'Task',commandId:'x',correlationId:'x',causationId:'x'},context,proposalId:PROPOSAL});
  assert.equal(c.actor,actor);assert.equal(c.tenant,tenant);assert.equal(c.correlationId,actor.correlationId);assert.equal(c.causationId,PROPOSAL);assert.notEqual(c.commandId,'x');
  assert.equal('commandId'in c.payload,false);assert.equal('correlationId'in c.payload,false);assert.equal('causationId'in c.payload,false);
});

test('mismatched request context fails before envelope creation',()=>{
  assert.throws(()=>createCommandEnvelope({definition:CREATE_TASK_COMMAND,payload:{title:'Task'},context:{actor,tenant:{...tenant,tenantId:'99999999-9999-4999-8999-999999999999'}},causationId:PROPOSAL}),e=>e instanceof CommandError&&e.code==='COMMAND_CONTEXT_MISMATCH');
});

test('approved create_task creates envelope after claim and executes only mapped payload',async()=>{
  const route=await readFile(new URL('../app/api/brain/chat/route.ts',import.meta.url),'utf8');
  const claim=route.indexOf('claimProposalForExecution');
  const commandCreation=route.indexOf('createTaskCommand({ payload, context, proposalId })');
  const mutation=route.indexOf('return handlers.createTask({',commandCreation);
  assert.ok(claim>0&&commandCreation>claim&&mutation>commandCreation);
  const adapter=route.slice(commandCreation,route.indexOf("case 'record_inventory_movement'",commandCreation));
  assert.match(adapter,/title: command\.payload\.title/);assert.match(adapter,/confirmed: true/);
  assert.equal(adapter.includes('...payload'),false);assert.equal(adapter.includes('stored.canonicalPayload'),false);
});
