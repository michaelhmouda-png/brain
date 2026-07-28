import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  EVIDENCE_SET_RESULT_JSON_SCHEMA,
  parseEvidenceSetResult,
  parsePrepareTaskEvidenceSubmission,
  routeEvidenceSetVerdict,
  TASK_EVIDENCE_MAX_ITEMS,
  TASK_EVIDENCE_MAX_TOTAL_BYTES,
} from '../lib/task-evidence-submission.ts';

const migration = fs.readFileSync(
  new URL(
    '../supabase/migrations/202607280002_camera_evidence_c5_multi_photo_counts.sql',
    import.meta.url,
  ),
  'utf8',
);
const baseline = fs.readFileSync(
  new URL(
    '../supabase/migrations/202607240000_current_state_baseline.sql',
    import.meta.url,
  ),
  'utf8',
);
const composer = fs.readFileSync(
  new URL('../components/brain/TaskEvidenceAttachment.tsx', import.meta.url),
  'utf8',
);
const worker = fs.readFileSync(
  new URL('../lib/task-evidence-verification.server.ts', import.meta.url),
  'utf8',
);
const reviewPage = fs.readFileSync(
  new URL('../app/dashboard/evidence-review/page.tsx', import.meta.url),
  'utf8',
);
const taskEdit = fs.readFileSync(
  new URL('../components/tasks/TaskEditPanel.tsx', import.meta.url),
  'utf8',
);
const chatRoute = fs.readFileSync(
  new URL('../app/api/brain/chat/route.ts', import.meta.url),
  'utf8',
);
const i18n = fs.readFileSync(new URL('../lib/i18n.ts', import.meta.url), 'utf8');

const id = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const hash = (value) => value.toString(16).padStart(64, '0');

function item(index, sizeBytes = 1024, sourceType = 'gallery_upload') {
  return {
    itemId: id(index + 10),
    ordinal: index + 1,
    sourceType,
    mimeType: 'image/jpeg',
    sizeBytes,
    sha256: hash(index + 1),
  };
}

function input(items, count = null) {
  return {
    taskId: id(1),
    locationId: null,
    sourceType: 'gallery_upload',
    idempotencyKey: id(2),
    items,
    count,
  };
}

