import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { hydrateRecurringRuleEditor } from '../lib/recurring-tasks/editor-state.ts';
import { recurringMessages } from '../lib/recurring-tasks/i18n.ts';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const locationId = '11111111-1111-4111-8111-111111111111';
const departmentId = '22222222-2222-4222-8222-222222222222';
const employeeId = '33333333-3333-4333-8333-333333333333';

const version = (number, timeAnchor) => ({
  version: number,
  recurrence: { kind: 'except_weekdays', weekdays: [3] },
  time_anchor: timeAnchor,
  start_date: '2026-08-05',
  end_date: '2026-12-31',
  task_template: {
    title: 'Close kitchen', description: 'Complete the kitchen close', priority: 'high', evidenceRequired: true,
    countRequirement: { countRequired: true, countLabel: 'Stations', unit: 'stations', damagedQuantityRequested: true, allowDecimals: false, instructions: 'Count visible stations' },
  },
  workforce: { departmentId, employeeRole: 'cook', shiftOverlapRequired: true, specificEmployeeId: employeeId },
  assignment_mode: 'specific_employee_if_on_shift',
  reminder_offsets_minutes: [30, 0],
});

const rule = (currentVersion, versions) => ({
  id: '44444444-4444-4444-8444-444444444444', name: 'Kitchen close', description: 'Nightly closing routine',
  location_id: locationId, timezone: 'Asia/Beirut', current_version: currentVersion,
  recurring_task_rule_versions: versions,
});

test('fixed venue-local 22:55 hydrates from the persisted current version, never the 09:00 creation default', () => {
  const hydrated = hydrateRecurringRuleEditor(rule(2, [
    version(1, { kind: 'fixed_time', localTime: '09:00', offsetMinutes: 0 }),
    version(2, { kind: 'fixed_time', localTime: '22:55:00', offsetMinutes: 0 }),
  ]));
  assert.equal(hydrated.timezone, 'Asia/Beirut');
  assert.equal(hydrated.locationId, locationId);
  assert.equal(hydrated.startDate, '2026-08-05');
  assert.equal(hydrated.endDate, '2026-12-31');
  assert.deepEqual(hydrated.timeAnchor, { kind: 'fixed_time', localTime: '22:55', offsetMinutes: 0 });
  assert.equal(hydrated.name, 'Kitchen close');
  assert.equal(hydrated.description, 'Nightly closing routine');
  assert.deepEqual(hydrated.recurrence, { kind: 'except_weekdays', weekdays: [3] });
  assert.deepEqual(hydrated.taskTemplate, version(2, {}).task_template);
  assert.deepEqual(hydrated.workforce, version(2, {}).workforce);
  assert.equal(hydrated.assignmentMode, 'specific_employee_if_on_shift');
  assert.deepEqual(hydrated.reminderOffsetsMinutes, [30, 0]);
});

test('closing and opening anchors retain their exact signed offsets and have no invented fixed time', () => {
  const closing = hydrateRecurringRuleEditor(rule(1, [version(1, { kind: 'location_closing', localTime: null, offsetMinutes: -5 })]));
  assert.deepEqual(closing.timeAnchor, { kind: 'location_closing', localTime: null, offsetMinutes: -5 });
  for (const offsetMinutes of [-30, 0, 45]) {
    const opening = hydrateRecurringRuleEditor(rule(1, [version(1, { kind: 'location_opening', localTime: null, offsetMinutes })]));
    assert.deepEqual(opening.timeAnchor, { kind: 'location_opening', localTime: null, offsetMinutes });
  }
});

test('repeated reopening is deterministic and a newly persisted version becomes the only edit source', () => {
  const saved = rule(2, [
    version(1, { kind: 'fixed_time', localTime: '09:00', offsetMinutes: 0 }),
    version(2, { kind: 'fixed_time', localTime: '22:55', offsetMinutes: 0 }),
  ]);
  assert.equal(hydrateRecurringRuleEditor(saved).timeAnchor.localTime, '22:55');
  assert.equal(hydrateRecurringRuleEditor(saved).timeAnchor.localTime, '22:55');
  const savedAgain = rule(3, [...saved.recurring_task_rule_versions, version(3, { kind: 'fixed_time', localTime: '23:10', offsetMinutes: 0 })]);
  assert.equal(hydrateRecurringRuleEditor(savedAgain).timeAnchor.localTime, '23:10');
});

test('hydration is timezone-independent and performs no browser or UTC conversion', async () => {
  const original = process.env.TZ;
  const persisted = rule(1, [version(1, { kind: 'fixed_time', localTime: '22:55', offsetMinutes: 0 })]);
  try {
    for (const timezone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      process.env.TZ = timezone;
      assert.equal(hydrateRecurringRuleEditor(persisted).timeAnchor.localTime, '22:55');
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
  const source = await read('lib/recurring-tasks/editor-state.ts');
  assert.doesNotMatch(source, /new Date|toISOString|toLocale|DateTimeFormat|UTC/);
});

test('edit submission is an immutable future-version PATCH, never the create route', async () => {
  const [ui, route, service] = await Promise.all([
    read('components/recurring-tasks/RecurringRoutinesConsole.tsx'),
    read('app/api/recurring-routines/[id]/route.ts'),
    read('lib/recurring-tasks/service.server.ts'),
  ]);
  assert.match(ui, /fetch\(`\/api\/recurring-routines\/\$\{editing\.id\}`,[\s\S]*method: 'PATCH'/);
  assert.match(ui, /action: 'version', expectedVersion: editing\.current_version, rule/);
  assert.match(ui, /initialRule \? t\.update : t\.save/);
  assert.match(route, /changeRecurringRule\(createSupabaseServer\(\), actor, id, row\)/);
  assert.match(service, /p_action: action[\s\S]*p_rule_id: ruleId[\s\S]*p_expected_version: expectedVersion/);
});

test('English and Arabic clearly label version saving and the dialog preserves RTL inheritance', async () => {
  const ui = await read('components/recurring-tasks/RecurringRoutinesConsole.tsx');
  assert.equal(recurringMessages.en.update, 'Save new version');
  assert.equal(recurringMessages.ar.update, 'حفظ إصدار جديد');
  assert.match(ui, /dir="inherit"/);
  assert.match(ui, /t\.weekdays\[index\]/);
  assert.match(ui, /key=\{editing \? `edit:\$\{editing\.id\}:\$\{editing\.current_version\}` : 'create'\}/);
});

test('missing or malformed current persisted versions fail instead of using creation defaults', () => {
  assert.throws(() => hydrateRecurringRuleEditor(rule(2, [version(1, { kind: 'fixed_time', localTime: '09:00', offsetMinutes: 0 })])), /RECURRING_EDIT_HYDRATION_INVALID/);
  assert.throws(() => hydrateRecurringRuleEditor(rule(1, [version(1, { kind: 'fixed_time', localTime: null, offsetMinutes: 0 })])), /RECURRING_EDIT_HYDRATION_INVALID/);
});
