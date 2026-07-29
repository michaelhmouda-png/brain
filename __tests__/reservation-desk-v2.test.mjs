import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  projectReservationDeskRows,
  shiftVenueDate,
} from '../lib/reservations/desk.ts';
import { validateTranslationCatalog } from '../lib/i18n.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const consoleSource = read('components/reservations/ReservationConsole.tsx');
const editorSource = read('components/reservations/ReservationEditPanel.tsx');
const inputsSource = read('components/reservations/ReservationInputs.tsx');
const calendarSource = read('app/dashboard/reservations/calendar/page.tsx');
const i18nSource = read('lib/i18n.ts');
const globalsSource = read('app/globals.css');

const rows = [
  {
    id: 'late',
    reservation_time: '20:30:00',
    guest_count: 2,
    status: 'confirmed',
    guest: { first_name: 'Ziad', last_name: 'Saleh', phone_e164: '+96170000002' },
  },
  {
    id: 'early',
    reservation_time: '18:15:00',
    guest_count: 6,
    status: 'pending',
    guest: { first_name: 'Amal', last_name: 'Haddad', phone_e164: '+96170000001' },
  },
  {
    id: 'cancelled',
    reservation_time: '19:00:00',
    guest_count: 4,
    status: 'cancelled',
    guest: { first_name: 'Rami', last_name: 'Khoury', phone_e164: '+96170000003' },
  },
];

test('venue-local date navigation is calendar-date based and stable across month boundaries', () => {
  assert.equal(shiftVenueDate('2026-07-31', 1), '2026-08-01');
  assert.equal(shiftVenueDate('2026-03-01', -1), '2026-02-28');
  assert.match(consoleSource, /shiftVenueDate\(current, -1\)/);
  assert.match(consoleSource, /shiftVenueDate\(current, 1\)/);
  assert.match(consoleSource, /new URLSearchParams\(\{ limit: '100', locationId, date: selectedDate \}\)/);
  assert.match(consoleSource, /venueDate\(nextTimezone\)/);
});

test('desk projection defaults to chronological order and supports scoped search, filters, and sorts', () => {
  assert.deepEqual(
    projectReservationDeskRows(rows, '', 'all', 'time_asc').map((row) => row.id),
    ['early', 'cancelled', 'late'],
  );
  assert.deepEqual(
    projectReservationDeskRows(rows, '', 'active', 'time_asc').map((row) => row.id),
    ['early', 'late'],
  );
  assert.deepEqual(
    projectReservationDeskRows(rows, '70000003', 'all', 'time_asc').map((row) => row.id),
    ['cancelled'],
  );
  assert.deepEqual(
    projectReservationDeskRows(rows, '', 'all', 'guest_name').map((row) => row.id),
    ['early', 'cancelled', 'late'],
  );
  assert.deepEqual(
    projectReservationDeskRows(rows, '', 'all', 'party_size').map((row) => row.id),
    ['early', 'cancelled', 'late'],
  );
});

test('summary and cards use canonical truthful reservation projections', () => {
  assert.match(consoleSource, /dailyMetrics\.activeReservations/);
  assert.match(consoleSource, /dailyMetrics\.expectedGuests/);
  assert.match(consoleSource, /dailyMetrics\.waitingListCount/);
  assert.match(consoleSource, /row\.purpose_details/);
  assert.match(consoleSource, /row\.notes/);
  assert.match(consoleSource, /row\.creator\?\.full_name/);
  assert.match(consoleSource, /row\.guest\?\.phone_e164/);
  assert.doesNotMatch(consoleSource, /assigned_table_id|tableNumber|capacityAvailable|email/);
  assert.doesNotMatch(consoleSource, /status:\s*'arrived'|\bArrived\b/);
});