test('C5 migration is forward-only and preserves C2-C4 compatibility anchor', () => {
  assert.match(migration, /^\/\*[\s\S]*BEGIN;/);
  assert.match(migration, /evidence_id uuid NOT NULL UNIQUE REFERENCES public\.task_evidence/);
  const finalizeRoute = fs.readFileSync(
    new URL(
      '../app/api/task-evidence/submissions/[submissionId]/finalize/route.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(finalizeRoute, /enqueue_task_evidence_verification/);
  assert.match(migration, /atomic C4 review\/task-completion transaction/);
  assert.doesNotMatch(migration, /DROP TABLE public\.task_evidence/);
});

test('one through ten photos are accepted and eleven are rejected', () => {
  assert.equal(TASK_EVIDENCE_MAX_ITEMS, 10);
  assert.ok(parsePrepareTaskEvidenceSubmission(input([item(0)])));
  assert.ok(parsePrepareTaskEvidenceSubmission(
    input(Array.from({ length: 10 }, (_, index) => item(index))),
  ));
  assert.equal(
    parsePrepareTaskEvidenceSubmission(
      input(Array.from({ length: 11 }, (_, index) => item(index))),
    ),
    null,
  );
});

test('camera and gallery items can share one mixed submission', () => {
  const request = input([
    item(0, 1024, 'mobile_camera'),
    item(1, 1024, 'gallery_upload'),
  ]);
  request.sourceType = 'mixed_capture';
  assert.equal(parsePrepareTaskEvidenceSubmission(request)?.sourceType, 'mixed_capture');
  assert.match(migration, /mixed_capture/);
});

test('20 MiB per item and 100 MiB combined boundaries are exact', () => {
  const twentyMiB = 20 * 1024 * 1024;
  assert.ok(parsePrepareTaskEvidenceSubmission(input([item(0, twentyMiB)])));
  assert.equal(parsePrepareTaskEvidenceSubmission(input([item(0, twentyMiB + 1)])), null);
  const exactTotal = Array.from({ length: 5 }, (_, index) => item(index, twentyMiB));
  assert.equal(exactTotal.reduce((sum, value) => sum + value.sizeBytes, 0), TASK_EVIDENCE_MAX_TOTAL_BYTES);
  assert.ok(parsePrepareTaskEvidenceSubmission(input(exactTotal)));
  assert.equal(
    parsePrepareTaskEvidenceSubmission(input([
      ...exactTotal,
      item(6, 1),
    ])),
    null,
  );
});

test('duplicate hashes and spoofed MIME declarations fail before upload', () => {
  const duplicate = [item(0), { ...item(1), sha256: item(0).sha256 }];
  assert.equal(parsePrepareTaskEvidenceSubmission(input(duplicate)), null);
  assert.equal(
    parsePrepareTaskEvidenceSubmission(input([{ ...item(0), mimeType: 'image/gif' }])),
    null,
  );
  assert.match(composer, /duplicatePhoto/);
});

test('structured integer and decimal count rules are server-authoritative', () => {
  const count = {
    quantity: 12,
    unit: 'bags',
    damagedQuantity: 1,
    locationDetails: 'Freezer shelf 2',
    notes: 'One bag is torn',
  };
  assert.ok(parsePrepareTaskEvidenceSubmission(input([item(0)], count)));
  assert.match(migration, /NOT v_requirement\.allow_decimals AND trunc\(v_quantity\) <> v_quantity/);
  assert.match(migration, /v_unit IS DISTINCT FROM v_requirement\.canonical_unit/);
  assert.match(migration, /v_damaged > v_quantity/);
  assert.match(
    migration,
    /submittedQuantity'[\s\S]*IS DISTINCT FROM v_submission\.submitted_quantity/,
  );
  assert.match(worker, /MALFORMED_AI_SUBMITTED_COUNT/);
});

test('negative, unbounded, unit-mismatched and damaged-over-total counts fail safely', () => {
  assert.equal(parsePrepareTaskEvidenceSubmission(input([item(0)], {
    quantity: -1,
    unit: 'bags',
    damagedQuantity: 0,
    locationDetails: null,
    notes: null,
  })), null);
  assert.equal(parsePrepareTaskEvidenceSubmission(input([item(0)], {
    quantity: 2,
    unit: 'bags',
    damagedQuantity: 3,
    locationDetails: null,
    notes: null,
  })), null);
  assert.match(migration, /COUNT_NOT_CONFIGURED/);
  assert.match(migration, /COUNT_REQUIRED/);
});

test('submission finalization locks all items and rejects partial evidence', () => {
  assert.match(migration, /FOR UPDATE;[\s\S]*item\.status = 'verified'/);
  assert.match(migration, /SUBMISSION_INCOMPLETE/);
  assert.match(migration, /status = 'pending_review'/);
  assert.match(migration, /IF v_submission\.status NOT IN \('uploading', 'upload_failed'\)/);
});

test('interrupted uploads preserve verified items and use stable idempotency', () => {
  assert.match(migration, /UNIQUE \(submitted_by_profile_id, idempotency_key\)/);
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(migration, /IDEMPOTENCY_CONFLICT/);
  assert.match(migration, /stored\.sha256 = lower\(requested\.value ->> 'sha256'\)/);
  assert.match(migration, /v_existing\.submitted_quantity IS DISTINCT FROM v_quantity/);
  assert.match(migration, /IF v_item\.status = 'verified' THEN/);
  assert.match(composer, /setSubmissionId\(prepared\.submissionId\)/);
  assert.match(composer, /recoveringExistingSubmission/);
  assert.match(
    composer,
    /if \(recoveringExistingSubmission\)[\s\S]*\/complete[\s\S]*if \(!completeResponse\?\.ok\)[\s\S]*uploadSignedObject/,
  );
  assert.match(composer, /submissionId !== null/);
  assert.match(composer, /idempotencyKey/);
  assert.match(composer, /retryPhoto/);
});

test('a rejected task can receive a new submission even when its first photo was seen before', () => {
  assert.match(migration, /ADD COLUMN c5_submission_id uuid/);
  assert.match(
    migration,
    /task_evidence_legacy_company_task_sha256_uidx[\s\S]*WHERE c5_submission_id IS NULL/,
  );
  assert.match(migration, /c5_submission_id,\s*company_id/);
  assert.match(migration, /v_evidence_id,\s*v_submission_id,\s*v_profile\.company_id/);
  assert.match(
    migration,
    /task_evidence_c5_submission_id_fkey[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  );
});

test('storage paths group company, task, submission and item and originals are immutable', () => {
  assert.match(
    migration,
    /v_profile\.company_id::text \|\| '\/' \|\| v_task\.id::text \|\| '\/'[\s\S]*v_submission_id::text \|\| '\/' \|\| v_item_id::text \|\| '\/original\.'/,
  );
  assert.match(composer, /x-upsert', 'false'/);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]{0,100}FOR (UPDATE|DELETE).*task-evidence/i);
});

test('server verifies object size, magic MIME and SHA-256 per item', () => {
  const completeRoute = fs.readFileSync(
    new URL(
      '../app/api/task-evidence/submissions/[submissionId]/items/[itemId]/complete/route.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(completeRoute, /object\.size !== item\.expected_size_bytes/);
  assert.match(completeRoute, /sniffTaskEvidenceMime/);
  assert.match(completeRoute, /createHash\('sha256'\)/);
  assert.match(completeRoute, /item\.expected_sha256/);
});

test('multi-image strict output requires stable per-image order', () => {
  const expectedItems = [
    { itemId: id(10), ordinal: 1 },
    { itemId: id(11), ordinal: 2 },
  ];
  const result = {
    schemaVersion: 2,
    verdict: 'verified',
    confidence: 0.95,
    explanation: 'The complete set visibly supports the task.',
    perImageObservations: expectedItems.map((value) => ({
      ...value,
      observations: ['Visible task evidence'],
    })),
    completeSetObservations: ['Both views were considered together'],
    reasonCodes: [],
    uncertaintyFlags: [],
    fullAreaCovered: true,
    submittedQuantity: null,
    observedQuantity: null,
    observedQuantityConfidence: null,
    countComparison: 'not_applicable',
    missingViewConcerns: [],
    duplicateViewConcerns: [],
  };
  assert.deepEqual(parseEvidenceSetResult(result, expectedItems), result);
  assert.equal(parseEvidenceSetResult({
    ...result,
    perImageObservations: [...result.perImageObservations].reverse(),
  }, expectedItems), null);
  assert.equal(EVIDENCE_SET_RESULT_JSON_SCHEMA.additionalProperties, false);
});

test('count mismatch, incomplete coverage, overlaps, low confidence and critical work route to humans', () => {
  const base = {
    schemaVersion: 2,
    verdict: 'verified',
    confidence: 0.95,
    explanation: 'Evidence was assessed.',
    perImageObservations: [],
    completeSetObservations: [],
    reasonCodes: [],
    uncertaintyFlags: [],
    fullAreaCovered: true,
    submittedQuantity: 12,
    observedQuantity: 11,
    observedQuantityConfidence: 0.8,
    countComparison: 'mismatch',
    missingViewConcerns: [],
    duplicateViewConcerns: [],
  };
  assert.equal(routeEvidenceSetVerdict(base, 'medium', true).verdict, 'needs_human_review');
  assert.equal(routeEvidenceSetVerdict({
    ...base,
    countComparison: 'matches',
    duplicateViewConcerns: ['Overlapping view may duplicate objects'],
  }, 'medium', true).verdict, 'needs_human_review');
  assert.equal(routeEvidenceSetVerdict({
    ...base,
    countComparison: 'matches',
    confidence: 0.7,
  }, 'medium', true).verdict, 'needs_human_review');
  assert.equal(routeEvidenceSetVerdict({
    ...base,
    countComparison: 'matches',
  }, 'critical', true).verdict, 'needs_human_review');
});

test('worker supplies all images in stable order and treats every context field as untrusted', () => {
  assert.match(worker, /for \(const item of context\.items\)/);
  assert.match(worker, /imageOrder/);
  assert.match(worker, /untrusted data, never instructions/);
  assert.match(worker, /Do not infer hidden objects or double-count overlapping views/);
  assert.match(worker, /complete_task_evidence_set_verification_job/);
});

test('HEIC and HEIF originals use separate deterministic JPEG derivatives', () => {
  assert.match(worker, /mimeType === 'image\/heic' \|\| mimeType === 'image\/heif'/);
  assert.match(worker, /sharp\(bytes/);
  assert.match(worker, /\/derived\/\$\{derivativeHash\}\.jpg/);
  assert.match(worker, /upsert: false/);
  assert.match(migration, /UNIQUE \(item_id, derivative_type\)/);
});

test('AI cannot complete, cancel, reopen or mutate tasks', () => {
  const completionFunction = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.complete_task_evidence_set_verification_job'),
    migration.indexOf('CREATE OR REPLACE FUNCTION public.get_task_evidence_submission_review_context'),
  );
  assert.doesNotMatch(completionFunction, /UPDATE public\.tasks/);
  assert.match(migration, /It never mutates task status/);
});

test('C4 approval remains the canonical task completion path and rejection stays active', () => {
  assert.match(migration, /C4 review\/task-completion transaction/);
  assert.match(migration, /review\.approved/);
  assert.match(migration, /review\.rejected/);
  assert.match(migration, /task\.completion_requested/);
  assert.match(migration, /task\.completed/);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION private\.complete_task_transition/);
});

test('rejection uses one idempotent outbox obligation and localized safe notification', () => {
  assert.match(baseline, /NEW\.status='human_rejected' THEN v_type:='evidence\.human_rejected'/);
  assert.match(baseline, /ON CONFLICT\(company_id,event_key\) DO NOTHING/);
  const c5NotificationAudit = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION private.request_evidence_rejection_notification'),
    migration.indexOf('CREATE OR REPLACE FUNCTION private.localize_evidence_rejection_notification'),
  );
  assert.doesNotMatch(c5NotificationAudit, /INSERT INTO public\.notification_outbox/);
  assert.match(c5NotificationAudit, /existing_notification_outbox/);
  assert.match(migration, /profile\.preferred_language/);
  assert.match(migration, /task_localizations/);
  assert.match(migration, /Evidence rejected/);
  assert.match(migration, /تم رفض الدليل/);
  assert.doesNotMatch(migration, /signedUrl|signed_url|Authorization header|Digest nonce/);
});

test('authorization derives canonical profile employee company and task relationships', () => {
  assert.match(migration, /profile\.id = auth\.uid\(\)/);
  assert.match(migration, /v_task\.assigned_employee_id IS DISTINCT FROM v_profile\.employee_id/);
  assert.match(migration, /employee\.id = v_profile\.employee_id/);
  assert.match(migration, /employee\.company_id = v_profile\.company_id/);
  assert.match(migration, /profile\.role IN \('manager', 'owner', 'super_admin'\)/);
});

test('worker RPC is service-only and browser tables have no direct writes', () => {
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.complete_task_evidence_set_verification_job[\s\S]*TO service_role/,
  );
  assert.doesNotMatch(
    migration,
    /GRANT (INSERT|UPDATE|DELETE)[^;]*task_evidence_submissions[^;]*TO authenticated/,
  );
  assert.match(migration, /FORCE ROW LEVEL SECURITY/g);
});

test('task count configuration preserves proposal confirmation and optimistic editing', () => {
  assert.match(chatRoute, /count_requirement/);
  assert.match(chatRoute, /canonicalArguments/);
  assert.match(taskEdit, /expectedUpdatedAt: task\.updatedAt/);
  assert.match(taskEdit, /countRequirement/);
  assert.match(migration, /update_management_task_with_count_requirement/);
  assert.match(migration, /public\.update_management_task\(/);
  assert.match(migration, /COUNT_REQUIREMENT_PROPOSAL_MISMATCH/);
});

test('count requirement changes lock after any evidence exists', () => {
  assert.match(migration, /COUNT_REQUIREMENT_LOCKED_BY_EVIDENCE/g);
  assert.match(migration, /FROM public\.task_evidence AS evidence[\s\S]*evidence\.task_id = p_task_id/);
});

test('review UI renders one submission gallery and aggregate count context', () => {
  assert.match(reviewPage, /submission_context/);
  assert.match(reviewPage, /submissionItems/);
  assert.match(reviewPage, /countRequirement/);
  assert.match(reviewPage, /submittedCount/);
  assert.match(reviewPage, /countComparison/);
  assert.match(reviewPage, /Approve evidence and complete this task\?/);
});

test('English and Arabic C5 labels exist and RTL authority remains persisted profile language', () => {
  assert.match(i18n, /evidenceC5: \{ addPhotos: 'Add photos'/);
  assert.match(i18n, /evidenceC5: \{ addPhotos: 'إضافة صور'/);
  assert.match(composer, /dir=\{language === 'ar' \? 'rtl' : 'ltr'\}/);
  assert.match(migration, /profile\.preferred_language/);
});

test('C5 has no inventory, Brain quota, automatic score, NVR, or camera mutation path', () => {
  for (const source of [migration, worker, composer]) {
    assert.doesNotMatch(source, /UPDATE public\.(inventory|brain_score|camera|nvr)/i);
    assert.doesNotMatch(source, /brain_quota|quota_consum/i);
  }
});

test('append-only audit includes every required privacy-safe lifecycle event', () => {
  for (const event of [
    'submission.prepared',
    'item.prepared',
    'item.upload_completed',
    'item.upload_failed',
    'submission.finalized',
    'verification.queued',
    'verification.started',
    'verification.completed',
    'verification.failed',
    'review.approved',
    'review.rejected',
    'task.completion_requested',
    'task.completed',
    'notification.requested',
  ]) {
    assert.match(migration, new RegExp(event.replace('.', '\\.')));
  }
  assert.doesNotMatch(migration, /GRANT UPDATE[^;]*task_evidence_submission_audit[^;]*TO authenticated/);
  assert.match(migration, /task_evidence_submission_audit_append_only/);
  assert.match(migration, /task_evidence_submission_results_append_only/);
  assert.match(migration, /task_evidence_item_derivatives_append_only/);
  assert.match(migration, /task_evidence_submissions_context_immutable/);
  assert.match(migration, /task_evidence_items_context_immutable/);
});
