import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canonicalizeProposalArguments, claimProposalForExecution, createProposal, hashProposal,
  markProposalExecuted, PROPOSAL_SCHEMA_VERSION, rejectProposal,
} from '../lib/brain/action-proposals.ts';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const PROFILE = ACTOR;
const TENANT = '22222222-2222-4222-8222-222222222222';
const identity = { actorId: ACTOR, authUserId: ACTOR, profileId: PROFILE, companyId: TENANT, role: 'manager', status: 'active', actorType: 'human', correlationId: '66666666-6666-4666-8666-666666666666', displayName: 'Manager' };

class DurableMemoryStore {
  constructor(rows = new Map()) { this.rows = rows; }
  async insert(row) { if (this.rows.has(row.id)) throw new Error('duplicate'); this.rows.set(row.id, structuredClone(row)); }
  async reject(id, actor) {
    const p=this.rows.get(id); if(!p || p.actorId!==actor.actorId || p.profileId!==actor.profileId || p.tenantId!==actor.tenantId) return 'not_found';
    if(p.status!=='pending') return 'invalid_status'; p.status='rejected'; return 'rejected';
  }
  async claim(id, actor, now) {
    const p=this.rows.get(id); if(!p || p.actorId!==actor.actorId || p.profileId!==actor.profileId || p.tenantId!==actor.tenantId) return {outcome:'not_found'};
    if(p.status==='executed') return {outcome:'executed',safeResult:p.safeResult};
    if(p.status!=='pending') return {outcome:'invalid_status'};
    if(p.expiresAt<=now) { p.status='expired'; return {outcome:'expired'}; }
    p.status='executing'; return {outcome:'claimed',proposal:structuredClone(p)};
  }
  async markExecuted(id, hash, safeResult) { const p=this.rows.get(id); if(!p || p.status!=='executing' || p.payloadHash!==hash) throw new Error('transition'); p.status='executed'; p.safeResult=safeResult; }
  async markFailed(id, hash, code) { const p=this.rows.get(id); if(!p || p.status!=='executing' || p.payloadHash!==hash) throw new Error('transition'); p.status='failed'; p.safeResult=null; p.error=code; }
}

async function proposal(store, overrides={}) {
  return createProposal(store, { actor: identity, action:'create_task', rawArguments:{title:'Clean bar',priority:'high',assigned_employee_id:'33333333-3333-4333-8333-333333333333'}, preview:{label:'Create Task',rows:[{key:'Title',value:'Clean bar'}]}, now:new Date('2026-07-19T10:00:00Z'), ...overrides });
}

test('canonicalizes and prunes model arguments before persistence', async () => {
  const result=canonicalizeProposalArguments('create_task',{title:'  Clean bar ',priority:'high',confirmed:true,company_id:TENANT,role:'owner',evil:'x'});
  assert.deepEqual(result.payload,{title:'Clean bar',priority:'high'});
});

test('hash binds action, canonical arguments, actor, tenant, and schema version', () => {
  const payload={title:'Clean bar'};
  const base=hashProposal('create_task',payload,identity);
  assert.notEqual(base,hashProposal('create_shift',payload,identity));
  assert.notEqual(base,hashProposal('create_task',{title:'Other'},identity));
  assert.notEqual(base,hashProposal('create_task',payload,{...identity,actorId:'44444444-4444-4444-8444-444444444444'}));
  assert.notEqual(base,hashProposal('create_task',payload,{...identity,companyId:'55555555-5555-4555-8555-555555555555'}));
  assert.notEqual(base,hashProposal('create_task',payload,identity,PROPOSAL_SCHEMA_VERSION+1));
});

test('wrong actor, profile, and tenant cannot claim a proposal', async () => {
  const store=new DurableMemoryStore(); const p=await proposal(store);
  for(const changed of [{actorId:'44444444-4444-4444-8444-444444444444'},{profileId:'44444444-4444-4444-8444-444444444444'},{companyId:'44444444-4444-4444-8444-444444444444'}])
    assert.equal((await claimProposalForExecution(store,p.id,{...identity,...changed},new Date('2026-07-19T10:01:00Z'))).outcome,'not_found');
});