test('new reservation form follows the service-first field order without inventing email', () => {
  const orderedMarkers = [
    "aria-checked={form.source === 'walk_in'}",
    'copy.form.firstName',
    'copy.form.lastName',
    'copy.form.countryCode',
    'copy.form.phone',
    '<GuestCountInput',
    'copy.form.notes',
    'copy.form.seating',
    'copy.form.occasion',
    '<ReservationDatePicker',
    '<ReservationTimeInput',
    'aria-checked={form.waitlist}',
    'form="reservation-quick-form"',
  ];
  let cursor = -1;
  for (const marker of orderedMarkers) {
    const next = consoleSource.indexOf(marker, cursor + 1);
    assert.ok(next > cursor, `${marker} must appear in the required order`);
    cursor = next;
  }
  assert.doesNotMatch(consoleSource, /type="email"|form\.email/);
  assert.match(consoleSource, /form\.source === 'walk_in' \? 'phone' : 'walk_in'/);
  assert.match(consoleSource, /className="mobile-scroll-region min-h-0 min-w-0 flex-1 overflow-y-auto"/);
  assert.match(consoleSource, /pb-\[max\(0\.875rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(consoleSource, /submittingRef\.current/);
});

test('date picker stages selection and exposes venue-local Today, Cancel, and Apply actions', () => {
  assert.match(inputsSource, /pendingValue/);
  assert.match(inputsSource, /onClick=\{\(\) => setPendingValue\(dayValue\)\}/);
  assert.match(inputsSource, /onChange\(pendingValue\)/);
  assert.match(inputsSource, /copy\?\.cancel \?\? 'Cancel'/);
  assert.match(inputsSource, /copy\?\.apply \?\? 'Apply'/);
  assert.match(inputsSource, /rtl:rotate-180/);
});

test('mobile action bar is compact, safe-area aware, and preserves the global navigation', () => {
  for (const key of ['search', 'filters', 'sort']) {
    assert.match(consoleSource, new RegExp(`aria-label=\\{copy\\.toolbar\\.${key}\\}`));
  }
  assert.match(consoleSource, /data-reservation-mobile-actions/);
  assert.match(consoleSource, /bottom-\[calc\(4\.375rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(consoleSource, /z-40 flex min-w-0 items-stretch gap-1 sm:hidden/);
  assert.match(consoleSource, /min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-300/);
  assert.doesNotMatch(consoleSource, /data-reservation-mobile-actions[\s\S]{0,240}grid-cols-5/);
  assert.doesNotMatch(consoleSource, /replaceState|router\.replace|global mobile navigation/i);
});

test('mobile desk has no fixed blank region and keeps the list immediately after flat counters', () => {
  assert.match(consoleSource, /<section className="grid grid-cols-\[1fr_1fr_0\.78fr\][\s\S]+<section className="min-w-0">[\s\S]+data-reservation-list/);
  assert.doesNotMatch(consoleSource, /min-h-\[(?:600|700|800)px\]/);
  assert.doesNotMatch(consoleSource, /min-h-72/);
  assert.match(consoleSource, /data-reservation-list/);
  assert.match(consoleSource, /px-6 py-10 text-center sm:py-16/);
  assert.match(consoleSource, /overflow-x-clip/);
});

test('mobile controls expose one bounded panel at a time while desktop controls remain visible', () => {
  assert.match(consoleSource, /mobileControls \? 'block' : 'hidden'/);
  assert.match(consoleSource, /mobileControls === 'search' \? 'flex' : 'hidden'/);
  assert.match(consoleSource, /mobileControls === 'sort' \? 'block' : 'hidden'/);
  assert.match(consoleSource, /current === 'filters' \? null : 'filters'/);
  assert.match(consoleSource, /current === 'sort' \? null : 'sort'/);
  assert.match(consoleSource, /const opening = mobileControls !== 'search'/);
  assert.match(consoleSource, /sm:block sm:px-6 sm:py-3/);
  assert.match(consoleSource, /sm:rounded-\[28px\] sm:border/);
});

test('390px and 430px mobile contracts remain RTL-safe without horizontal overflow', () => {
  assert.match(consoleSource, /min-w-0 max-w-full overflow-x-clip/);
  assert.match(consoleSource, /fixed inset-x-3/);
  assert.match(consoleSource, /min-w-11 shrink-0/);
  assert.match(consoleSource, /rtl:rotate-180/);
  assert.doesNotMatch(consoleSource, /\bw-\[(?:390|430)px\]|min-w-\[(?:390|430)px\]/);
});

test('reservation cards use one compact responsive host-desk hierarchy', () => {
  assert.match(consoleSource, /data-reservation-card[\s\S]+grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.match(consoleSource, /scroll-mb-\[calc\(7\.75rem\+env\(safe-area-inset-bottom\)\)\][\s\S]+bg-\[#0d1622\] p-3/);
  assert.match(consoleSource, /line-clamp-2 min-w-0 text-sm font-bold leading-5/);
  assert.match(consoleSource, /row\.purpose !== 'regular'/);
  assert.match(consoleSource, /min-w-0 truncate text-xs text-amber-100\/70/);
  assert.doesNotMatch(consoleSource, /className="sm:hidden"[\s\S]{0,4000}className="hidden items-start gap-3 sm:flex/);
  assert.equal((consoleSource.match(/data-reservation-card/g) ?? []).length, 2);
});

test('mobile cards expose at most one primary action and move secondary actions into details', () => {
  assert.match(consoleSource, /const primaryAction = row\.status === 'pending'/);
  assert.match(consoleSource, /statusActions\[row\.status\][\s\S]+\.find\(\(action\) => action\.primary\)/);
  assert.match(consoleSource, /void transition\(row, primaryAction\.status\)/);
  assert.match(consoleSource, /aria-label=\{copy\.actions\[primaryAction\.action\]\}/);
  assert.doesNotMatch(consoleSource, /actions\.map\(\(action\)/);
  assert.match(editorSource, /const TRANSITIONS: Record<string, string\[\]>/);
  assert.match(editorSource, /allowedStatuses\.map/);
  assert.match(editorSource, /onRebook && \['cancelled', 'no_show'\]\.includes\(row\.status\)/);
  assert.match(editorSource, /row\.history\?\.length/);
});

test('card dates and raw phone values are omitted while the phone action stays bidi-safe', () => {
  assert.doesNotMatch(consoleSource, /formatDay\(row\.(?:requested_date|reservation_date), locale\)/);
  assert.match(consoleSource, /href=\{`tel:\$\{row\.guest\.phone_e164\}`\}[\s\S]+dir="ltr"/);
  assert.match(consoleSource, /aria-label=\{`\$\{copy\.form\.phone\}: \$\{row\.guest\.phone_e164\}`\}/);
  assert.doesNotMatch(consoleSource, /<bdi>\{row\.guest\.phone_e164\}<\/bdi>/);
});

test('reservation list clears both fixed mobile layers and the final card can scroll above them', () => {
  assert.match(consoleSource, /data-reservation-list[\s\S]+scroll-pb-\[calc\(7\.75rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(consoleSource, /pb-\[calc\(7\.75rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(consoleSource, /sm:scroll-pb-0 sm:pb-3/);
  assert.match(consoleSource, /scroll-mb-\[calc\(7\.75rem\+env\(safe-area-inset-bottom\)\)\]/);
});

test('mobile header and flat counters stay compact while desktop actions remain available', () => {
  assert.match(consoleSource, /<header className="border-b[\s\S]+px-3 py-2\.5 sm:px-4 sm:py-3/);
  assert.match(consoleSource, /w-\[min\(10\.5rem,44vw\)\]/);
  assert.match(consoleSource, /grid grid-cols-\[1fr_1fr_0\.78fr\] border-b/);
  assert.match(consoleSource, /min-w-0 px-2 py-2 text-center sm:px-4 sm:py-3/);
  assert.match(consoleSource, /hidden min-h-11 items-center gap-2[\s\S]+sm:flex/);
  assert.match(consoleSource, /compactOnMobile[\s\S]+copy\.reservationCount[\s\S]+copy\.guests[\s\S]+copy\.waitingCount/);
  assert.match(inputsSource, /compactOnMobile \? 'min-h-11 gap-2 px-3 sm:min-h-12 sm:gap-3 sm:px-3\.5'/);
});

test('source-controlled floating controls cannot cover Reservation mobile actions', () => {
  assert.match(consoleSource, /data-reservation-desk/);
  assert.match(consoleSource, /data-reservation-mobile-actions[\s\S]+z-40/);
  assert.match(globalsSource, /@media \(max-width: 1023px\)[\s\S]+\.brain-mobile-nav\s*\{[\s\S]+z-index:\s*50/);
  assert.match(globalsSource, /@media \(max-width: 1023px\)[\s\S]+\.brain-orb\s*\{[\s\S]+display:\s*none/);
});

test('detail, status history, cancellation confirmation, and rebook use existing paths', () => {
  assert.match(consoleSource, /openDetails\(row\)/);
  assert.match(consoleSource, /fetch\(`\/api\/reservations\/\$\{row\.id\}`/);
  assert.match(editorSource, /row\.history\?\.length/);
  assert.match(editorSource, /detailCopy\.confirmCancel/);
  assert.match(consoleSource, /ReservationRebookPanel/);
  assert.match(consoleSource, /\['cancelled', 'no_show'\]\.includes\(row\.status\)/);
  assert.match(consoleSource, /fetch\(`\/api\/reservations\/\$\{row\.id\}\/status`/);
});

test('weekly analytics remain secondary and use only canonical calendar data', () => {
  assert.match(consoleSource, /href="\/dashboard\/reservations\/calendar"/);
  assert.match(calendarSource, /view === 'week'/);
  assert.match(calendarSource, /summary\.activeReservations/);
  assert.match(calendarSource, /summary\.expectedGuests/);
  assert.match(calendarSource, /summary\.cancelledReservations \+ summary\.noShowReservations/);
  assert.match(calendarSource, /reservations\.reduce<Record<string, number>>/);
  assert.doesNotMatch(calendarSource, /Math\.random|percentage|forecast/i);
});

test('English and Arabic catalogs are complete and RTL uses logical direction', () => {
  assert.deepEqual(validateTranslationCatalog(), []);
  assert.equal((i18nSource.match(/reservationDesk:\s*\{/g) ?? []).length, 2);
  for (const source of [consoleSource, editorSource, calendarSource, inputsSource]) {
    assert.doesNotMatch(source, /\b(left|right)-\d\b/);
  }
  assert.match(consoleSource, /text-start/);
  assert.match(consoleSource, /rtl:-translate-x-5/);
  assert.match(calendarSource, /rtl:rotate-180/);
});

test('dark theme and responsive desktop contracts remain bounded to Reservations', () => {
  assert.match(consoleSource, /bg-\[var\(--surface-nav\)\]/);
  assert.match(consoleSource, /bg-cyan-300/);
  assert.match(consoleSource, /text-white/);
  assert.match(consoleSource, /sm:w-\[min\(560px,calc\(100vw-1\.5rem\)\)\]/);
  assert.match(editorSource, /sm:w-\[min\(560px,calc\(100vw-2rem\)\)\]/);
  assert.doesNotMatch(consoleSource, /bg-pink|text-pink|QuickSeat/i);
});

test('Reservation Desk V2 makes no business, API, migration, AI, or device changes', () => {
  const combined = [consoleSource, editorSource, inputsSource, calendarSource].join('\n');
  assert.doesNotMatch(combined, /\/api\/(?:cameras|ai)|snapshot_request|nvr_|openai|persist_brain_timeline_event/i);
  assert.doesNotMatch(combined, /service_role|company_id\s*:|ALTER TABLE|CREATE POLICY/i);
});
