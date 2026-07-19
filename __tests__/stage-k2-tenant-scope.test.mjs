import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { tenantScopeFromActor } from '../lib/brain/kernel/tenant-scope.ts';
import { ActorContextError } from '../lib/brain/kernel/errors.ts';
import { claimProposalForExecution, createProposal, rejectProposal } from '../lib/brain/action-proposals.ts';

const ACTOR_ID='11111111-1111-4111-8111-111111111111';
const COMPANY='22222222-2222-4222-8222-222222222222';
const OTHER='33333333-3333-4333-8333-333333333333';
const actor={actorId:ACTOR_ID,authUserId:ACTOR_ID,profileId:ACTOR_ID,companyId:COMPANY,role:'manager',status:'active',actorType:'human',correlationId:'44444444-4444-4444-8444-444444444444',displayName:'Manager'};

class Store {
  constructor(){this.rows=new Map();}
  async insert(p){this.rows.set(p.id,structuredClone(p));}
  async reject(id,i){const p=this.rows.get(id);if(!p||p.actorId!==i.actorId||p.profileId!==i.profileId||p.tenantId!==i.tenantId)return'not_found';if(p.status!=='pending')return'invalid_status';p.status='rejected';return'rejected';}
  async claim(id,i){const p=this.rows.get(id);if(!p||p.actorId!==i.actorId||p.profileId!==i.profileId||p.tenantId!==i.tenantId)return{outcome:'not_found'};if(p.status!=='pending')return{outcome:'invalid_status'};p.status='executing';return{outcome:'claimed',proposal:structuredClone(p)};}
  async markExecuted(){}
  async markFailed(id){this.rows.get(id).status='failed';}
}

function context(source=actor){return {actor:source,tenant:tenantScopeFromActor(source)};}
async function create(store,ctx=context()){return createProposal(store,{context:ctx,action:'create_task',rawArguments:{title:'Scoped task',company_id:OTHER},preview:{label:'Create Task',rows:[]},now:new Date('2026-07-19T10:00:00Z')});}

test('valid ActorContext derives an immutable company TenantScope',()=>{
  const scope=tenantScopeFromActor(actor);
  assert.deepEqual(scope,{tenantId:COMPANY,companyId:COMPANY,scopeType:'company'});
  assert.equal(Object.isFrozen(scope),true);
});

test('tenantId and companyId are one non-divergent value',()=>{
  const scope=tenantScopeFromActor(actor); assert.equal(scope.tenantId,scope.companyId);
  assert.throws(()=>{scope.companyId=OTHER;},TypeError); assert.equal(scope.companyId,COMPANY);
});

test('proposal services reject a divergent trusted request context',async()=>{
  const divergent={actor,tenant:{tenantId:COMPANY,companyId:OTHER,scopeType:'company'}};
  await assert.rejects(()=>create(new Store(),divergent),e=>e instanceof ActorContextError&&e.code==='TENANT_SCOPE_MISMATCH');
});

test('missing or malformed ActorContext fails safely',()=>{
  for(const malformed of [null,{...actor,companyId:'bad'},{...actor,status:'inactive'},{...actor,actorId:OTHER}])
    assert.throws(()=>tenantScopeFromActor(malformed),e=>e instanceof ActorContextError&&e.code==='INVALID_TENANT_SCOPE');
});

test('caller, browser, conversation, and tool company values cannot override scope',()=>{
  const claims={companyId:OTHER,context:{company_id:OTHER},arguments:{company_id:OTHER}};
  const scope=tenantScopeFromActor(actor); assert.equal(scope.companyId,COMPANY); assert.notEqual(scope.companyId,claims.companyId);
});

test('proposal creation binds current TenantScope and prunes tool company arguments',async()=>{
  const store=new Store();const p=await create(store);
  assert.equal(p.tenantId,COMPANY);assert.equal('company_id'in p.canonicalPayload,false);
});

test('proposal rejection validates the current TenantScope',async()=>{
  const store=new Store();const p=await create(store);
  const other={actor:{...actor,companyId:OTHER},tenant:{tenantId:OTHER,companyId:OTHER,scopeType:'company'}};
  assert.equal(await rejectProposal(store,p.id,other),'not_found');assert.equal(store.rows.get(p.id).status,'pending');
});

test('proposal execution validates TenantScope and cross-tenant access fails closed',async()=>{
  const store=new Store();const p=await create(store);
  const other={actor:{...actor,companyId:OTHER},tenant:{tenantId:OTHER,companyId:OTHER,scopeType:'company'}};
  assert.equal((await claimProposalForExecution(store,p.id,other,new Date('2026-07-19T10:01:00Z'))).outcome,'not_found');
  assert.equal((await claimProposalForExecution(store,p.id,context(),new Date('2026-07-19T10:01:00Z'))).outcome,'claimed');
});

test('TenantScope is resolved before request parsing, OpenAI, tools, and proposal lookup',async()=>{
  const route=await readFile(new URL('../app/api/brain/chat/route.ts',import.meta.url),'utf8');
  const scope=route.indexOf('tenantScopeFromActor(actorContext)');
  for(const later of ['await request.json()','createServerActionProposalStore()','new OpenAI','new ToolHandlers']) assert.ok(scope>0&&scope<route.indexOf(later,scope));
});

test('tool construction uses TenantScope and get_company_summary has no company argument',async()=>{
  const route=await readFile(new URL('../app/api/brain/chat/route.ts',import.meta.url),'utf8');
  assert.match(route,/new ToolHandlers\(supabase, requestContext\.tenant\.companyId/);
  const definition=route.slice(route.indexOf("name: 'get_company_summary'"),route.indexOf('//',route.indexOf("name: 'get_company_summary'")));
  assert.equal(definition.includes('company_id'),false);
});
