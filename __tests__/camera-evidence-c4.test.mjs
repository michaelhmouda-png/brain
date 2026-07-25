import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/202607250002_camera_evidence_c4_manager_approval_completion.sql');
const baseline = read('supabase/migrations/202607240000_current_state_baseline.sql');
const route = read('app/api/task-evidence/[id]/review/route.ts');
const page = read('app/dashboard/evidence-review/page.tsx');
const worker = read('lib/task-evidence-verification.server.ts');

function functionBody(name) {
  const replaceStart = migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  const createStart = migration.indexOf(`CREATE FUNCTION ${name}`);
  const start = replaceStart >= 0 ? replaceStart : createStart;
  assert.ok(start >= 0, `${name} must exist`);
  const bodyStart = migration.indexOf('AS $function$', start);
  const bodyEnd = migration.indexOf('$function$;', bodyStart + 'AS $function$'.length);
  assert.ok(bodyStart >= start && bodyEnd > bodyStart, `${name} must have a complete body`);
  return migration.slice(bodyStart + 'AS $function$'.length, bodyEnd);
}

const reviewFunction = functionBody('public.review_task_evidence');
const completionFunction = functionBody('private.complete_task_transition');
const employeeCompletionFunction = functionBody('public.complete_my_assigned_task');

test('C4 is one forward transaction and leaves the frozen baseline untouched', () => {
  assert.match(migration, /^-- Camera Evidence C4:[^\n]*\r?\nBEGIN;/);
  assert.match(migration, /\r?\nCOMMIT;\s*$/);
  assert.equal((migration.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((migration.match(/\bCOMMIT;/g) ?? []).length, 1);
  assert.doesNotMatch(migration, /\bALTER TABLE public\.tasks (?:DISABLE|NO FORCE|ENABLE|FORCE) ROW LEVEL SECURITY/i);
});

test('manager approval completes pending and in-progress tasks through the canonical transition', () => {
  assert.match(completionFunction, /v_task\.status NOT IN \('pending', 'in_progress'\)/);
  assert.match(completionFunction, /UPDATE public\.tasks AS task[\s\S]*SET status = 'completed'/);
  assert.match(reviewFunction, /private\.complete_task_transition\([\s\S]*v_task\.id,[\s\S]*v_task\.company_id,[\s\S]*v_profile\.id/);
  assert.match(reviewFunction, /'human_approved'::text[\s\S]*'completed'::text/);
});

test('employee self-completion and evidence approval share one canonical database transition', () => {
  assert.match(employeeCompletionFunction, /private\.complete_task_transition\(/);
  assert.match(reviewFunction, /private\.complete_task_transition\(/);
  assert.doesNotMatch(employeeCompletionFunction, /UPDATE public\.tasks/);
  assert.equal((migration.match(/UPDATE public\.tasks AS task/g) ?? []).length, 1);
});

test('review authorization is active, role-canonical, authenticated, and company scoped', () => {
  assert.match(reviewFunction, /profile\.id = auth\.uid\(\)/);
  assert.match(reviewFunction, /profile\.status = 'active'/);
  assert.match(reviewFunction, /profile\.role IN \('manager', 'owner', 'super_admin'\)/);
  assert.match(reviewFunction, /evidence\.company_id = v_profile\.company_id/);
  assert.match(reviewFunction, /task\.company_id = v_evidence\.company_id/);
  assert.match(route, /\['manager', 'owner', 'super_admin'\]\.includes\(auth\.role\)/);
  assert.doesNotMatch(reviewFunction, /p_(?:company|role|employee|task_status|completion_status)/);
});

test('an employee and a cross-company reviewer cannot approve evidence', () => {
  assert.doesNotMatch(reviewFunction, /profile\.role IN \([^)]*'employee'/);
  assert.match(reviewFunction, /EVIDENCE_NOT_REVIEWABLE/);
  assert.match(reviewFunction, /evidence\.id = p_evidence_id[\s\S]*evidence\.company_id = v_profile\.company_id/);
});

test('AI verdicts alone never complete a task', () => {
  assert.doesNotMatch(worker, /\.from\(['"]tasks['"]\)\.update|complete_task_transition|complete_my_assigned_task/);
  const verificationResultFunction = baseline.match(/CREATE OR REPLACE FUNCTION public\.complete_task_evidence_verification[\s\S]*?\$function\$;/)?.[0] ?? '';
  assert.ok(verificationResultFunction);
  assert.doesNotMatch(verificationResultFunction, /UPDATE public\.tasks|complete_task_transition|complete_my_assigned_task/);
});

test('rejection records a review while leaving pending or in-progress task state unchanged', () => {
  const rejectionStart = reviewFunction.indexOf("IF p_decision = 'rejected' THEN");
  const approvalTransition = reviewFunction.indexOf('private.complete_task_transition(');
  assert.ok(rejectionStart >= 0 && approvalTransition > rejectionStart);
  const rejectionBranch = reviewFunction.slice(rejectionStart, approvalTransition);
  assert.match(rejectionBranch, /SET status = 'human_rejected'/);
  assert.match(rejectionBranch, /'not_requested'::text/);
  assert.doesNotMatch(rejectionBranch, /UPDATE public\.tasks|status = 'completed'/);
});

test('evidence and task are locked and revalidated before either approval transition', () => {
  const evidenceLock = reviewFunction.indexOf('FROM public.task_evidence AS evidence');
  const taskLock = reviewFunction.indexOf('FROM public.tasks AS task');
  const reviewInsert = reviewFunction.indexOf('INSERT INTO public.task_evidence_reviews');
  assert.ok(evidenceLock >= 0 && taskLock > evidenceLock && reviewInsert > taskLock);
  assert.match(reviewFunction.slice(evidenceLock, reviewInsert), /FOR UPDATE/g);
  assert.match(reviewFunction, /evidence\.task_id = v_task\.id/);
});

test('duplicate and concurrent approval produce one review, completion, and completion event', () => {
  assert.match(reviewFunction, /v_evidence\.status = 'human_approved' AND p_decision = 'approved'/);
  assert.match(reviewFunction, /'already_approved'::text,[\s\S]*'already_completed'::text,[\s\S]*true/);
  assert.match(baseline, /task_evidence_reviews_evidence_id_key" UNIQUE \(evidence_id\)/);
  assert.match(migration, /CREATE UNIQUE INDEX task_evidence_audit_c4_completion_once_idx[\s\S]*\(evidence_id, event_type\)/);
  assert.match(baseline, /notification_outbox_company_id_event_key_key" UNIQUE \(company_id, event_key\)/);
  assert.match(completionFunction, /FROM public\.tasks AS task[\s\S]*FOR UPDATE/);
});

test('cancelled or otherwise non-completable tasks fail without approving evidence', () => {
  const failureGuard = reviewFunction.indexOf("IF v_task.status NOT IN ('pending', 'in_progress', 'completed') THEN");
  const approvalUpdate = reviewFunction.indexOf("SET status = 'human_approved'");
  assert.ok(failureGuard >= 0 && approvalUpdate > failureGuard);
  const failureEnd = reviewFunction.indexOf("\n  IF p_decision = 'rejected' AND", failureGuard);
  const failureBranch = reviewFunction.slice(failureGuard, failureEnd);
  assert.match(failureBranch, /task\.completion_failed/);
  assert.match(failureBranch, /'failed'::text,[\s\S]*'not_completable'::text/);
  assert.doesNotMatch(failureBranch, /human_approved|INSERT INTO public\.task_evidence_reviews/);
  assert.match(route, /TASK_NOT_COMPLETABLE/);
});

test('an already-completed task is a safe no-op without another task update or event', () => {
  const completedGuard = completionFunction.indexOf("IF v_task.status = 'completed' THEN");
  const taskUpdate = completionFunction.indexOf('UPDATE public.tasks AS task');
  assert.ok(completedGuard >= 0 && taskUpdate > completedGuard);
  assert.match(completionFunction.slice(completedGuard, taskUpdate), /'already_completed'/);
  assert.match(reviewFunction, /task\.completion_noop[\s\S]*'already_completed'/);
});

test('one explicit approval does not mutate or require every evidence item for the task', () => {
  assert.doesNotMatch(reviewFunction, /count\s*\(\s*\*\s*\)[\s\S]*(?:task_evidence|evidence)|every|all evidence/i);
  assert.match(reviewFunction, /WHERE evidence\.id = p_evidence_id/);
  const updates = [...reviewFunction.matchAll(/UPDATE public\.task_evidence AS evidence[\s\S]*?;/g)].map((match) => match[0]);
  assert.equal(updates.length, 2);
  for (const update of updates) {
    assert.match(update, /evidence\.id = v_evidence\.id/);
    assert.match(update, /evidence\.task_id = v_task\.id/);
    assert.doesNotMatch(update, /WHERE evidence\.task_id = v_task\.id\s*;/);
  }
});

test('canonical task completion emits the established outbox event used by shared consumers', () => {
  assert.match(baseline, /NEW\.status='completed' AND OLD\.status IS DISTINCT FROM NEW\.status THEN v_type:='task\.completed'/);
  assert.match(baseline, /CREATE TRIGGER notification_tasks_event AFTER INSERT OR UPDATE ON tasks/);
  assert.match(baseline, /INSERT INTO public\.notification_outbox\(company_id,event_key,event_type,aggregate_type,aggregate_id,actor_profile_id\)/);
  assert.match(migration, /existing task trigger emits task\.completed notification outbox events/);
});

test('review API and UI use uncached refresh and accurate completion wording', () => {
  assert.match(route, /revalidatePath\('\/dashboard\/tasks'\)/);
  assert.match(route, /revalidatePath\('\/dashboard'\)/);
  assert.match(page, /fetch\('\/api\/task-evidence\/reviews', \{ cache: 'no-store'/);
  assert.match(page, /router\.refresh\(\)/);
  assert.match(page, /Approve evidence and complete this task\?/);
  assert.match(page, /AI verification alone never changes task status/);
  assert.doesNotMatch(page, /Reviews never change task status|The task status will not change/);
});

test('browser route never updates tasks directly and database privileges stay narrow', () => {
  assert.doesNotMatch(route, /\.from\(['"]tasks['"]\)|UPDATE public\.tasks/);
  assert.match(migration, /REVOKE ALL ON FUNCTION private\.complete_task_transition[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.review_task_evidence[\s\S]*TO authenticated, service_role/);
  assert.doesNotMatch(migration, /GRANT (?:ALL|UPDATE) ON (?:TABLE )?public\.tasks TO authenticated/i);
});

test('C4 audit lifecycle is allowlisted and reviewer-attributed', () => {
  for (const event of [
    'review.approved',
    'task.completion_requested',
    'task.completed',
    'task.completion_noop',
    'task.completion_failed',
  ]) {
    assert.match(migration, new RegExp(event.replace('.', '\\.')));
  }
  assert.match(reviewFunction, /actor_profile_id,[\s\S]*v_profile\.id/);
  assert.match(completionFunction, /updated_at = clock_timestamp\(\)/);
});
