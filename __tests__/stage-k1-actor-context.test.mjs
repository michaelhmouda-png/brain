import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveHumanActorContext } from '../lib/brain/kernel/actor-context.ts';
import { ActorContextError } from '../lib/brain/kernel/errors.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';

function access(profile = { id: USER, full_name: 'Trusted Manager', role: 'manager', status: 'active', company_id: COMPANY }, overrides = {}) {
  const calls = { profileIds: [], companyIds: [] };
  return {
    calls,
    value: {
      async getAuthenticatedUserId() { return USER; },
      async loadProfile(id) { calls.profileIds.push(id); return { profile, failed: false }; },
      async companyExists(id) { calls.companyIds.push(id); return id === COMPANY; },
      ...overrides,
    },
  };
}

async function expectCode(value, code) {
  await assert.rejects(() => resolveHumanActorContext(value, () => 'server-correlation'), error => error instanceof ActorContextError && error.code === code);
}

test('valid active human actor resolves exclusively from trusted persisted data', async () => {
  const a=access(); const actor=await resolveHumanActorContext(a.value,()=> 'server-correlation');
  assert.deepEqual(actor,{ actorId:USER,authUserId:USER,profileId:USER,companyId:COMPANY,role:'manager',status:'active',actorType:'human',correlationId:'server-correlation',displayName:'Trusted Manager' });
  assert.deepEqual(a.calls.profileIds,[USER]); assert.deepEqual(a.calls.companyIds,[COMPANY]);
});

test('missing authentication fails before profile or tenant access', async () => {
  const a=access(undefined,{async getAuthenticatedUserId(){return null;}}); await expectCode(a.value,'UNAUTHENTICATED');
  assert.deepEqual(a.calls.profileIds,[]); assert.deepEqual(a.calls.companyIds,[]);
});

test('missing profile fails safely', async () => { await expectCode(access(null).value,'ACCOUNT_NOT_PROVISIONED'); });
test('inactive profile fails safely', async () => { await expectCode(access({id:USER,role:'manager',status:'inactive',company_id:COMPANY}).value,'ACCOUNT_NOT_PROVISIONED'); });
test('invalid role fails safely', async () => { await expectCode(access({id:USER,role:'administrator',status:'active',company_id:COMPANY}).value,'ACCOUNT_NOT_PROVISIONED'); });
test('missing company assignment fails safely', async () => { await expectCode(access({id:USER,role:'manager',status:'active',company_id:null}).value,'ACCOUNT_NOT_PROVISIONED'); });
test('invalid company assignment fails safely', async () => { await expectCode(access({id:USER,role:'manager',status:'active',company_id:'33333333-3333-4333-8333-333333333333'}).value,'ACCOUNT_NOT_PROVISIONED'); });

test('caller role and company values cannot override persisted authority', async () => {
  const caller={role:'owner',companyId:'33333333-3333-4333-8333-333333333333'};
  const actor=await resolveHumanActorContext(access().value,()=> 'server-correlation');
  assert.equal(actor.role,'manager'); assert.equal(actor.companyId,COMPANY);
  assert.notEqual(actor.role,caller.role); assert.notEqual(actor.companyId,caller.companyId);
});

test('correlation ID is generated at the trusted resolver boundary', async () => {
  const actor=await resolveHumanActorContext(access().value,()=> 'generated-on-server');
  assert.equal(actor.correlationId,'generated-on-server');
});

test('chat and Stage 0C proposal paths consume ActorContext', async () => {
  const route=await readFile(new URL('../app/api/brain/chat/route.ts',import.meta.url),'utf8');
  assert.match(route,/actorContext = await resolveActorContext\(supabase\)/);
  assert.match(route,/rejectProposal\(proposalStore, proposalId, actorContext\)/);
  assert.match(route,/claimProposalForExecution\(proposalStore, proposalId, actorContext\)/);
  assert.match(route,/actor: actorContext/);
  const proposals=await readFile(new URL('../lib/brain/action-proposals.ts',import.meta.url),'utf8');
  assert.match(proposals,/actor: ActorContext/);
});

test('ActorContext resolution precedes request parsing and OpenAI', async () => {
  const route=await readFile(new URL('../app/api/brain/chat/route.ts',import.meta.url),'utf8');
  const resolved=route.indexOf('await resolveActorContext(supabase)');
  assert.ok(resolved > 0 && resolved < route.indexOf('await request.json()') && resolved < route.indexOf('new OpenAI'));
});
