import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  deterministicRotationIndex,
  parseRecurringTaskRule,
  recurrenceMatchesDay,
} from '../lib/recurring-tasks/contracts.ts';

const migration = readFileSync(
  new URL('../supabase/migrations/202607300001_recurring_task_engine_v1.sql', import.meta.url),
  'utf8',
);
const worker = readFileSync(new URL('../lib/notification-worker.server.ts', import.meta.url), 'utf8');
const brain = readFileSync(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../app/api/recurring-routines/route.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../components/recurring-tasks/RecurringRoutinesConsole.tsx', import.meta.url), 'utf8');

const base = {
  name: 'Kitchen closing',
  description: 'Complete the fixed closing routine.',
  locationId: '11111111-1111-4111-8111-111111111111',
  timezone: 'Asia/Beirut',
  recurrence: { kind: 'daily', weekdays: [] },
  timeAnchor: { kind: 'fixed_time', localTime: '23:00', offsetMinutes: 0 },
  startDate: '2026-07-30',
  endDate: null,
  taskTemplate: {
    title: 'Close kitchen', description: 'Complete all closing checks.', priority: 'high',
    evidenceRequired: true,
    countRequirement: {
      countRequired: true, countLabel: 'Fridge temperatures', unit: 'readings',
      damagedQuantityRequested: false, allowDecimals: true, instructions: null,
    },
  },
  workforce: {
    departmentId: '22222222-2222-4222-8222-222222222222',
    employeeRole: 'kitchen',
    shiftOverlapRequired: true,
    specificEmployeeId: null,
  },
  assignmentMode: 'every_matching_employee_on_shift',
  reminderOffsetsMinutes: [30, 0],
};

test('daily, selected, except-Monday, and weekly recurrence contracts are deterministic', () => {
  assert.equal(recurrenceMatchesDay('daily', [], 1), true);
  assert.equal(recurrenceMatchesDay('selected_weekdays', [2, 4], 2), true);
  assert.equal(recurrenceMatchesDay('selected_weekdays', [2, 4], 3), false);
  assert.equal(recurrenceMatchesDay('except_weekdays', [1], 1), false);
  assert.equal(recurrenceMatchesDay('except_weekdays', [1], 2), true);
  assert.equal(recurrenceMatchesDay('weekly', [1], 1), true);
});

test('fixed, opening, closing, reminders, evidence, and structured count are canonicalized', () => {
  const fixed = parseRecurringTaskRule(base);
  assert.deepEqual(fixed.reminderOffsetsMinutes, [30, 0]);
  assert.equal(fixed.taskTemplate.evidenceRequired, true);
  assert.equal(fixed.taskTemplate.countRequirement?.unit, 'readings');
  for (const kind of ['location_opening', 'location_closing']) {
    const parsed = parseRecurringTaskRule({
      ...base, timeAnchor: { kind, localTime: null, offsetMinutes: kind === 'location_opening' ? -15 : 15 },
    });
    assert.equal(parsed.timeAnchor.kind, kind);
  }
  assert.match(migration, /configure_location_operating_hours/);
  assert.match(migration, /jsonb_array_length\(p_days\)<>7/);
});

test('assignment modes and deterministic fair rotation never use model judgment', () => {
  assert.deepEqual([0, 1, 2, 0, 1].map((value) => deterministicRotationIndex(value, 3)), [0, 1, 2, 0, 1]);
  const specific = parseRecurringTaskRule({
    ...base,
    assignmentMode: 'specific_employee_if_on_shift',
    workforce: { ...base.workforce, specificEmployeeId: '33333333-3333-4333-8333-333333333333' },
  });
  assert.equal(specific.workforce.specificEmployeeId, '33333333-3333-4333-8333-333333333333');
  assert.throws(() => parseRecurringTaskRule({ ...base, assignmentMode: 'specific_employee_if_on_shift' }), /RECURRING_RULE_INVALID/);
});

test('strict input rejects missing shift overlap, invalid timezone, reminders, and recurrence', () => {
  assert.throws(() => parseRecurringTaskRule({ ...base, workforce: { ...base.workforce, shiftOverlapRequired: false } }));
  assert.throws(() => parseRecurringTaskRule({ ...base, timezone: 'Not/A_Timezone' }), /RECURRING_TIMEZONE_INVALID/);
  assert.throws(() => parseRecurringTaskRule({ ...base, reminderOffsetsMinutes: [1441] }));
  assert.throws(() => parseRecurringTaskRule({ ...base, recurrence: { kind: 'weekly', weekdays: [1, 2] } }));
});

test('migration has deterministic identities, leases, shift revalidation, DST fail-closed, and no backfill', () => {
  for (const fragment of [
    'UNIQUE (rule_id, rule_version, local_occurrence_at)',
    'PRIMARY KEY (occurrence_id, assigned_employee_id, template_position)',
    "shift.status='scheduled'",
    "employee.status='active'",
    "employee.company_id=v_rule.company_id",
    'stable_employee_uuid_order_previous_occurrence_modulo',
    "RECURRING_DST_TIME_INVALID",
    "outcome='no_eligible_employee'",
    'FOR UPDATE',
    'lease_expires_at',
    "attempt_count+1>=5",
    "'recurring.generation_failed'",
    'p_horizon_hours NOT BETWEEN 1 AND 24',
    'ON CONFLICT(task_id,offset_minutes) DO NOTHING',
  ]) assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(migration, /\bINSERT INTO public\.recurring_task_rules\b[\s\S]*?VALUES\s*\(\s*'[0-9a-f-]{36}'/i);
  assert.doesNotMatch(migration, /openai|chat\.completions|responses\.create/i);
});

test('generated tasks reuse canonical tasks, notifications, localization, evidence-count and employee scope', () => {
  for (const fragment of [
    'INSERT INTO public.tasks',
    'INSERT INTO public.notification_outbox',
    'INSERT INTO public.task_localization_jobs',
    'INSERT INTO public.task_evidence_count_requirements',
    'INSERT INTO public.recurring_task_generated_tasks',
    "task.status IN ('pending','in_progress')",
  ]) assert.ok(migration.includes(fragment), fragment);
});

test('forced RLS, management reads, service-only functions, and browser write denial are explicit', () => {
  assert.equal((migration.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length, 7);
  assert.match(migration, /profile\.role IN \('manager','owner','super_admin'\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.manage_recurring_task_rule[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.manage_recurring_task_rule[\s\S]*TO service_role/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE)[\s\S]* TO authenticated/);
  assert.match(api, /resolveActorContext/);
  assert.match(api, /canManageRecurringTasks/);
});

test('worker preserves notification priority and isolates recurring failures', () => {
  const delivery = worker.indexOf("claim_notification_delivery");
  const recurring = worker.indexOf('processRecurringAfterNotifications(supabase)', delivery);
  assert.ok(delivery >= 0 && recurring > delivery);
  assert.match(worker, /task localization unavailable/);
  assert.match(worker, /recurring task work unavailable/);
  assert.match(worker, /materialize_recurring_task_outbox/);
});

test('Brain proposal uses canonical preview, confirmation, and management-only execution', () => {
  assert.match(brain, /name: 'create_recurring_task_rule'/);
  assert.match(brain, /previewRecurringRule/);
  assert.match(brain, /canonicalArguments: toolInput/);
  assert.match(brain, /createRecurringRule\(createSupabaseServer\(\), actorContext, payload\)/);
  assert.match(api, /RECURRING_FORBIDDEN/);
});

test('management UI is mobile-safe, bilingual, and exposes status/outcome controls', () => {
  assert.match(ui, /100dvh/);
  assert.match(ui, /safe-area-inset-bottom/);
  assert.match(ui, /direction|useLocale|language/);
  for (const token of ['pause', 'resume', 'end', 'no_eligible_employee', 'preview']) assert.ok(ui.includes(token));
});
