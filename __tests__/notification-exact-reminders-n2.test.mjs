import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sql = read('supabase/migrations/202607220010_task_due_30m_notifications.sql');
const n1 = read('supabase/migrations/202607210009_notification_foundation_n1.sql');
const worker = read('lib/notification-worker.server.ts');
const serviceWorker = read('public/notification-sw.js');
const settings = read('components/NotificationSettings.tsx');
const i18n = read('lib/i18n.ts');

function qualifies(now, dueAt, status = 'pending') {
  const nowMs = new Date(now).getTime();
  const dueMs = new Date(dueAt).getTime();
  return ['pending', 'in_progress'].includes(status)
    && nowMs >= dueMs - 30 * 60 * 1000
    && nowMs < dueMs;
}

function canonicalEventKey(taskId, dueAt) {
  const timestamp = new Date(dueAt).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
  return `task.due_30m:${taskId}:${timestamp}`;
}

test('N2 requires an absolute timestamptz deadline and uses database time', () => {
  assert.match(sql, /column_name = 'due_at'[\s\S]+data_type = 'timestamp with time zone'/);
  assert.match(sql, /v_database_now timestamptz := clock_timestamp\(\)/);
  assert.match(sql, /v_database_now >= task\.due_at - interval '30 minutes'/);
  assert.match(sql, /v_database_now < task\.due_at/);
  assert.doesNotMatch(sql, /current_date|browser|device time/i);
});

test('inside-window and task-created-ten-minutes-before-deadline scenarios qualify once', () => {
  assert.equal(qualifies('2026-07-22T09:30:00Z', '2026-07-22T10:00:00Z'), true);
  assert.equal(qualifies('2026-07-22T09:31:00Z', '2026-07-22T10:00:00Z'), true);
  assert.equal(qualifies('2026-07-22T09:50:00Z', '2026-07-22T10:00:00Z'), true);
});

test('before-window, exact-deadline, overdue, completed, and cancelled scenarios do not qualify', () => {
  assert.equal(qualifies('2026-07-22T09:29:59Z', '2026-07-22T10:00:00Z'), false);
  assert.equal(qualifies('2026-07-22T10:00:00Z', '2026-07-22T10:00:00Z'), false);
  assert.equal(qualifies('2026-07-22T10:00:01Z', '2026-07-22T10:00:00Z'), false);
  assert.equal(qualifies('2026-07-22T09:45:00Z', '2026-07-22T10:00:00Z', 'completed'), false);
  assert.equal(qualifies('2026-07-22T09:45:00Z', '2026-07-22T10:00:00Z', 'cancelled'), false);
  assert.match(sql, /task\.status IN \('pending', 'in_progress'\)/g);
});

test('event key binds task UUID to the exact canonical UTC deadline', () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const first = canonicalEventKey(taskId, '2026-07-22T10:00:00.123Z');
  const changed = canonicalEventKey(taskId, '2026-07-22T10:15:00.123Z');
  assert.equal(first, 'task.due_30m:11111111-1111-4111-8111-111111111111:2026-07-22T10:00:00.123000Z');
  assert.notEqual(first, changed);
  assert.match(sql, /'task\.due_30m:' \|\| task\.id::text \|\| ':' \|\|[\s\S]+task\.due_at AT TIME ZONE 'UTC'[\s\S]+'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'/);
  assert.match(sql, /ON CONFLICT \(company_id, event_key\) DO NOTHING/);
});

test('repeated generation deduplicates and a changed deadline has a distinct identity', () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const keys = new Set();
  keys.add(canonicalEventKey(taskId, '2026-07-22T10:00:00Z'));
  keys.add(canonicalEventKey(taskId, '2026-07-22T10:00:00Z'));
  assert.equal(keys.size, 1);
  keys.add(canonicalEventKey(taskId, '2026-07-22T10:05:00Z'));
  assert.equal(keys.size, 2);
  assert.match(n1, /UNIQUE\(company_id,event_key\)/);
  assert.match(n1, /UNIQUE INDEX notifications_recipient_event_key_idx ON public\.notifications\(recipient_id,event_key\)/);
  assert.match(n1, /UNIQUE\(notification_id,subscription_id\)/);
});

test('materialization resolves only a same-company active employee/profile UUID link', () => {
  assert.match(sql, /JOIN public\.employees AS employee[\s\S]+employee\.id = task\.assigned_employee_id/);
  assert.match(sql, /employee\.company_id = task\.company_id/);
  assert.match(sql, /employee\.status = 'active'/);
  assert.match(sql, /profile\.employee_id = employee\.id/);
  assert.match(sql, /profile\.company_id = employee\.company_id/);
  assert.match(sql, /profile\.company_id = v_outbox\.company_id/);
  assert.match(sql, /profile\.status = 'active'/);
  assert.doesNotMatch(sql, /first_name|last_name|full_name|email/);
});

