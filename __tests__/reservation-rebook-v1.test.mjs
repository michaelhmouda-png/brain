import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { localDateTimeToInstant } from '../lib/brain/tasks/batch/task-batch-time.ts';
import { validateTranslationCatalog } from '../lib/i18n.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/202607280003_reservation_rebook_v1.sql');
const service = read('lib/reservations/service.server.ts');
const route = read('app/api/reservations/[id]/rebook/route.ts');
const detailRoute = read('app/api/reservations/[id]/route.ts');
const consoleSource = read('components/reservations/ReservationConsole.tsx');
const editor = read('components/reservations/ReservationEditPanel.tsx');
const panel = read('components/reservations/ReservationRebookPanel.tsx');
const inputs = read('components/reservations/ReservationInputs.tsx');

test('rebooking is forward-only and adds the smallest durable relationship', () => {
  assert.match(migration, /^--[^\n]+\nBEGIN;/);
  assert.match(migration, /ADD COLUMN rebooked_from_reservation_id uuid/);
  assert.match(migration, /ADD COLUMN rebook_idempotency_key uuid/);
  assert.match(migration, /REFERENCES public\.reservations\(id\)[\s\S]+ON DELETE RESTRICT/);
  assert.match(migration, /reservations_rebook_not_self_check/);
  assert.match(migration, /reservations_rebook_source_uidx[\s\S]+WHERE rebooked_from_reservation_id IS NOT NULL/);
  assert.match(migration, /reservations_rebook_idempotency_uidx[\s\S]+company_id, rebook_idempotency_key/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.doesNotMatch(migration, /ON DELETE CASCADE|DROP TABLE|DROP COLUMN/);
});

test('only cancelled and no-show originals can create a pending replacement', () => {
  assert.match(migration, /v_original\.status NOT IN \('cancelled','no_show'\)/);
  assert.match(migration, /p_booking_source, p_actor_profile_id,[\s\S]+v_original\.id, p_idempotency_key/);
  assert.match(migration, /p_seating_preference, 'pending', p_booking_source/);
  assert.match(consoleSource, /\['cancelled', 'no_show'\]\.includes\(row\.status\)/);
  assert.doesNotMatch(panel, /status:\s*row\.status|cancellation_reason:[^}]*body/);
});

