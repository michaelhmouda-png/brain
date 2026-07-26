import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { aggregateCalendar, comparableWeekdayLastYear, sameDateLastYear } from '../lib/reservations/history.ts';
import { normalizePhone } from '../lib/reservations/phone.ts';
import { MockTelephonyProviderAdapter, handleIncomingCall } from '../lib/reservations/telephony.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/202607250004_reservation_os_foundation_v1.sql');
const service = read('lib/reservations/service.server.ts');
const routes = [
  read('app/api/reservations/route.ts'), read('app/api/reservations/[id]/route.ts'),
  read('app/api/reservations/[id]/status/route.ts'), read('app/api/reservations/calendar/route.ts'),
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

test('same-date and comparable-weekday historical helpers are factual', () => {
  assert.equal(sameDateLastYear('2026-07-26'), '2025-07-26');
  assert.equal(new Date(`${comparableWeekdayLastYear('2026-07-26')}T12:00:00Z`).getUTCDay(), 0);
});

test('calendar aggregation is stable across day, week, and month consumers', () => {
  const result = aggregateCalendar([
    { reservation_date: '2026-07-26', guest_count: 4, status: 'confirmed' },
    { reservation_date: '2026-07-26', guest_count: 2, status: 'cancelled' },
  ]);
  assert.deepEqual(result['2026-07-26'], { reservationCount: 2, expectedGuests: 6, confirmed: 1, waiting: 0, cancelled: 1, noShows: 0 });
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
