import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const sql = read('supabase/migration_audit/pre_baseline_20260724/202607220013_task_localization_backfill.sql');
const worker = read('lib/notification-worker.server.ts');
const helper = read('lib/task-localization.server.ts');

test('migration is additive, transactional, and inert until the RPC is invoked', () => {
  assert.match(sql, /^--[^\n]*\n--[^\n]*\nBEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.equal((sql.match(/\bBEGIN;/g) ?? []).length, 1);
  const outsideFunction = sql.slice(0, sql.indexOf('CREATE FUNCTION public.enqueue_legacy'))
    + sql.slice(sql.indexOf('REVOKE ALL ON FUNCTION public.enqueue_legacy'));
  assert.doesNotMatch(outsideFunction, /INSERT INTO public\.task_localization_jobs|UPDATE public\.tasks/);
  assert.doesNotMatch(sql, /CREATE TABLE|ALTER TABLE|CREATE TRIGGER|OPENAI/i);
});

test('preflight fails closed unless the forced-RLS foundation and functions are intact', () => {
  assert.match(sql, /relrowsecurity AND c\.relforcerowsecurity/);
  assert.match(sql, /TASK_LOCALIZATION_FOUNDATION_INCOMPATIBLE/);
  assert.match(sql, /claim_task_localization_job\(integer\)/);
  assert.match(sql, /complete_task_localization_job\(uuid,text,text,uuid,text,text\)/);
  assert.match(sql, /fail_task_localization_job\(uuid,text,uuid,text\)/);
  assert.match(sql, /TASK_LOCALIZATION_FOUNDATION_GRANT_DRIFT/);
});

test('only pending and in-progress legacy tasks are considered', () => {
  assert.match(sql, /task\.status IN \('pending', 'in_progress'\)/);
  assert.doesNotMatch(sql, /task\.status IN \([^)]*completed|task\.status IN \([^)]*cancelled/);
});

test('eligibility binds active Arabic profile, employee, task, and company by immutable IDs', () => {
  assert.match(sql, /profile\.employee_id = employee\.id/);
  assert.match(sql, /profile\.company_id = employee\.company_id/);
  assert.match(sql, /employee\.id = task\.assigned_employee_id/);
  assert.match(sql, /employee\.company_id = task\.company_id/);
  assert.match(sql, /employee\.status = 'active'/);
  assert.match(sql, /profile\.status = 'active'/);
  assert.match(sql, /profile\.preferred_language = 'ar'/);
});

test('current translations and active same-source jobs are skipped', () => {
  assert.match(sql, /localization\.source_hash = assessed\.source_hash/);
  assert.match(sql, /job\.source_hash = assessed\.source_hash/);
  assert.match(sql, /job\.status IN \('pending', 'processing'\)/);
  assert.match(sql, /already_current := already_current \+ 1/);
  assert.match(sql, /already_queued := already_queued \+ 1/);
});

test('bounded idempotent upsert handles source changes without stealing active leases', () => {
  assert.match(sql, /p_limit < 1 OR p_limit > 50/);
  assert.match(sql, /LIMIT p_limit/);
  assert.match(sql, /ON CONFLICT \(task_id, language\) DO UPDATE/);
  assert.match(sql, /job\.source_hash IS DISTINCT FROM EXCLUDED\.source_hash/);
  assert.match(sql, /job\.status <> 'processing'/);
  assert.match(sql, /attempt_count = 0/);
  assert.match(sql, /v_live_hash IS DISTINCT FROM v_task\.source_hash/);
  assert.match(sql, /FROM public\.tasks AS task[\s\S]*FOR UPDATE;/);
});

test('missing and cross-company recipient relationships are controlled unresolved outcomes', () => {
  assert.match(sql, /IF NOT v_task\.has_content OR NOT v_task\.recipient_resolved/);
  assert.match(sql, /unresolved := unresolved \+ 1/);
  assert.doesNotMatch(sql, /SELECT[^;]*(?:first_name|last_name|email|phone)|RETURN QUERY[^;]*(?:title|description)/i);
});

test('RPC returns safe counts only and browser roles cannot execute it', () => {
  assert.match(sql, /RETURNS TABLE\([\s\S]*scanned bigint[\s\S]*enqueued bigint[\s\S]*already_current bigint[\s\S]*already_queued bigint[\s\S]*unresolved bigint/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.enqueue_legacy_arabic_task_localizations\(integer\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.enqueue_legacy_arabic_task_localizations\(integer\)[\s\S]*TO service_role/);
});

test('worker enqueues one small batch but delivers notifications before translation processing', () => {
  assert.match(worker, /enqueueLegacyTaskLocalizationBatch\(service, 25\)/);
  const main = worker.slice(worker.indexOf('export async function processNotificationWork'));
  const delivery = main.indexOf("claim_notification_delivery");
  const translation = main.indexOf('processLocalizationAfterNotifications(supabase)');
  assert.ok(delivery > 0 && translation > delivery);
  assert.equal((worker.match(/enqueueLegacyTaskLocalizationBatch\(/g) ?? []).length, 1);
});

test('privacy-safe backfill observability emits every required outcome without content', () => {
  for (const event of ['backfill.batch_started', 'backfill.job_enqueued', 'backfill.already_current',
    'backfill.already_queued', 'backfill.recipient_unresolved', 'backfill.batch_completed']) assert.match(worker, new RegExp(event));
  const logging = worker.slice(worker.indexOf('async function enqueueLegacyLocalizationWork'), worker.indexOf('async function processLocalizationAfterNotifications'));
  assert.doesNotMatch(logging, /task\.title|task\.description|email|token|translatedText/);
});

test('backfill and translation never mutate tasks or K8 outbox events', () => {
  assert.doesNotMatch(sql, /UPDATE public\.tasks|INSERT INTO public\.tasks|brain_event_outbox|['"]task\.created(?=['":])/);
  assert.doesNotMatch(helper, /INSERT INTO public\.tasks|brain_event_outbox/);
});
