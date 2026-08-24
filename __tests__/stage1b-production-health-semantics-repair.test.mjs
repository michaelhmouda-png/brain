import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyAgentReadinessPolicy, resolveAgentReadinessPolicy } from '../lib/agent-readiness-policy.ts';
import { classifyOperationalHealth } from '../lib/operational-health.ts';
import { isPermanentEvidenceFailure, safeEvidenceFailureCode } from '../lib/task-evidence-failure-codes.ts';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const now = Date.parse('2026-08-10T12:00:00.000Z');
const payload = {
  workers: ['notifications','recurring_tasks','weekly_shifts','evidence'].map((name) => ({ name, lastSucceededAt:'2026-08-10T11:59:00.000Z', lastFailedAt:null })),
  queues: { notifications:{pending:0,retrying:0,deadLetter:0,oldestPendingAt:null}, deliveries:{pending:0,retrying:0,deadLetter:0,oldestPendingAt:null}, evidence:{pending:0,retrying:0,deadLetter:0,oldestPendingAt:null} },
  materialization:{}, agents:{configured:2,online:0,offline:2}, recurring:{failedLast24Hours:0}, observedAt:'2026-08-10T12:00:00.000Z',
};

test('forward migration counts only unresolved evidence dead letters and preserves history', async () => {
  const sql = await read('supabase/migrations/202608100001_stage1b_production_health_semantics_repair.sql');
  assert.match(sql, /^-- Stage 1B Production-health semantics repair\./);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.match(sql, /JOIN public\.task_evidence evidence ON evidence\.id=job\.evidence_id AND evidence\.company_id=job\.company_id/);
  assert.match(sql, /JOIN public\.tasks task ON task\.id=evidence\.task_id AND task\.company_id=evidence\.company_id/);
  assert.match(sql, /job\.status='failed'[\s\S]*evidence\.status <> 'human_approved'[\s\S]*task\.status NOT IN \('completed','cancelled'\)/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|TRUNCATE|DROP)\b/);
  assert.match(sql, /SECURITY DEFINER SET search_path = ''/);
  assert.match(sql, /OWNER TO postgres/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_system_worker_health_v1\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_system_worker_health_v1\(\) TO service_role/);
});

test('Agent readiness is explicit, fail-closed to V1 deferred, and independent of gateway existence', () => {
  assert.equal(resolveAgentReadinessPolicy(undefined), 'deferred');
  assert.equal(resolveAgentReadinessPolicy('invalid'), 'deferred');
  assert.equal(resolveAgentReadinessPolicy('required'), 'required');
  const deferred = applyAgentReadinessPolicy(payload, 'deferred');
  assert.equal(classifyOperationalHealth(deferred, now).status, 'ok');
  assert.deepEqual(deferred.agents, { configured:2, online:0, offline:2, readiness:'deferred', required:false });
  const required = classifyOperationalHealth(applyAgentReadinessPolicy(payload, 'required'), now);
  assert.deepEqual(required.alerts, [{ code:'BRAIN_AGENTS_OFFLINE', severity:'high' }]);
});

test('unresolved evidence failures degrade while resolved aggregation remains healthy', () => {
  const unresolved = structuredClone(payload);
  unresolved.queues.evidence.deadLetter = 1;
  assert.deepEqual(classifyOperationalHealth(applyAgentReadinessPolicy(unresolved, 'deferred'), now).alerts, [
    { code:'QUEUE_EVIDENCE_DEAD_LETTER', severity:'high' },
  ]);
  assert.equal(classifyOperationalHealth(applyAgentReadinessPolicy(payload, 'deferred'), now).status, 'ok');
});

test('future evidence failures use only stable allowlisted sanitized codes', () => {
  assert.equal(safeEvidenceFailureCode(new Error('EVIDENCE_DOWNLOAD_FAILED:https://secret.example/task')), 'EVIDENCE_DOWNLOAD_FAILED');
  assert.equal(safeEvidenceFailureCode({ name:'APIError', status:429, message:'raw provider detail' }), 'VISION_PROVIDER_RATE_LIMITED');
  assert.equal(safeEvidenceFailureCode({ status:503, message:'tenant and URL detail' }), 'VISION_PROVIDER_UNAVAILABLE');
  assert.equal(safeEvidenceFailureCode(new Error('source: raw decoder detail')), 'EVIDENCE_VERIFICATION_FAILED');
  assert.equal(safeEvidenceFailureCode(new SyntaxError('raw output')), 'MALFORMED_AI_OUTPUT');
  assert.equal(isPermanentEvidenceFailure('EVIDENCE_IMAGE_PROCESSING_FAILED'), true);
  assert.equal(isPermanentEvidenceFailure('VISION_PROVIDER_RATE_LIMITED'), false);
});

test('external uptime logs the public response diagnostic and keeps the strict contract', async () => {
  const script = await read('scripts/check-external-health.mjs');
  assert.match(script, /JSON\.stringify\(\{ httpStatus: response\.status, responseBody: body \}\)/);
  assert.match(script, /response\.status !== 200/);
  assert.match(script, /body\.status !== 'ok'/);
  assert.match(script, /body\.code !== 'BRAIN_HEALTHY'/);
  assert.match(script, /BRAIN_EXTERNAL_HEALTH_FAILED/);
});

test('management, worker authentication, lease, RLS, and tenant boundaries remain intact', async () => {
  const [route, workerRoute, baseline, page] = await Promise.all([
    read('app/api/workers/health/route.ts'),
    read('app/api/internal/operational-health-worker/route.ts'),
    read('supabase/migrations/202607240000_current_state_baseline.sql'),
    read('app/dashboard/operations/worker-health/page.tsx'),
  ]);
  assert.match(route, /resolveActorContext/);
  assert.match(route, /getWorkerHealth\(actor\)/);
  assert.match(workerRoute, /createWorkerHandlers\([\s\S]*'NOTIFICATION_WORKER_SECRET'/);
  assert.match(baseline, /claim_task_evidence_verification_job[\s\S]*FOR UPDATE SKIP LOCKED/);
  assert.match(baseline, /task_evidence_verification_jobs[\s\S]*FORCE ROW LEVEL SECURITY/);
  assert.match(page, /Unresolved evidence verification failures require review\./);
  assert.match(page, /توجد إخفاقات غير محلولة في التحقق من الأدلة وتتطلب المراجعة\./);
  assert.match(page, /Deferred for V1 — offline Agents do not affect global health\./);
  assert.match(page, /مؤجل في الإصدار الأول — الوكلاء غير المتصلين لا يؤثرون في الصحة العامة\./);
});