test('missing employee/profile links use controlled recipient.unresolved audit', () => {
  assert.match(sql, /IF v_count = 0 THEN[\s\S]+'recipient\.unresolved'/);
  assert.match(sql, /jsonb_build_object\('eventType', v_outbox\.event_type\)/);
  assert.doesNotMatch(sql, /safe_details[\s\S]{0,180}(?:employee_id|profile_id|task\.id)/i);
});

test('rescheduled or terminal reminders are rejected before materialization and push claim', () => {
  assert.match(sql, /v_outbox\.event_key =[\s\S]+task\.due_at AT TIME ZONE 'UTC'/);
  assert.match(sql, /notification\.event_key IS DISTINCT FROM[\s\S]+task\.due_at AT TIME ZONE 'UTC'/);
  assert.match(sql, /task\.status NOT IN \('pending', 'in_progress'\)/);
  assert.match(sql, /REMINDER_NO_LONGER_ELIGIBLE/);
  assert.match(sql, /'reminder\.suppressed'/);
  assert.match(sql, /FOR UPDATE OF delivery SKIP LOCKED/);
});

test('due preference, in-app creation, push jobs, and quiet hours remain authoritative', () => {
  assert.match(sql, /v_outbox\.event_type = 'task\.due_30m'[\s\S]+coalesce\(preference\.due_reminders, true\)/);
  assert.match(sql, /INSERT INTO public\.notifications/);
  assert.match(sql, /INSERT INTO public\.notification_delivery_jobs/);
  assert.match(sql, /preference\.push_enabled/);
  assert.match(sql, /preference\.quiet_hours_enabled/);
  assert.match(sql, /AT TIME ZONE preference\.timezone/);
});

test('push output remains privacy-safe and routes only to tasks', () => {
  assert.match(sql, /WHEN 'tasks' THEN '\/dashboard\/tasks'/);
  assert.match(sql, /WHEN 'task\.due_30m' THEN 'Task due in 30 minutes\.'/);
  assert.match(sql, /'Open HospiBrain to view this notification\.'::text/);
  assert.match(worker, /title:job\.title,summary:job\.summary,notificationId:job\.notification_id,route:job\.route/);
  assert.match(serviceWorker, /SAFE_ROUTES/);
  assert.doesNotMatch(worker, /task.?description|employee.?name|company.?name/i);
});

test('N2 replaces broad calendar reminders without adding another cron job', () => {
  const executable = sql.replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(executable, /cron\.schedule|pg_cron|net\.http_post/);
  assert.match(sql, /v_outbox\.event_type IN \('task\.due_soon', 'task\.overdue'\)/);
  assert.match(sql, /'obligation\.superseded'/);
  assert.doesNotMatch(sql.match(/CREATE OR REPLACE FUNCTION public\.generate_task_reminder_obligations\(\)[\s\S]+?\n\$\$;/)?.[0] ?? '', /task\.due_soon|task\.overdue|due_date/);
  assert.match(worker, /generate_task_reminder_obligations/);
  assert.match(n1, /notification-worker-every-minute','\* \* \* \* \*'/);
});

test('leases, bounded retries, forced RLS, and service-only execution are preserved', () => {
  assert.match(sql, /p_lease_seconds < 30 OR p_lease_seconds > 300/);
  assert.match(sql, /FOR UPDATE OF delivery SKIP LOCKED/);
  assert.match(sql, /delivery\.attempt_count < 5/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.generate_task_reminder_obligations\(\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.generate_task_reminder_obligations\(\)[\s\S]+TO service_role/);
  assert.match(sql, /NOTIFICATION_N2_N1_FORCED_RLS_DRIFT/);
});

test('notification processing never mutates tasks or consumes Brain quota', () => {
  const executable = sql.replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(executable, /UPDATE public\.tasks|INSERT INTO public\.tasks|DELETE FROM public\.tasks/);
  assert.doesNotMatch(executable, /brain_chat_user_quotas|admit_brain_chat_request|OPENAI|quota/i);
});

test('settings reuse dueReminders and provide exact English and Arabic labels', () => {
  assert.match(settings, /dueReminders: booleanPreference\([\s\S]+?'due_reminders'/);
  assert.match(settings, /t\.notifications\.due30mPreference/);
  assert.match(i18n, /due30mPreference: '30-minute task reminders'/);
  assert.match(i18n, /due30mPreference: 'تذكيرات المهام قبل 30 دقيقة'/);
  assert.doesNotMatch(settings, /due30mReminders|thirtyMinuteReminders/);
});

test('migration is additive, transactional, and does not edit N1 objects outside focused functions', () => {
  assert.equal((sql.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.match(sql, /CREATE INDEX tasks_due_at_reminder_scan_idx/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|ALTER TABLE public\.tasks/);
  assert.doesNotMatch(sql, /CREATE TABLE public\./);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION private\.queue_notification_event/);
});
