import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parsePrepareTaskEvidence, sniffTaskEvidenceMime, TASK_EVIDENCE_MAX_BYTES } from '../lib/task-evidence.ts';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/202607210005_camera_evidence_c2_task_uploads.sql');

test('C2 validates canonical upload metadata and rejects spoofable or oversized input', () => {
  assert.equal(TASK_EVIDENCE_MAX_BYTES, 20 * 1024 * 1024);
  const valid = parsePrepareTaskEvidence({
    taskId: crypto.randomUUID(), locationId: null, sourceType: 'mobile_camera',
    mimeType: 'image/jpeg', sizeBytes: 1024, sha256: 'a'.repeat(64), idempotencyKey: crypto.randomUUID(),
  });
  assert.ok(valid);
  assert.ok(parsePrepareTaskEvidence({ ...valid, sizeBytes: TASK_EVIDENCE_MAX_BYTES }));
  assert.equal(parsePrepareTaskEvidence({ ...valid, sizeBytes: TASK_EVIDENCE_MAX_BYTES + 1 }), null);
  assert.equal(parsePrepareTaskEvidence({ ...valid, sourceType: 'fixed_camera' }), null);
  assert.equal(parsePrepareTaskEvidence({ ...valid, mimeType: 'text/html' }), null);
  assert.equal(parsePrepareTaskEvidence({ ...valid, taskId: 'other-company-task' }), null);
});

test('server content sniffing recognizes supported originals and rejects arbitrary bytes', () => {
  assert.equal(sniffTaskEvidenceMime(Uint8Array.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(sniffTaskEvidenceMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(sniffTaskEvidenceMime(new TextEncoder().encode('RIFF0000WEBP')), 'image/webp');
  assert.equal(sniffTaskEvidenceMime(new TextEncoder().encode('<script>alert(1)</script>')), null);
});

test('migration creates a private immutable bucket and server-only evidence records', () => {
  assert.match(migration, /CREATE TABLE public\.task_evidence \(/);
  assert.match(migration, /CREATE TABLE public\.task_evidence_audit \(/);
  assert.match(migration, /'task-evidence'[\s\S]*false[\s\S]*20971520/);
  assert.doesNotMatch(migration, /10485760/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON public\.task_evidence FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]{0,80}FOR UPDATE TO authenticated/);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]{0,80}FOR DELETE TO authenticated/);
});

test('database authority binds profile, company, task, employee assignment, and location', () => {
  assert.match(migration, /pr\.id = auth\.uid\(\) AND pr\.status = 'active'/);
  assert.match(migration, /t\.id = p_task_id AND t\.company_id = v_profile\.company_id/);
  assert.match(migration, /v_task\.assigned_employee_id IS DISTINCT FROM v_profile\.employee_id/);
  assert.match(migration, /loc\.id = p_location_id AND loc\.company_id = v_profile\.company_id/);
  assert.match(migration, /UNIQUE \(company_id, task_id, original_sha256\)/);
  assert.match(migration, /UNIQUE \(submitted_by_profile_id, idempotency_key\)/);
});

test('upload completion is verified and remains pending review without task mutation', () => {
  assert.match(migration, /EVIDENCE_HASH_MISMATCH/);
  assert.match(migration, /storage\.objects AS obj/);
  assert.match(migration, /SET status = 'pending_review'/);
  assert.doesNotMatch(migration, /UPDATE public\.tasks/);
  assert.doesNotMatch(migration, /brain score|auto.?complete/i);
});

test('API uses authenticated authorization and never a service-role client', () => {
  const prepare = read('app/api/task-evidence/route.ts');
  const complete = read('app/api/task-evidence/[id]/complete/route.ts');
  for (const source of [prepare, complete]) {
    assert.match(source, /createSupabaseServerAuth/);
    assert.match(source, /authorizeCompanyApiRequestFromSupabase/);
    assert.doesNotMatch(source, /createSupabaseServer\(|SERVICE_ROLE/);
  }
  assert.match(prepare, /\.eq\('company_id', authorization\.companyId\)/);
  assert.match(prepare, /authorization\.role === 'employee'/);
  assert.match(prepare, /\.exists\(prepared\.storage_path\)/);
  assert.match(prepare, /uploaded_pending_completion/);
});

test('mobile composer provides explicit camera, gallery, preview, progress, remove, and confirmation controls', () => {
  const component = read('components/brain/TaskEvidenceAttachment.tsx');
  const page = read('app/dashboard/ai-assistant/page.tsx');
  assert.match(component, /capture="environment"/);
  assert.match(component, /Choose gallery/);
  assert.match(component, /Selected evidence preview/);
  assert.match(component, /Remove selected image/);
  assert.match(component, /xhr\.upload\.onprogress/);
  assert.match(component, /Confirm upload/);
  assert.match(component, /up to 20 MiB/);
  assert.match(component, /awaits review/);
  assert.match(page, /<TaskEvidenceAttachment/);
});

test('C2 contains no fixed-camera ingestion, AI verification, mock evidence, or task completion path', () => {
  const sources = [
    read('app/api/task-evidence/route.ts'),
    read('app/api/task-evidence/[id]/complete/route.ts'),
    read('components/brain/TaskEvidenceAttachment.tsx'),
  ].join('\n');
  assert.doesNotMatch(sources, /service.?role|mock evidence|brain.?score/i);
  assert.doesNotMatch(sources, /update\(['"]tasks|fixed_camera|openai/i);
});
