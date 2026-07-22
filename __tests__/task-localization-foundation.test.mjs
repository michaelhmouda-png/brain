import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const sql = read('supabase/migrations/202607220012_task_localization_foundation.sql');
const api = read('app/api/tasks/route.ts');
const tasksPage = read('app/dashboard/tasks/page.tsx');
const evidence = read('components/brain/TaskEvidenceAttachment.tsx');
const brain = read('app/api/brain/chat/route.ts');
const worker = read('lib/notification-worker.server.ts');

test('durable localization cache and retry queue are server-only and company scoped', () => {
  assert.match(sql, /CREATE TABLE public\.task_localizations/);
  assert.match(sql, /CREATE TABLE public\.task_localization_jobs/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/g);
  assert.match(sql, /REVOKE ALL ON TABLE public\.task_localizations FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.task_localizations TO service_role/);
  assert.match(sql, /profile\.employee_id = employee\.id[\s\S]*profile\.company_id = employee\.company_id/);
  assert.doesNotMatch(sql, /CREATE POLICY/);
});

test('date-only and timed task inserts share one post-persistence localization lifecycle', () => {
  assert.match(sql, /AFTER INSERT OR UPDATE OF title, description, assigned_employee_id ON public\.tasks/);
  assert.doesNotMatch(sql, /UPDATE public\.tasks[\s\S]*(?:due_at|due_date)/i);
  assert.match(sql, /source_hash text NOT NULL/);
  assert.match(sql, /ON CONFLICT \(task_id, language\) DO UPDATE/);
});

test('translation completion validates the current canonical source and retry never recreates tasks', () => {
  assert.match(sql, /v_live_hash IS DISTINCT FROM p_source_hash/);
  assert.match(sql, /attempt_count < 5/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.doesNotMatch(sql, /INSERT INTO public\.tasks/);
  assert.doesNotMatch(sql, /brain_event_outbox|task\.created/);
});

test('task API is the shared persisted-language display projection without client language input', () => {
  assert.match(api, /profiles'\)\.select\('preferred_language'\)\.eq\('id', authorization\.profileId\)/);
  assert.match(api, /loadTaskDisplayLocalizations/);
  assert.match(api, /companyId: authorization\.companyId/);
  assert.doesNotMatch(api, /searchParams.*language|request\.json[\s\S]*preferred_language/);
});

test('cached display text is accepted only when its source hash matches canonical content', () => {
  const helper = read('lib/task-localization.server.ts');
  assert.match(helper, /createHash\('sha256'\)/);
  assert.match(helper, /expectedHashes\.get\(row\.task_id\) === row\.source_hash/);
});

test('Tasks and evidence surfaces render displayTitle while immutable option values remain UUIDs', () => {
  assert.match(tasksPage, /task\.displayTitle/);
  assert.doesNotMatch(tasksPage, /\/api\/tasks\/translations/);
  assert.match(evidence, /task\.displayTitle/);
  assert.match(evidence, /<option key=\{task\.id\} value=\{task\.id\}>/);
  assert.doesNotMatch(evidence, /OPENAI|\/api\/tasks\/translations/);
});

test('Brain consumes stored translations and the existing worker processes retries independently', () => {
  assert.match(brain, /storedEmployeeTaskTranslations/);
  assert.match(brain, /companyId: actorContext\.companyId/);
  assert.match(worker, /processOneTaskLocalization\(supabase\)/);
  assert.match(worker, /task localization unavailable/);
});

test('notification language uses persisted recipient profile without changing event identity or N2 timing', () => {
  assert.match(sql, /profile\.id=NEW\.recipient_id AND profile\.company_id=NEW\.company_id/);
  assert.match(sql, /profile\.preferred_language/);
  assert.doesNotMatch(sql, /event_key\s*:=|NEW\.event_key|scheduled_for\s*:=/);
  assert.doesNotMatch(sql, /UPDATE public\.notification_outbox|UPDATE public\.notification_delivery_jobs/);
});

test('legacy backfill is explicitly excluded from the migration', () => {
  assert.match(sql, /intentionally does not enqueue existing tasks/);
  const tail = sql.slice(sql.indexOf('-- This migration intentionally does not enqueue existing tasks'));
  assert.doesNotMatch(tail, /INSERT INTO public\.task_localization_jobs|UPDATE public\.tasks/);
});
