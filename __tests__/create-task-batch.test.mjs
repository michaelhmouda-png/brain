import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { canonicalizeProposalArguments } from '../lib/brain/action-proposals.ts';
import { createApprovedActionRegistry } from '../lib/brain/actions/approved-action-registry.ts';
import { localDateTimeToInstant } from '../lib/brain/tasks/batch/task-batch-time.ts';

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const migration=read('supabase/migrations/202607210021_create_task_batch.sql');
const route=read('app/api/brain/chat/route.ts');
const batch=read('lib/brain/tasks/batch/create-task-batch.server.ts');
const batchTime=read('lib/brain/tasks/batch/task-batch-time.ts');

const employee='11111111-1111-4111-8111-111111111111';
const location='22222222-2222-4222-8222-222222222222';
const previewCorrelation='33333333-3333-4333-8333-333333333333';
const confirmationCorrelation='44444444-4444-4444-8444-444444444444';
const item=(index)=>{const day=22+Math.floor(index/12);const hour=9+(index%12);return {item_index:index,title:`Task ${index+1}`,description:`Description ${index+1}`,assigned_employee_id:employee,assigned_employee_name:'Khaled Ismaeil',location_id:location,location_name:'BistrHaut',priority:'high',status:'pending',due_local:`2026-07-${day}T${String(hour).padStart(2,'0')}:00`,due_at:`2026-07-${day}T${String(hour-3).padStart(2,'0')}:00:00.000Z`,due_date:`2026-07-${day}`};};

test('four tasks canonicalize into one ordered batch proposal payload',()=>{
  const result=canonicalizeProposalArguments('create_task_batch',{timezone:'Asia/Beirut',tasks:[0,1,2,3].map(item)});
  assert.equal(result.action,'create_task_batch');assert.equal(result.payload.tasks.length,4);
  assert.deepEqual(result.payload.tasks.map(task=>task.item_index),[0,1,2,3]);
  assert.equal(result.payload.tasks[0].description,'Description 1');
});

test('batch execution retains proposal correlation while current ActorContext remains authoritative',async()=>{
  const context=Object.freeze({
    actor:Object.freeze({actorId:'55555555-5555-4555-8555-555555555555',authUserId:'55555555-5555-4555-8555-555555555555',profileId:'55555555-5555-4555-8555-555555555555',companyId:'66666666-6666-4666-8666-666666666666',role:'manager',status:'active',actorType:'human',correlationId:confirmationCorrelation,displayName:'Manager',employeeId:null,preferredLanguage:'en'}),
    tenant:Object.freeze({scopeType:'company',tenantId:'66666666-6666-4666-8666-666666666666',companyId:'66666666-6666-4666-8666-666666666666'}),
  });
  let received;
  const registry=createApprovedActionRegistry({createTaskApplicationService:null,executeCreateTaskBatch:async(input)=>{received=input;return {success:true,createdCount:4};},legacyExecutors:{}});
  const payload=Object.freeze({timezone:'Asia/Beirut',tasks:[0,1,2,3].map(item)});
  const result=await registry.execute({context,action:'create_task_batch',payload,proposalId:'77777777-7777-4777-8777-777777777777',proposalCorrelationId:previewCorrelation});
  assert.deepEqual(result,{success:true,createdCount:4});
  assert.equal(received.proposalCorrelationId,previewCorrelation);
  assert.notEqual(received.proposalCorrelationId,received.context.actor.correlationId);
  assert.equal(received.context,context);assert.equal(received.context.actor.role,'manager');
  assert.equal(received.context.actor.companyId,received.context.tenant.companyId);
});

test('batch boundary accepts 25 and rejects 26, tampering, reordering, and model status',()=>{
  assert.equal(canonicalizeProposalArguments('create_task_batch',{timezone:'Asia/Beirut',tasks:Array.from({length:25},(_,i)=>item(i))}).payload.tasks.length,25);
  assert.throws(()=>canonicalizeProposalArguments('create_task_batch',{timezone:'Asia/Beirut',tasks:Array.from({length:26},(_,i)=>item(i))}));
  assert.throws(()=>canonicalizeProposalArguments('create_task_batch',{timezone:'Asia/Beirut',tasks:[{...item(0),status:'completed'}]}));
  assert.throws(()=>canonicalizeProposalArguments('create_task_batch',{timezone:'Asia/Beirut',tasks:[item(1),item(0)]}));
});

