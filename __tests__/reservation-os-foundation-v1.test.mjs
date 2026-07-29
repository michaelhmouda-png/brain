import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { aggregateCalendar, comparableWeekdayLastYear, sameDateLastYear } from '../lib/reservations/history.ts';
import { aggregateReservationMetrics } from '../lib/reservations/metrics.ts';
import { normalizePhone } from '../lib/reservations/phone.ts';
import { venueDate } from '../lib/reservations/time.ts';
import { MockTelephonyProviderAdapter, handleIncomingCall } from '../lib/reservations/telephony.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/202607250004_reservation_os_foundation_v1.sql');
const timezoneRepair = read('supabase/migrations/202607250005_fix_reservation_location_timezone_validation.sql');
const experienceMigration = read('supabase/migrations/202607250006_reservation_experience_v2_1_edit_contract.sql');
const service = read('lib/reservations/service.server.ts');
const calendarRoute = read('app/api/reservations/calendar/route.ts');
const historyRoute = read('app/api/reservations/history/route.ts');
const locationsRoute = read('app/api/locations/route.ts');
const locationService = read('lib/authServer.ts');
const reservationsPage = read('app/dashboard/reservations/page.tsx');
const reservationConsole = read('components/reservations/ReservationConsole.tsx');
const reservationCalendarPage = read('app/dashboard/reservations/calendar/page.tsx');
const reservationInputs = read('components/reservations/ReservationInputs.tsx');
const reservationEditor = read('components/reservations/ReservationEditPanel.tsx');
const metrics = read('lib/reservations/metrics.ts');
const reservationDetailRoute = read('app/api/reservations/[id]/route.ts');
const routes = [
  read('app/api/reservations/route.ts'), read('app/api/reservations/[id]/route.ts'),
  read('app/api/reservations/[id]/status/route.ts'), calendarRoute, historyRoute,
].join('\n');

test('phone normalization produces strict E.164 and strips one national trunk prefix', () => {
  assert.deepEqual(normalizePhone('+961', '03 123 456'), { countryCallingCode: '+961', nationalPhoneNumber: '3123456', phoneE164: '+9613123456' });
  assert.throws(() => normalizePhone('961', '03123456'), /CALLING_CODE/);
  assert.throws(() => normalizePhone('+961', '12'), /PHONE_INVALID/);
});

test('guests deduplicate within a company while the same phone remains valid across companies', () => {
  assert.match(migration, /UNIQUE INDEX reservation_guests_company_phone_uidx[\s\S]+company_id, phone_e164/);
  assert.match(migration, /ON CONFLICT\(company_id,phone_e164\)/);
  assert.doesNotMatch(migration, /UNIQUE\s*\(phone_e164\)/);
});

