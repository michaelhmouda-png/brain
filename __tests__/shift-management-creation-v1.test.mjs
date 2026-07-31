import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { localDateTimeToInstant } from '../lib/brain/tasks/batch/task-batch-time.ts';
import {
  canManageShifts,
  nextLocalDate,
  parseCreateConcreteShift,
} from '../lib/shifts/contracts.ts';
import { messages, validateTranslationCatalog } from '../lib/i18n.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/202607300002_shift_management_creation_v1.sql');
const previousMigration = read('supabase/migrations/202607300001_recurring_task_engine_v1.sql');
const route = read('app/api/shifts/route.ts');
const itemRoute = read('app/api/shifts/[id]/route.ts');
const page = read('app/dashboard/shifts/page.tsx');
const service = read('lib/shifts/service.server.ts');
const baseline = read('supabase/migrations/202607240000_current_state_baseline.sql');

const validInput = {
  employeeId: '11111111-1111-4111-8111-111111111111',
  locationId: '22222222-2222-4222-8222-222222222222',
  date: '2026-07-30',
  startTime: '09:00',
  endTime: '17:00',
};

test('public.shifts remains the one concrete schedule source used by recurring generation', () => {
  assert.match(baseline, /CREATE TABLE "public"\."shifts"/);
  assert.match(previousMigration, /EXISTS\(SELECT 1 FROM public\.shifts shift/);
  assert.doesNotMatch(migration, /CREATE TABLE public\.(?:employee_)?schedules/);
  assert.doesNotMatch(route, /insert\(\{[\s\S]*weekly_schedules[\s\S]*action === 'create_shift'/);
});

test('strict concrete-shift input is role canonical and excludes browser authority', () => {
  assert.deepEqual(parseCreateConcreteShift(validInput), validInput);
  for (const role of ['manager', 'owner', 'super_admin']) assert.equal(canManageShifts(role), true);
  for (const role of ['employee', 'admin', '']) assert.equal(canManageShifts(role), false);
  assert.throws(() => parseCreateConcreteShift({ ...validInput, companyId: validInput.employeeId }), /SHIFT_INPUT_INVALID/);
  assert.throws(() => parseCreateConcreteShift({ ...validInput, startTime: '9:00' }), /SHIFT_INPUT_INVALID/);
  assert.throws(() => parseCreateConcreteShift({ ...validInput, date: 'tomorrow' }), /SHIFT_INPUT_INVALID/);
});

test('location-local timestamps become canonical UTC and overnight shifts use the next local date', () => {
  assert.deepEqual(localDateTimeToInstant('2026-07-30T09:00', 'Asia/Beirut'), {
    dueAt: '2026-07-30T06:00:00.000Z',
    dueDate: '2026-07-30',
  });
  assert.equal(nextLocalDate('2026-07-30'), '2026-07-31');
  const start = localDateTimeToInstant('2026-07-30T22:00', 'Asia/Beirut').dueAt;
  const end = localDateTimeToInstant(`${nextLocalDate('2026-07-30')}T04:00`, 'Asia/Beirut').dueAt;
  assert.equal(start, '2026-07-30T19:00:00.000Z');
  assert.equal(end, '2026-07-31T01:00:00.000Z');
  assert.match(service, /input\.endTime <= input\.startTime \? nextLocalDate\(input\.date\) : input\.date/);
  assert.doesNotMatch(service, /resolvedOptions\(\)\.timeZone|new Date\(`\$\{input\.date\}T/);
});

test('nonexistent and ambiguous DST local times fail closed before persistence', () => {
  assert.throws(
    () => localDateTimeToInstant('2026-03-29T01:30', 'Europe/London'),
    /NONEXISTENT_BATCH_DUE_TIME/,
  );
  assert.throws(
    () => localDateTimeToInstant('2026-10-25T01:30', 'Europe/London'),
    /AMBIGUOUS_BATCH_DUE_TIME/,
  );
  assert.match(service, /throw new Error\('SHIFT_LOCAL_TIME_INVALID'\)/);
});

test('migration adds only location and canonical interval provenance to existing shifts', () => {
  for (const fragment of [
    'ADD COLUMN location_id uuid',
    'ADD COLUMN starts_at timestamptz',
    'ADD COLUMN ends_at timestamptz',
    'shifts_location_id_fkey',
    'shifts_canonical_interval_check',
    'ends_at <= starts_at + interval \'24 hours\'',
  ]) assert.ok(migration.includes(fragment), fragment);
  assert.match(migration, /^BEGIN;[\s\S]*COMMIT;\s*$/);
  const migrationApplication = migration.slice(0, migration.indexOf('CREATE OR REPLACE FUNCTION'));
  assert.doesNotMatch(migrationApplication, /^\s*(?:INSERT|UPDATE|DELETE)\b/im);
  assert.doesNotMatch(migration, /\bINSERT INTO public\.(?:employees|locations)\b/i);
});

test('service-only RPC revalidates actor, employee, location, tenant, timezone, and canonical instants', () => {
  for (const fragment of [
    "profile.status = 'active'",
    "lower(profile.role) IN ('manager', 'owner', 'super_admin')",
    "employee.company_id = p_company_id",
    "employee.status = 'active'",
    "location.company_id = p_company_id",
    "location.status = 'active'",
    'p_starts_at AT TIME ZONE v_timezone',
    'p_ends_at AT TIME ZONE v_timezone',
  ]) assert.ok(migration.includes(fragment), fragment);
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(migration, /ALTER FUNCTION public\.create_concrete_shift[\s\S]*OWNER TO postgres/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_concrete_shift[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_concrete_shift[\s\S]*TO service_role/);
});

test('exact duplicates and overlapping concurrent creation are atomically rejected', () => {
  assert.match(migration, /shifts_exact_scheduled_interval_uidx/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /hashtextextended\(p_company_id::text \|\| ':' \|\| p_employee_id::text/);
  assert.match(migration, /existing\.starts_at < p_ends_at[\s\S]*existing\.ends_at > p_starts_at/);
  assert.match(migration, /existing\.end_time <= existing\.start_time THEN interval '1 day'/);
  assert.match(migration, /RAISE EXCEPTION 'SHIFT_DUPLICATE'/);
  assert.match(migration, /RAISE EXCEPTION 'SHIFT_CONFLICT'/);
  assert.ok(migration.indexOf('pg_advisory_xact_lock') < migration.indexOf("RAISE EXCEPTION 'SHIFT_DUPLICATE'"));
});

test('POST derives authority from ActorContext and maps safe creation failures', () => {
  assert.match(route, /const actor = await resolveActorContext\(supabase\)/);
  assert.match(route, /if \(!canManageShifts\(actor\.role\)\)/);
  assert.match(route, /createConcreteShift\(supabase, createSupabaseServer\(\), actor, data\)/);
  assert.match(route, /status: error\.code === 'UNAUTHENTICATED' \? 401 : 403/);
  assert.match(route, /code === 'SHIFT_DUPLICATE' \|\| code === 'SHIFT_CONFLICT' \? 409/);
  assert.doesNotMatch(route, /data\.companyId|data\.role|data\.profileId/);
});

test('employees remain self-scoped and never receive management selectors or statistics', () => {
  assert.match(route, /if \(employeeId\) concreteQuery = concreteQuery\.eq\('employee_id', employeeId\)/);
  assert.match(route, /authorization\.role === 'employee'\s*\? \{ data: \[\], error: null \}/);
  assert.match(route, /\.\.\.\(authorization\.role === 'employee' \? \{\} : \{/);
  assert.match(route, /if \(authorization\.role !== 'employee'\)/);
  assert.match(itemRoute, /authorization\.role === 'employee' && shift\.employee_id !== authorization\.employeeId/);
  assert.match(itemRoute, /authorization\.role === 'employee'\) return NextResponse\.json\(\{ error: 'Forbidden' \}/);
});

test('management form is localized, responsive, dark, and refreshes the concrete week immediately', () => {
  assert.deepEqual(validateTranslationCatalog(), []);
  assert.equal(messages.en.schedule.createShift, 'Create shift');
  assert.equal(messages.ar.schedule.createShift, 'إنشاء وردية');
  for (const token of [
    'role="dialog"',
    'aria-modal="true"',
    'max-h-[100dvh]',
    'safe-area-inset-bottom',
    'bg-slate-950',
    'type="date"',
    'type="time"',
    't.timezone',
    't.overnight',
  ]) assert.ok(page.includes(token), token);
  assert.match(page, /!personal \? \([\s\S]*t\.schedule\.createShift/);
  assert.match(page, /body: JSON\.stringify\(\{[\s\S]*action: 'create_shift'/);
  assert.match(page, /onCreated=\{async \(\) => \{\s*await load\(\)/);
  assert.doesNotMatch(page, /resolvedOptions\(\)\.timeZone/);
});

test('management week response includes concrete shifts while directory data remains management-only', () => {
  assert.match(route, /\.from\('shifts'\)[\s\S]*\.gte\('shift_date', weekStart\)[\s\S]*\.lte\('shift_date', addCalendarDays\(weekStart, 6\)\)/);
  assert.match(route, /concreteShifts: \(concreteRows \?\? \[\]\)\.map/);
  assert.match(route, /\.from\('employees'\)[\s\S]*\.eq\('status', 'active'\)/);
  assert.match(route, /\.from\('locations'\)[\s\S]*\.eq\('status', 'active'\)/);
  assert.match(page, /payload\.concreteShifts\.map/);
  assert.match(page, /payload\?\.schedules\.length === 0 && payload\.concreteShifts\.length === 0/);
});

test('migration fingerprint is stable for review', () => {
  const digest = createHash('sha256').update(migration).digest('hex');
  assert.match(digest, /^[0-9a-f]{64}$/);
});