test('route exposes one batch tool, stores trusted canonical arguments, and leaves singular path intact',()=>{
  assert.match(route,/name: 'create_task_batch'/);assert.match(route,/maxItems: 25/);
  assert.match(route,/prepareCreateTaskBatch\(supabase, requestContext, toolInput\)/);
  assert.match(route,/rawArguments: tr\.canonicalArguments \?\? toolInput/);
  assert.match(route,/proposalCorrelationId: stored\.correlationId/);
  assert.match(route,/createSupabaseCreateTaskApplicationService/);
  assert.match(route,/case 'create_task':/);
});

test('executor uses only durable proposal correlation and SQL validation remains unchanged',()=>{
  assert.match(batch,/correlation_id: input\.proposalCorrelationId/);
  assert.doesNotMatch(batch,/correlation_id: input\.context\.actor\.correlationId/);
  assert.match(migration,/v_item->>'correlation_id'[\s\S]*bap\.correlation_id/);
  assert.match(route,/markProposalFailed\(proposalStore, stored\.id, stored\.payloadHash, 'EXECUTION_FAILED'\)/);
  assert.match(read('supabase/migrations/202607190001_stage0c_brain_action_proposals.sql'),/status='pending'[\s\S]*return jsonb_build_object\('outcome','invalid_status'\)/);
});

test('trusted canonicalization resolves company employees locations timezone and rejects authority fields',()=>{
  assert.match(batch,/\.eq\('company_id', context\.tenant\.companyId\)/g);
  assert.match(batch,/company\.timezone/);assert.match(batch,/employee\.status === 'active'/);
  assert.match(batch,/location\.status === 'active'/);assert.match(batch,/UNTRUSTED_BATCH_FIELD/);
  assert.match(batchTime,/AMBIGUOUS_BATCH_DUE_TIME/);assert.match(batchTime,/NONEXISTENT_BATCH_DUE_TIME/);
});

test('trusted company timezone conversion is exact and rejects DST gaps and overlaps',()=>{
  assert.deepEqual(localDateTimeToInstant('2026-07-22T11:55','Asia/Beirut'),{dueAt:'2026-07-22T08:55:00.000Z',dueDate:'2026-07-22'});
  assert.throws(()=>localDateTimeToInstant('2026-03-29T01:30','Europe/London'),/NONEXISTENT_BATCH_DUE_TIME/);
  assert.throws(()=>localDateTimeToInstant('2026-10-25T01:30','Europe/London'),/AMBIGUOUS_BATCH_DUE_TIME/);
});

test('migration is additive, atomic, service-only and creates one event per item',()=>{
  assert.match(migration,/ADD COLUMN IF NOT EXISTS due_at timestamptz/);
  assert.match(migration,/location_id uuid REFERENCES public\.locations\(id\) ON DELETE RESTRICT/);
  assert.match(migration,/SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/);
  assert.match(migration,/canonical_action = 'create_task_batch'/);
  assert.match(migration,/status = 'active'/);assert.match(migration,/v_role NOT IN \('manager', 'owner', 'super_admin'\)/);
  assert.match(migration,/INSERT INTO public\.tasks[\s\S]*INSERT INTO public\.brain_event_outbox/);
  assert.match(migration,/FOR v_item, v_index IN[\s\S]*INSERT INTO public\.brain_event_outbox/);
  assert.match(migration,/CONFLICTING_BATCH_RETRY/);
  assert.match(migration,/REVOKE ALL ON FUNCTION[\s\S]*FROM public, anon, authenticated/);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
  assert.doesNotMatch(migration,/COMMIT;[\s\S]*INSERT INTO public\.tasks/);
});

test('task reads include due time and location while preserving due_date',()=>{
  const api=read('app/api/tasks/route.ts');const list=read('lib/task-list.ts');const page=read('app/dashboard/tasks/page.tsx');
  for(const source of [api,list,page]){assert.match(source,/dueAt|due_at/);assert.match(source,/location/);}
  assert.match(page,/timeZone: task\.companyTimezone/);assert.match(page,/task\.dueDate/);
});