test('core reservation, waitlist, status history, and telephony tables are forward-only', () => {
  for (const table of ['reservation_guests','reservations','reservation_waitlist_entries','reservation_status_history','reservation_telephony_destinations','reservation_incoming_call_sessions']) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`));
  }
  assert.match(migration, /^BEGIN;[\s\S]+COMMIT;\s*$/m);
});

test('database constraints bound every allowlist, party size, duration, and waitlist window', () => {
  assert.match(migration, /guest_count BETWEEN 1 AND 100/);
  for (const value of ['pending','confirmed','waitlisted','seated','completed','cancelled','no_show','ai_concierge','bachelorette','no_preference']) assert.match(migration, new RegExp(`'${value}'`));
  assert.match(migration, /expected_end_at > starts_at/);
  assert.match(migration, /earliest_time <= latest_time/);
  assert.match(migration, /reservation_waitlist_active_dedup_uidx/);
});

test('tenant, active-location, guest, conversion, and local-time contexts fail closed', () => {
  assert.match(migration, /l\.company_id = NEW\.company_id AND l\.status = 'active'/);
  assert.match(migration, /g\.id = NEW\.guest_id AND g\.company_id = NEW\.company_id/);
  assert.match(migration, /RESERVATION_WAITLIST_CONVERSION_INVALID/);
  assert.match(migration, /NEW\.starts_at AT TIME ZONE v_timezone/);
});

test('shared reservation trigger isolates table-specific NEW fields for every attached table', () => {
  const attachedTables = [...migration.matchAll(
    /CREATE TRIGGER \S+ BEFORE INSERT OR UPDATE OR DELETE ON public\.(\w+)[\s\S]*?EXECUTE FUNCTION private\.validate_reservation_context\(\);/g,
  )].map((match) => match[1]);

  assert.deepEqual(attachedTables.sort(), [
    'reservation_guests',
    'reservation_incoming_call_sessions',
    'reservation_status_history',
    'reservation_telephony_destinations',
    'reservation_waitlist_entries',
    'reservations',
  ]);

  const triggerBody = migration.match(
    /CREATE FUNCTION private\.validate_reservation_context\(\)[\s\S]*?AS \$function\$([\s\S]*?)\n\$function\$;/,
  )?.[1];
  assert.ok(triggerBody);
  assert.doesNotMatch(
    triggerBody,
    /TG_TABLE_NAME IN \([^)]*\)[\s\S]{0,300}NEW\.(guest_id|reservation_id|converted_reservation_id|assigned_operator_id)/,
  );

  for (const [table, expectedReferences] of Object.entries({
    reservation_guests: ['NEW.created_by'],
    reservations: ['NEW.guest_id', 'NEW.starts_at', 'NEW.reservation_date', 'NEW.reservation_time'],
    reservation_waitlist_entries: ['NEW.guest_id', 'NEW.converted_reservation_id'],
    reservation_status_history: ['NEW.reservation_id', 'NEW.new_status'],
    reservation_incoming_call_sessions: ['NEW.guest_id', 'NEW.assigned_operator_id'],
    reservation_telephony_destinations: ['NULL;'],
  })) {
    const branchPattern = new RegExp(
      `(?:IF|ELSIF) TG_TABLE_NAME = '${table}' THEN([\\s\\S]*?)(?=\\n  (?:ELSIF|END IF;))`,
    );
    const branch = triggerBody.match(branchPattern)?.[1];
    assert.ok(branch, `missing isolated trigger branch for ${table}`);
    for (const reference of expectedReferences) {
      assert.match(branch, new RegExp(reference.replace('.', '\\.')));
    }
  }
});

test('reservation local-time validation uses the selected active location timezone', () => {
  assert.match(timezoneRepair, /^--[^\n]+\nBEGIN;/);
  assert.match(timezoneRepair, /CREATE OR REPLACE FUNCTION private\.validate_reservation_context\(\)/);
  assert.match(timezoneRepair, /RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''/);
  assert.match(
    timezoneRepair,
    /SELECT l\.timezone\s+INTO v_timezone\s+FROM public\.locations l\s+WHERE l\.id = NEW\.location_id\s+AND l\.company_id = NEW\.company_id\s+AND l\.status = 'active'/,
  );
  assert.match(timezoneRepair, /NEW\.starts_at AT TIME ZONE v_timezone[\s\S]+NEW\.reservation_date/);
  assert.match(timezoneRepair, /NEW\.starts_at AT TIME ZONE v_timezone[\s\S]+NEW\.reservation_time/);
  assert.doesNotMatch(timezoneRepair, /SELECT c\.timezone[\s\S]+FROM public\.companies/);
  assert.match(timezoneRepair, /ALTER FUNCTION private\.validate_reservation_context\(\) OWNER TO postgres/);
  assert.match(timezoneRepair, /REVOKE ALL ON FUNCTION private\.validate_reservation_context\(\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(timezoneRepair, /COMMIT;\s*$/);
});

test('timezone repair replaces only the shared trigger function and preserves every protected branch', () => {
  assert.equal((timezoneRepair.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 1);
  assert.doesNotMatch(timezoneRepair, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|POLICY|TRIGGER|INDEX)\b/i);
  for (const protection of [
    'RESERVATION_HISTORY_APPEND_ONLY',
    'RESERVATION_HISTORY_RETAINED',
    'RESERVATION_ACTOR_INVALID',
    'RESERVATION_TRIGGER_TABLE_INVALID',
    'RESERVATION_LOCATION_INVALID',
    'RESERVATION_GUEST_INVALID',
    'RESERVATION_LOCAL_TIME_INVALID',
    'RESERVATION_WAITLIST_CONVERSION_INVALID',
    'RESERVATION_HISTORY_CONTEXT_INVALID',
  ]) {
    assert.match(timezoneRepair, new RegExp(protection));
  }
});

test('manual creation atomically finds or creates the guest and reservation or waitlist', () => {
  assert.match(migration, /CREATE FUNCTION public\.create_manual_reservation/);
  assert.match(migration, /INSERT INTO public\.reservation_guests[\s\S]+ON CONFLICT[\s\S]+IF p_waitlist THEN[\s\S]+INSERT INTO public\.reservation_waitlist_entries[\s\S]+ELSE[\s\S]+INSERT INTO public\.reservations/);
  assert.match(service, /serviceRole\.rpc\('create_manual_reservation'/);
});

test('status transitions are locked, allowlisted, historical, and atomic', () => {
  assert.match(migration, /WHERE r\.id=p_reservation_id AND r\.company_id=p_company_id FOR UPDATE/);
  assert.match(migration, /RESERVATION_STATUS_TRANSITION_INVALID/);
  assert.match(migration, /INSERT INTO public\.reservation_status_history/);
  assert.match(migration, /RESERVATION_HISTORY_APPEND_ONLY/);
  assert.match(migration, /RESERVATION_HISTORY_RETAINED/);
});

test('forced RLS permits management reads and denies browser or direct service writes', () => {
  assert.equal((migration.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length, 6);
  assert.match(migration, /private\.can_view_camera_manager\(company_id\)/);
  assert.match(migration, /REVOKE ALL ON public\.reservation_guests[\s\S]+FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(migration, /GRANT SELECT ON public\.reservation_guests[\s\S]+TO authenticated,service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_manual_reservation[\s\S]+TO service_role/);
});

test('API derives tenant and actor context and rejects unauthorized employees', () => {
  assert.match(routes, /resolveActorContext/);
  assert.match(routes, /canManageReservations\(actor\.role\)/);
  assert.doesNotMatch(routes, /params\.get\(['"]company|row\.company|input\.company/);
  assert.match(routes, /RESERVATION_FORBIDDEN/);
});

test('calendar and history preserve typed authentication failures as 401 or 403', () => {
  for (const route of [calendarRoute, historyRoute]) {
    assert.match(route, /import \{ ActorContextError \} from '@\/lib\/brain\/kernel\/errors'/);
    assert.match(route, /error instanceof ActorContextError/);
    assert.match(route, /error\.code === 'UNAUTHENTICATED' \? 401 : 403/);
    assert.match(route, /resolveActorContext\(client\)[\s\S]+canManageReservations\(actor\.role\)/);
  }
  assert.match(calendarRoute, /RESERVATION_UNAVAILABLE[\s\S]+status: 503/);
  assert.match(historyRoute, /RESERVATION_HISTORY_UNAVAILABLE[\s\S]+status: 503/);
});

test('reservation location loading uses one canonical active company-scoped query', () => {
  assert.match(locationsRoute, /export async function GET\(\)/);
  assert.match(locationsRoute, /resolveActorContext\(supabaseAuth\)/);
  assert.match(locationsRoute, /canManageReservations\(actor\.role\)/);
  assert.match(locationsRoute, /getAccessibleLocations\(supabaseAuth, actor\)/);
  assert.match(locationsRoute, /\{ data: \{ locations \} \}/);
  assert.match(locationsRoute, /LOCATION_LIST_FORBIDDEN/);

  const accessibleLocationFunction = locationService.match(
    /export async function getAccessibleLocations[\s\S]+?\n}\n/,
  )?.[0] ?? '';
  assert.match(accessibleLocationFunction, /\.select\('id,name'\)/);
  assert.match(accessibleLocationFunction, /\.eq\('company_id', actor\.companyId\)/);
  assert.match(accessibleLocationFunction, /\.eq\('status', 'active'\)/);
  assert.equal((accessibleLocationFunction.match(/\.from\('locations'\)/g) ?? []).length, 1);

  assert.match(reservationsPage, /ReservationConsole/);
  for (const page of [reservationConsole, reservationCalendarPage]) {
    assert.equal((page.match(/fetch\('\/api\/locations'/g) ?? []).length, 1);
    assert.match(page, /response\.ok && Array\.isArray\(payload\?\.data\?\.locations\)/);
  }
});

test('Reservation Desk V2 remains an operator console over the existing secured APIs', () => {
  assert.match(reservationConsole, /translations\.reservationDesk/);
  assert.match(reservationConsole, /copy\.form\.mode/);
  assert.match(reservationConsole, /copy\.form\.title/);
  assert.match(reservationConsole, /copy\.form\.returningGuest/);
  assert.match(reservationConsole, /copy\.form\.availabilityUnknown/);
  assert.match(reservationConsole, /submittingRef\.current/);
  assert.match(reservationConsole, /copy\.form\.submitHint/);
  assert.match(reservationConsole, /fetch\(`\/api\/reservations\?\$\{params\}`/);
  assert.match(reservationConsole, /fetch\('\/api\/reservations', \{\s*method: 'POST'/);
  assert.match(reservationConsole, /fetch\(`\/api\/reservations\/\$\{row\.id\}\/status`, \{\s*method: 'PATCH'/);
  assert.match(reservationConsole, /fetch\(`\/api\/reservations\/\$\{row\.id\}`/);
  assert.doesNotMatch(reservationConsole, /\/api\/(?:cameras|ai)|snapshot|nvr|openai/i);
});

test('same-date and comparable-weekday historical helpers are factual', () => {
  assert.equal(sameDateLastYear('2026-07-26'), '2025-07-26');
  assert.equal(new Date(`${comparableWeekdayLastYear('2026-07-26')}T12:00:00Z`).getUTCDay(), 0);
});

test('calendar aggregation is stable across day, week, and month consumers', () => {
  const result = aggregateCalendar([
    { reservation_date: '2026-07-26', guest_count: 4, status: 'confirmed' },
    { reservation_date: '2026-07-26', guest_count: 2, status: 'cancelled' },
  ]);
  assert.deepEqual(result['2026-07-26'], {
    activeReservations: 1,
    expectedGuests: 4,
    confirmedReservations: 1,
    pendingReservations: 0,
    waitingListCount: 0,
    waitingListGuests: 0,
    seatedReservations: 0,
    seatedGuests: 0,
    cancelledReservations: 1,
    noShowReservations: 0,
    completedReservations: 0,
  });
});

test('canonical daily metrics exclude cancelled, no-show, completed, and waitlisted covers', () => {
  const rows = [
    { guest_count: 3, status: 'pending' },
    { guest_count: 5, status: 'confirmed' },
    { guest_count: 2, status: 'seated' },
    { guest_count: 11, status: 'cancelled' },
    { guest_count: 27, status: 'no_show' },
    { guest_count: 7, status: 'completed' },
    { guest_count: 4, status: 'waitlisted' },
  ];
  const result = aggregateReservationMetrics(rows, [
    { guest_count: 6, status: 'waiting' },
    { guest_count: 9, status: 'converted' },
  ]);
  assert.equal(result.activeReservations, 3);
  assert.equal(result.expectedGuests, 10);
  assert.equal(result.waitingListCount, 2);
  assert.equal(result.waitingListGuests, 10);
  assert.equal(result.cancelledReservations, 1);
  assert.equal(result.noShowReservations, 1);
  assert.equal(result.completedReservations, 1);
});

test('cancelling a pending reservation immediately removes it from expected guests', () => {
  const pending = aggregateReservationMetrics([{ guest_count: 4, status: 'pending' }]);
  const cancelled = aggregateReservationMetrics([{ guest_count: 4, status: 'cancelled' }]);
  assert.equal(pending.activeReservations, 1);
  assert.equal(pending.expectedGuests, 4);
  assert.equal(cancelled.activeReservations, 0);
  assert.equal(cancelled.expectedGuests, 0);
});

test('dashboard and calendar consume the same server-side canonical aggregation', () => {
  assert.match(calendarRoute, /aggregateReservationMetrics/);
  assert.match(calendarRoute, /summary/);
  assert.match(reservationConsole, /setDailyMetrics\(payload\.data\.summary/);
  assert.match(reservationCalendarPage, /setSummary\(payload\.data\.summary/);
  assert.match(reservationConsole, /Promise\.all\(\[loadReservations\(\), loadDailySummary\(\)\]\)/);
  assert.match(metrics, /ACTIVE_EXPECTED_RESERVATION_STATUSES = \['pending', 'confirmed', 'seated'\]/);
});

test('guest count accepts arbitrary valid whole numbers without fixed presets', () => {
  assert.match(reservationInputs, /type="number"/);
  assert.match(reservationInputs, /inputMode="numeric"/);
  assert.match(reservationInputs, /min=\{minimum\}/);
  assert.match(reservationInputs, /max=\{maximum\}/);
  assert.match(reservationInputs, /onChange\(event\.target\.value === '' \? '' : Number/);
  assert.doesNotMatch(reservationConsole, /QUICK_PARTIES|2,\s*4,\s*6,\s*8/);
});

test('date and time controls support direct venue-local selection without preset lock-in', () => {
  assert.match(reservationInputs, /Array\.from\(\{ length: 42 \}/);
  assert.match(reservationInputs, /Previous month/);
  assert.match(reservationInputs, /Next month/);
  assert.match(reservationInputs, /onTouchStart/);
  assert.match(reservationInputs, /copy\?\.today \?\? 'Today'/);
  assert.match(reservationInputs, /copy\?\.clear \?\? 'Clear'/);
  assert.match(reservationInputs, /type="time"/);
  assert.match(reservationInputs, /step=\{60\}/);
  assert.match(reservationInputs, /Venue-local time[\s\S]+any minute accepted/);
  assert.match(reservationConsole, /venueDate\(nextTimezone\)/);
  assert.doesNotMatch(reservationConsole, /QUICK_TIMES/);
});

test('venue-local date remains correct across UTC date boundaries', () => {
  const instant = new Date('2026-07-26T22:30:00.000Z');
  assert.equal(venueDate('Asia/Beirut', instant), '2026-07-27');
  assert.equal(venueDate('America/New_York', instant), '2026-07-26');
});

test('reservation editor is an in-place sheet with discard and duplicate-submit protection', () => {
  for (const field of ['firstName','lastName','phoneNumber','guestCount','date','time','expectedDurationMinutes','purpose','seatingPreference','notes','status']) {
    assert.match(reservationEditor, new RegExp(field));
  }
  assert.match(reservationEditor, /sm:justify-end/);
  assert.match(reservationEditor, /rounded-t-\[28px\]/);
  assert.match(reservationEditor, /detailCopy\.discard/);
  assert.match(reservationEditor, /beforeunload/);
  assert.match(reservationEditor, /submittingRef\.current/);
  assert.match(reservationEditor, /method: 'PATCH'/);
  assert.match(reservationConsole, /openDetails\(row\)/);
});

test('reservation update contract is atomic, tenant-safe, and service-role-only', () => {
  assert.match(experienceMigration, /^--[^\n]+\nBEGIN;/);
  assert.match(experienceMigration, /CREATE FUNCTION public\.update_manual_reservation/);
  assert.match(experienceMigration, /SECURITY DEFINER SET search_path = ''/);
  assert.match(experienceMigration, /p\.id = p_actor_profile_id[\s\S]+p\.company_id = p_company_id[\s\S]+p\.status = 'active'/);
  assert.match(experienceMigration, /r\.id = p_reservation_id[\s\S]+r\.company_id = p_company_id[\s\S]+FOR UPDATE/);
  assert.match(experienceMigration, /UPDATE public\.reservation_guests[\s\S]+UPDATE public\.reservations/);
  assert.match(experienceMigration, /IF v_previous_status IS DISTINCT FROM p_new_status THEN[\s\S]+INSERT INTO public\.reservation_status_history/);
  assert.match(experienceMigration, /REVOKE ALL ON FUNCTION public\.update_manual_reservation[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(experienceMigration, /GRANT EXECUTE ON FUNCTION public\.update_manual_reservation[\s\S]+TO service_role/);
  assert.doesNotMatch(experienceMigration, /UPDATE\s+public\.reservations[\s\S]+SET\s+company_id|SET\s+source|SET\s+guest_id/i);
  assert.match(experienceMigration, /COMMIT;\s*$/);
  assert.match(reservationDetailRoute, /resolveActorContext\(authenticated\)/);
  assert.match(reservationDetailRoute, /canManageReservations\(actor\.role\)/);
  assert.match(service, /serviceRole\.rpc\('update_manual_reservation'/);
});

test('reservation experience uses the one shared authenticated navigation and Brain entry point', () => {
  assert.doesNotMatch(reservationConsole, /Reservation operator navigation/);
  assert.doesNotMatch(reservationConsole, /href="\/dashboard\/ai-assistant"/);
  const shell = read('components/brain-experience/BrainExperienceShell.tsx');
  const sidebar = read('components/DashboardSidebar.tsx');
  assert.match(shell, /className="brain-orb"/);
  assert.match(sidebar, /aria-label=\{t\.navigation\.quickLabel\}/);
});

test('incoming-call workflow verifies signature, scopes destination, and never creates a reservation', async () => {
  let published = 0;
  const popup = await handleIncomingCall(JSON.stringify({ providerCallId: 'call-1', destinationNumber: '+9611111111', callerNumber: '+9613123456', occurredAt: '2026-07-26T12:00:00Z' }), 'valid-test-signature', new MockTelephonyProviderAdapter(), {
    async resolveDestination() { return { companyId: 'company-a', locationId: 'location-a' }; },
    async findGuest() { return null; }, async loadHistory() { throw new Error('not called'); },
    async createSession() { return 'session-1'; }, async publishToAuthorizedOperators() { published += 1; },
  });
  assert.equal(popup.existingGuest, null); assert.equal(published, 1);
  await assert.rejects(() => handleIncomingCall('{}', 'bad', new MockTelephonyProviderAdapter(), /** @type {any} */ ({})), /SIGNATURE/);
});

test('availability stays unknown and no Timeline, AI, NVR, provider, messaging, or automatic booking path exists', () => {
  const sources = [migration, service, routes, read('lib/reservations/availability.ts'), read('lib/reservations/telephony.ts')].join('\n');
  assert.match(sources, /CAPACITY_RULES_NOT_CONFIGURED/);
  assert.doesNotMatch(sources, /persist_brain_timeline_event|openai|snapshot_request|nvr_|sendSms|sendEmail|sendWhatsApp/);
  assert.doesNotMatch(read('lib/reservations/telephony.ts'), /createManualReservation|create_manual_reservation/);
});