test('the original remains immutable and the replacement receives a new database UUID', () => {
  const rpc = migration.slice(migration.indexOf('CREATE FUNCTION public.rebook_reservation'));
  assert.match(rpc, /INSERT INTO public\.reservations\(/);
  assert.doesNotMatch(rpc, /UPDATE public\.reservations/);
  assert.doesNotMatch(rpc, /INSERT INTO public\.reservations\(\s*id,/);
  assert.match(migration, /NEW\.rebooked_from_reservation_id IS DISTINCT FROM OLD\.rebooked_from_reservation_id/);
  assert.match(migration, /RESERVATION_REBOOK_LINK_IMMUTABLE/);
});

test('the RPC locks and revalidates trusted tenant, actor, source, guest, and venue state', () => {
  assert.match(migration, /p\.id = p_actor_profile_id[\s\S]+p\.company_id = p_company_id[\s\S]+p\.status = 'active'[\s\S]+p\.role IN \('manager','owner','super_admin'\)/);
  assert.match(migration, /r\.id = p_original_reservation_id[\s\S]+r\.company_id = p_company_id[\s\S]+FOR UPDATE/);
  assert.match(migration, /l\.id = p_location_id[\s\S]+l\.company_id = p_company_id[\s\S]+l\.status = 'active'/);
  assert.match(migration, /v_original\.guest_id/);
  assert.match(route, /resolveActorContext\(authenticated\)/);
  assert.match(route, /canManageReservations\(actor\.role\)/);
  assert.match(service, /p_actor_profile_id: actor\.profileId/);
  assert.match(service, /p_company_id: actor\.companyId/);
  const body = panel.match(/body: JSON\.stringify\(\{([\s\S]*?)\}\),/)?.[1] ?? '';
  assert.doesNotMatch(body, /companyId|company_id|actor_profile_id|role|status:/);
});

test('future venue-local time is converted once and validated again using persisted location timezone', () => {
  assert.match(service, /loadTimezone\(authenticated, actor\.companyId, input\.locationId\)/);
  assert.match(service, /localDateTimeToInstant\(`\$\{input\.date\}T\$\{input\.time\}`, timezone\)/);
  assert.match(service, /NONEXISTENT_BATCH_DUE_TIME[\s\S]+AMBIGUOUS_BATCH_DUE_TIME[\s\S]+RESERVATION_REBOOK_INPUT_INVALID/);
  assert.match(migration, /SELECT l\.timezone[\s\S]+l\.status = 'active'/);
  assert.match(migration, /p_starts_at <= clock_timestamp\(\)/);
  assert.match(migration, /p_starts_at AT TIME ZONE v_timezone/);
  assert.throws(
    () => localDateTimeToInstant('2026-03-29T02:30', 'Europe/Paris'),
    /NONEXISTENT_BATCH_DUE_TIME/,
  );
  assert.throws(
    () => localDateTimeToInstant('2026-10-25T02:30', 'Europe/Paris'),
    /AMBIGUOUS_BATCH_DUE_TIME/,
  );
});

test('old date and time are read-only context and never initialize the new booking fields', () => {
  assert.match(panel, /date: ''/);
  assert.match(panel, /time: ''/);
  assert.match(panel, /row\.reservation_date/);
  assert.match(panel, /row\.reservation_time/);
  assert.match(panel, /!form\.date \|\| !form\.time/);
  assert.match(panel, /Confirm rebooking|t\.confirm/);
  assert.doesNotMatch(panel, /date:\s*row\.reservation_date|time:\s*(?:String\()?row\.reservation_time/);
});

test('copied fields are explicit and sensitive or historical state is not submitted', () => {
  const body = panel.match(/body: JSON\.stringify\(\{([\s\S]*?)\}\),/)?.[1] ?? '';
  for (const field of [
    'idempotencyKey','locationId','guestCount','date','time','expectedDurationMinutes',
    'purpose','purposeDetails','seatingPreference','notes','source',
  ]) assert.match(body, new RegExp(`\\b${field}\\b`));
  for (const forbidden of [
    'company','role','profile','guestId','firstName','lastName','phone','status',
    'cancellationReason','createdAt','updatedAt','payment','provider','webhook',
  ]) assert.doesNotMatch(body, new RegExp(`\\b${forbidden}\\b`, 'i'));
  assert.match(detailRoute, /reservation_guests\(id,first_name,last_name,phone_e164,preferred_language,marketing_consent,notes\)/);
  assert.match(panel, /row\.guest\?\.notes/);
  assert.match(panel, /row\.cancellation_reason/);
});

test('idempotent replay, conflicting replay, and concurrency are deterministic', () => {
  assert.match(migration, /WHERE r\.company_id = p_company_id[\s\S]+r\.rebook_idempotency_key = p_idempotency_key/);
  assert.match(migration, /RESERVATION_REBOOK_REPLAYED/);
  assert.match(migration, /RESERVATION_REBOOK_IDEMPOTENCY_CONFLICT/);
  assert.match(migration, /RESERVATION_ALREADY_REBOOKED/);
  assert.match(migration, /IS DISTINCT FROM p_location_id[\s\S]+IS DISTINCT FROM p_booking_source/);
  assert.match(panel, /const \[idempotencyKey\] = useState/);
  assert.match(panel, /submittingRef\.current/);
  assert.match(migration, /reservations_rebook_source_uidx/);
});

test('creation, initial history, and audit outcomes share one atomic transaction', () => {
  assert.match(migration, /INSERT INTO public\.reservation_rebook_audit[\s\S]+'rebook\.started'/);
  assert.match(migration, /INSERT INTO public\.reservations[\s\S]+INSERT INTO public\.reservation_status_history[\s\S]+INSERT INTO public\.reservation_rebook_audit[\s\S]+'rebook\.completed'/);
  assert.match(migration, /'rebook\.replayed'/);
  assert.match(migration, /'rebook\.failed'/);
  assert.match(migration, /previous_status, new_status[\s\S]+NULL, 'pending'/);
  assert.match(migration, /reservation_rebook_audit_once_uidx/);
  assert.doesNotMatch(migration, /notification_outbox|brain_event_outbox|persist_brain_timeline_event/);
});

test('audit metadata is append-only, tenant validated, and contains no guest PII', () => {
  assert.match(migration, /CREATE TABLE public\.reservation_rebook_audit/);
  assert.match(migration, /RESERVATION_REBOOK_AUDIT_APPEND_ONLY/);
  assert.match(migration, /ALTER TABLE public\.reservation_rebook_audit FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON public\.reservation_rebook_audit[\s\S]+PUBLIC, anon, authenticated, service_role/);
  const table = migration.slice(
    migration.indexOf('CREATE TABLE public.reservation_rebook_audit'),
    migration.indexOf('ALTER TABLE public.reservation_rebook_audit OWNER'),
  );
  assert.doesNotMatch(table, /first_name|last_name|phone|notes|payload|metadata|request_body/);
});

test('browser execution is revoked and only the server service role can invoke the focused RPC', () => {
  assert.match(migration, /SECURITY DEFINER[\s\S]+SET search_path = ''/);
  assert.match(migration, /ALTER FUNCTION public\.rebook_reservation[\s\S]+OWNER TO postgres/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.rebook_reservation[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.rebook_reservation[\s\S]+TO service_role/);
  assert.match(service, /serviceRole\.rpc\('rebook_reservation'/);
  assert.doesNotMatch(panel, /supabase|\.from\('reservations'\)|\.rpc\(/);
});

test('availability remains honestly unknown and no unsupported side effects are added', () => {
  assert.match(service, /CAPACITY_RULES_NOT_CONFIGURED/);
  assert.match(panel, /t\.availabilityUnknown/);
  assert.match(panel, /t\.availabilityHelp/);
  const implementation = [migration, service, route, panel].join('\n');
  assert.doesNotMatch(implementation, /sendSms|sendEmail|sendWhatsApp|openai|snapshot_request|nvr_|assigned_table_id\s*:/i);
});

test('the mobile-safe editor is localized, RTL-aware, and opens the new reservation', () => {
  assert.equal(validateTranslationCatalog().length, 0);
  assert.match(panel, /bg-\[#fbfbf8\]/);
  assert.match(panel, /text-slate-950/);
  assert.match(panel, /max-h-\[94dvh\]/);
  assert.match(panel, /pb-\[max\(0\.875rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(panel, /rtl:sm:justify-start/);
  assert.match(inputs, /rtl:rotate-180/);
  assert.match(consoleSource, /setEditingRow\(payload\.data as ReservationRow\)/);
  assert.match(consoleSource, /onRebook=\{\['cancelled', 'no_show'\]\.includes\(editingRow\.status\)/);
  assert.match(editor, /onRebook && \['cancelled', 'no_show'\]\.includes\(row\.status\)/);
  assert.match(panel, /messages\.reservationRebook/);
});