test('expired and rejected proposals fail closed', async () => {
  const store=new DurableMemoryStore(); const expired=await proposal(store);
  assert.equal((await claimProposalForExecution(store,expired.id,identity,new Date('2026-07-19T10:11:00Z'))).outcome,'expired');
  const rejected=await proposal(store); assert.equal(await rejectProposal(store,rejected.id,identity),'rejected');
  assert.equal((await claimProposalForExecution(store,rejected.id,identity,new Date('2026-07-19T10:01:00Z'))).outcome,'invalid_status');
});

test('concurrent confirmations produce one claim and executed retries return safe result', async () => {
  const store=new DurableMemoryStore(); const p=await proposal(store);
  const results=await Promise.all(Array.from({length:8},()=>claimProposalForExecution(store,p.id,identity,new Date('2026-07-19T10:01:00Z'))));
  assert.equal(results.filter(r=>r.outcome==='claimed').length,1);
  const claimed=results.find(r=>r.outcome==='claimed'); await markProposalExecuted(store,p.id,claimed.proposal.payloadHash,'Task created successfully.');
  assert.deepEqual(await claimProposalForExecution(store,p.id,identity,new Date('2026-07-19T10:02:00Z')),{outcome:'executed',safeResult:'Task created successfully.'});
});

test('proposal state survives recreation of the service/store adapter', async () => {
  const rows=new Map(); const first=new DurableMemoryStore(rows); const p=await proposal(first);
  const recreated=new DurableMemoryStore(rows);
  assert.equal((await claimProposalForExecution(recreated,p.id,identity,new Date('2026-07-19T10:01:00Z'))).outcome,'claimed');
});

test('stored payload hash mismatch fails closed and marks failed', async () => {
  const store=new DurableMemoryStore(); const p=await proposal(store); store.rows.get(p.id).canonicalPayload.title='Altered';
  assert.equal((await claimProposalForExecution(store,p.id,identity,new Date('2026-07-19T10:01:00Z'))).outcome,'invalid_status');
  assert.equal(store.rows.get(p.id).status,'failed');
});

test('client protocol exposes only opaque proposal display data', async () => {
  const page=await readFile(new URL('../app/dashboard/ai-assistant/page.tsx',import.meta.url),'utf8');
  assert.match(page,/proposalId = pendingAction\.id/); assert.match(page,/decision = 'approve'/);
  assert.doesNotMatch(page,/requestBody\.pendingAction|requestBody\.confirmed/);
  const route=await readFile(new URL('../app/api/brain/chat/route.ts',import.meta.url),'utf8');
  const response=route.slice(route.indexOf("proposal: { id: created.id"),route.indexOf("context: conversationContext",route.indexOf("proposal: { id: created.id")));
  for(const secret of ['canonicalAction','canonicalPayload','payloadHash','actorId','profileId','tenantId','requiredRole','idempotencyKey']) assert.equal(response.includes(secret),false);
});

test('migration locks normal clients out and claims pending atomically', async () => {
  const sql=await readFile(new URL('../supabase/migrations/202607190001_stage0c_brain_action_proposals.sql',import.meta.url),'utf8');
  assert.match(sql,/revoke all on public\.brain_action_proposals from public, anon, authenticated/i);
  assert.match(sql,/update public\.brain_action_proposals[\s\S]*status='pending'[\s\S]*returning \* into p/i);
  assert.doesNotMatch(sql,/grant .*authenticated/i);
});

test('approval path is before OpenAI initialization and list maintenance is not dispatchable', async () => {
  const route=await readFile(new URL('../app/api/brain/chat/route.ts',import.meta.url),'utf8');
  assert.ok(route.indexOf("decision === 'approve'") < route.indexOf('const openai = new OpenAI'));
  const dispatcher=route.slice(route.indexOf('async function executeStoredProposal'),route.indexOf('function mayExecuteProposal'));
  assert.equal(dispatcher.includes('list_maintenance_tickets'),false);
});
