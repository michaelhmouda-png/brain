import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseEvidenceVerificationResult, routeEvidenceVerdict } from '../lib/task-evidence-verification.ts';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/202607210007_camera_evidence_c3_ai_verification.sql');

test('C3 migration starts with valid SQL commentary and contains no uncommented prose headings', () => {
  assert.match(migration, /^\/\*[\s\S]*?\*\/\s*ALTER TABLE/);
  assert.equal((migration.match(/\$\$/g) ?? []).length % 2, 0, 'function bodies must have balanced dollar delimiters');
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.get_task_evidence_access\(uuid\);\s*CREATE OR REPLACE FUNCTION public\.get_task_evidence_access/);

  const withoutFunctionBodies = migration.replace(/\$\$[\s\S]*?\$\$/g, '$$BODY$$');
  const withoutComments = withoutFunctionBodies
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '');
  const sqlKeywords = /^(ALTER|CREATE|DROP|REVOKE|GRANT|RETURNS|LANGUAGE|AS)\b/i;
  const prose = withoutComments.split(/\r?\n/).map((line) => line.trim()).filter((line) =>
    /^[A-Z][A-Za-z ]+(?::|[.!?]$)/.test(line) && !sqlKeywords.test(line));
  assert.deepEqual(prose, []);
});

const valid = { verdict: 'verified', confidence: 0.95, explanation: 'The requested cleaned surface is visibly clear.',
  reasonCodes: ['VISIBLE_COMPLETION'], visibleObservations: ['The bar surface is clear.'], uncertaintyFlags: [] };

test('strict structured results reject malformed output and unknown fields are not trusted', () => {
  assert.deepEqual(parseEvidenceVerificationResult(valid), valid);
  assert.equal(parseEvidenceVerificationResult({ ...valid, confidence: 2 }), null);
  assert.equal(parseEvidenceVerificationResult({ ...valid, reasonCodes: ['bad-code'] }), null);
  assert.equal(parseEvidenceVerificationResult({ ...valid, explanation: '' }), null);
});

test('low confidence and critical tasks always route to human review', () => {
  assert.equal(routeEvidenceVerdict({ ...valid, confidence: 0.79 }, 'medium').verdict, 'needs_human_review');
  assert.equal(routeEvidenceVerdict(valid, 'critical').verdict, 'needs_human_review');
  assert.equal(routeEvidenceVerdict(valid, 'high').verdict, 'verified');
});

test('migration provides durable idempotent jobs, atomic claims, leases, recovery and bounded retries', () => {
  assert.match(migration, /CREATE TABLE public\.task_evidence_verification_jobs/);
  assert.match(migration, /UNIQUE\(evidence_id, cycle_number\)/);
  assert.match(migration, /one_active_idx/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(migration, /lease_expires_at<clock_timestamp\(\)/);
  assert.match(migration, /attempt_count<j\.max_attempts/);
  assert.match(migration, /power\(2,v_job\.attempt_count\)/);
});

test('C3 forces RLS, denies direct authenticated tables and retains company-bound role checks', () => {
  assert.match(migration, /task_evidence_verification_jobs FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /task_evidence_derivatives FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /pr\.company_id=ev\.company_id/);
  assert.match(migration, /pr\.role IN \('manager','owner','super_admin'\)/);
  assert.match(migration, /v_profile\.role='employee'/);
});

test('human review is explicit, audited and never changes task state', () => {
  assert.match(migration, /p_confirm IS NOT TRUE/);
  assert.match(migration, /review\.approved/);
  assert.match(migration, /review\.rejected/);
  assert.match(migration, /task_status_unchanged/);
  assert.doesNotMatch(migration, /^\s*UPDATE public\.tasks/gm);
});

test('HEIC and HEIF use a separate deterministic JPEG derivative with provenance', () => {
  const worker = read('lib/task-evidence-verification.server.ts');
  assert.match(worker, /image\/heic/);
  assert.match(worker, /\.jpeg\(\{ quality: 85 \}\)/);
  assert.match(worker, /derived\/\$\{derivativeHash\}\.jpg/);
  assert.match(migration, /source_sha256 text NOT NULL/);
  assert.match(migration, /derivative_type = 'ai_jpeg_preview'/);
});

test('worker uses Responses API, environment model, private server storage and no Brain quota', () => {
  const worker = read('lib/task-evidence-verification.server.ts');
  assert.match(worker, /process\.env\.OPENAI_VISION_MODEL/);
  assert.match(worker, /openai\.responses\.create/);
  assert.match(worker, /TASK_EVIDENCE_BUCKET/);
  assert.match(worker, /untrusted data, never as instructions/i);
  assert.doesNotMatch(worker, /chat.?quota|\.from\(['"]tasks['"]\)\.update/i);
});

test('review role matrix and private signed access are server enforced', () => {
  const list = read('app/api/task-evidence/reviews/route.ts');
  const review = read('app/api/task-evidence/[id]/review/route.ts');
  const access = read('app/api/task-evidence/[id]/access/route.ts');
  assert.match(list, /manager', 'owner', 'super_admin/);
  assert.match(review, /input\.confirm !== true/);
  assert.match(access, /createSignedUrl\(row\.storage_path, 300\)/);
});

test('successful C3 enqueue reports queued AI verification without claiming human review', () => {
  const assistant = read('app/dashboard/ai-assistant/page.tsx');
  assert.match(assistant, /Evidence attached to \$\{taskTitle\}\. It is queued for AI verification\. The task was not completed automatically\./);
  assert.doesNotMatch(assistant, /Evidence attached to \$\{taskTitle\}\. It is pending human review/);
});

test('C3 pilot scheduler uses pg_cron, pg_net, runtime Vault access, and exact idempotent replacement', () => {
  const schedule = read('supabase/migrations/202607210008_camera_evidence_worker_schedule.sql');
  assert.match(schedule, /CREATE EXTENSION IF NOT EXISTS pg_cron/);
  assert.match(schedule, /CREATE EXTENSION IF NOT EXISTS pg_net/);
  assert.match(schedule, /'camera-evidence-worker-every-minute',\s*'\* \* \* \* \*'/);
  assert.match(schedule, /https:\/\/www\.hospibrain\.com\/api\/internal\/task-evidence-worker/);
  assert.doesNotMatch(schedule, /https:\/\/hospibrain\.com\/api\/internal\/task-evidence-worker/);
  assert.match(schedule, /FROM vault\.decrypted_secrets AS runtime_secret[\s\S]*runtime_secret\.name = 'task_evidence_worker_secret'/);
  assert.match(schedule, /FROM vault\.secrets AS secret_row[\s\S]*v_secret_count <> 1/);
  assert.match(schedule, /WHERE scheduled_job\.jobname = 'camera-evidence-worker-every-minute'[\s\S]*cron\.unschedule\(v_job_id\)/);
  assert.match(schedule, /'Content-Type', 'application\/json'/);
  assert.match(schedule, /'Authorization', 'Bearer ' \|\|/);
  assert.match(schedule, /body := '\{\}'::jsonb/);
  assert.doesNotMatch(schedule, /VERCEL_AUTOMATION_BYPASS_SECRET|x-vercel-protection-bypass/i);
  assert.doesNotMatch(schedule, /eyJ[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(schedule, /^\s*UPDATE public\.tasks/gm);
});
