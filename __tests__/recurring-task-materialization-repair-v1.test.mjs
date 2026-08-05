import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { migrationSha256 } from '../scripts/migration-hash.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const baseline = read('supabase/migrations/202607240000_current_state_baseline.sql');
const evidenceCounts = read('supabase/migrations/202607280002_camera_evidence_c5_multi_photo_counts.sql');
const recurringV1 = read('supabase/migrations/202607300001_recurring_task_engine_v1.sql');
const shiftV1 = read('supabase/migrations/202607300002_shift_management_creation_v1.sql');
const repair = read('supabase/migrations/202607300003_fix_recurring_task_materialization_v1.sql');
const recurringUi = read('components/recurring-tasks/RecurringRoutinesConsole.tsx');
const recurringService = read('lib/recurring-tasks/service.server.ts');
const recurringContracts = read('lib/recurring-tasks/contracts.ts');

function tableDefinition(source, tableName) {
  const quoted = `CREATE TABLE "public"."${tableName}" (`;
  const plain = `CREATE TABLE public.${tableName} (`;
  const start = Math.max(source.indexOf(quoted), source.indexOf(plain));
  assert.ok(start >= 0, `missing ${tableName}`);
  const end = source.indexOf('\n);', start);
  assert.ok(end > start, `unterminated ${tableName}`);
  return source.slice(start, end + 3);
}

function assertColumns(definition, columns) {
  for (const column of columns) {
    assert.match(definition, new RegExp(`(?:"${column}"|\\b${column}\\b)\\s`), column);
  }
}

test('the exact 42703 source is the renamed generated-task employee column', () => {
  const generated = tableDefinition(recurringV1, 'recurring_task_generated_tasks');
  assertColumns(generated, [
    'occurrence_id', 'company_id', 'assigned_employee_id', 'template_position',
    'task_id', 'evidence_required',
  ]);
  assert.doesNotMatch(generated, /\bemployee_id\s+uuid/);
  assert.match(recurringV1, /SELECT employee_id FROM public\.recurring_task_generated_tasks/);
  assert.doesNotMatch(repair, /SELECT\s+(?:generated\.)?employee_id\s+FROM public\.recurring_task_generated_tasks/);
  assert.match(repair, /SELECT generated\.assigned_employee_id[\s\S]*FROM public\.recurring_task_generated_tasks AS generated/);
});

test('all materialization columns exist in the actual complete migration-chain schema', () => {
  assertColumns(tableDefinition(baseline, 'tasks'), [
    'id', 'company_id', 'title', 'description', 'assigned_employee_id', 'priority',
    'status', 'due_date', 'due_at', 'location_id', 'created_by',
  ]);
  assertColumns(tableDefinition(baseline, 'employees'), [
    'id', 'company_id', 'location_id', 'role', 'department_id', 'status',
  ]);
  assertColumns(tableDefinition(baseline, 'notification_outbox'), [
    'company_id', 'event_key', 'event_type', 'aggregate_type', 'aggregate_id', 'actor_profile_id',
  ]);
  assertColumns(tableDefinition(baseline, 'task_localization_jobs'), [
    'task_id', 'company_id', 'language', 'source_hash',
  ]);
  assertColumns(tableDefinition(evidenceCounts, 'task_evidence_count_requirements'), [
    'task_id', 'company_id', 'count_required', 'count_label', 'canonical_unit',
    'damaged_quantity_requested', 'allow_decimals', 'employee_instructions',
    'created_by_profile_id', 'updated_by_profile_id',
  ]);
  assertColumns(tableDefinition(recurringV1, 'recurring_task_reminders'), [
    'company_id', 'occurrence_id', 'task_id', 'assigned_employee_id',
    'offset_minutes', 'remind_at',
  ]);
  for (const column of ['location_id', 'starts_at', 'ends_at']) {
    assert.match(shiftV1, new RegExp(`ADD COLUMN ${column} `));
    assert.match(repair, new RegExp(`shift\\.${column}`));
  }
});

test('canonical creation verifies task and provenance before reporting success', () => {
  const helper = repair.slice(
    repair.indexOf('CREATE OR REPLACE FUNCTION private.create_recurring_canonical_task'),
    repair.indexOf('CREATE OR REPLACE FUNCTION public.materialize_recurring_task_occurrences'),
  );
  for (const integration of [
    'INSERT INTO public.tasks',
    'INSERT INTO public.recurring_task_generated_tasks',
    'INSERT INTO public.task_evidence_count_requirements',
    'INSERT INTO public.recurring_task_reminders',
    'INSERT INTO public.recurring_task_audit_events',
  ]) assert.ok(helper.includes(integration), integration);
  assert.match(helper, /RECURRING_TASK_ID_CONFLICT/);
  assert.match(helper, /RECURRING_PROVENANCE_CONFLICT/);
  assert.match(helper, /RECURRING_TASK_PERSISTENCE_FAILED/);
  assert.match(helper, /RETURN v_task_id;[\s\S]*END \$\$/);
});

test('task triggers remain the one canonical notification and localization path', () => {
  const helper = repair.slice(
    repair.indexOf('CREATE OR REPLACE FUNCTION private.create_recurring_canonical_task'),
    repair.indexOf('CREATE OR REPLACE FUNCTION public.materialize_recurring_task_occurrences'),
  );
  assert.doesNotMatch(helper, /INSERT INTO public\.notification_outbox/);
  assert.doesNotMatch(helper, /INSERT INTO public\.task_localization_jobs/);
  assert.match(baseline, /CREATE TRIGGER notification_tasks_event AFTER INSERT OR UPDATE ON tasks[\s\S]*private\.queue_notification_event\(\)/);
  assert.match(baseline, /CREATE TRIGGER tasks_enqueue_arabic_localization AFTER INSERT OR UPDATE OF title, description, assigned_employee_id ON tasks[\s\S]*enqueue_arabic_task_localization\(\)/);
  assert.match(baseline, /CREATE OR REPLACE FUNCTION private\.queue_notification_event\(\)[\s\S]*INSERT INTO public\.notification_outbox/);
  assert.match(baseline, /CREATE OR REPLACE FUNCTION public\.enqueue_arabic_task_localization\(\)[\s\S]*INSERT INTO public\.task_localization_jobs/);
});

test('one eligible specific employee creates one verified task and provenance row', () => {
  assert.match(repair, /specificEmployeeId'[\s\S]*employee\.id=\(v_version\.workforce->>'specificEmployeeId'\)::uuid/);
  assert.match(repair, /v_task_id:=private\.create_recurring_canonical_task\([\s\S]*v_occ,v_rule,v_version,v_employee\.id/);
  assert.match(repair, /JOIN public\.recurring_task_generated_tasks AS generated[\s\S]*generated\.assigned_employee_id=v_employee\.id/);
  assert.match(repair, /IF NOT v_task_was_present THEN[\s\S]*v_occ_created:=v_occ_created\+1/);
  assert.match(repair, /selected_employee_id=CASE[\s\S]*'one_matching_employee_on_shift','specific_employee_if_on_shift'/);
  assert.match(repair, /created_task_count=\([\s\S]*count\(\*\)[\s\S]*generated\.occurrence_id=v_occ\.id/);
});

test('returned counters describe only committed and verified outcomes', () => {
  const materializer = repair.slice(repair.indexOf('CREATE OR REPLACE FUNCTION public.materialize_recurring_task_occurrences'));
  const successAggregation = materializer.indexOf('v_created:=v_created+v_occ_created;');
  const occurrenceVerification = materializer.indexOf('RECURRING_OCCURRENCE_VERIFICATION_FAILED');
  const materializedAudit = materializer.indexOf("'occurrence.materialized'");
  assert.ok(successAggregation > occurrenceVerification);
  assert.ok(successAggregation > materializedAudit);
  assert.equal((materializer.match(/v_created:=v_created\+/g) ?? []).length, 1);
  const failure = materializer.slice(materializer.indexOf('WHEN OTHERS THEN'), materializer.indexOf('RETURN QUERY'));
  assert.doesNotMatch(failure, /v_created\s*:=/);
  assert.match(failure, /No created counter is changed in the exception path/);
  assert.match(materializer, /WHEN SQLSTATE 'P0001' THEN[\s\S]*ON CONFLICT\(rule_id,rule_version,local_occurrence_at\) DO UPDATE[\s\S]*RETURNING \* INTO v_occ[\s\S]*IF v_occ\.id IS NOT NULL THEN[\s\S]*v_unresolved:=v_unresolved\+1/);
});

test('the existing pending occurrence retries in place without deletion or identity changes', () => {
  assert.match(repair, /ON CONFLICT\(rule_id,rule_version,local_occurrence_at\) DO NOTHING/);
  assert.match(repair, /SELECT occurrence\.\* INTO v_occ[\s\S]*FOR UPDATE/);
  assert.match(repair, /SET outcome='processing',attempt_count=occurrence\.attempt_count\+1/);
  assert.match(repair, /WHERE occurrence\.id=v_occ\.id/);
  assert.match(repair, /min\(occurrence\.local_occurrence_at::date\)[\s\S]*occurrence\.outcome='pending'/);
  assert.match(repair, /OR v_retry_pending/);
  assert.match(repair, /v_due:=v_occ\.due_at/);
  assert.doesNotMatch(repair, /DELETE FROM public\.recurring_task_occurrences/);
  assert.doesNotMatch(repair, /SET\s+id\s*=/);
});

test('idempotent replay creates zero new tasks and preserves the materialized identity', () => {
  const terminal = repair.indexOf("IF v_occ.outcome='materialized'");
  const processing = repair.indexOf('UPDATE public.recurring_task_occurrences AS occurrence', terminal);
  const replayAudit = repair.indexOf("'occurrence.idempotent_replay'", terminal);
  assert.ok(terminal >= 0 && replayAudit > terminal && replayAudit < processing);
  assert.doesNotMatch(repair.slice(terminal, processing), /create_recurring_canonical_task|v_created\s*:=/);
});

test('no eligible employee remains a controlled committed unresolved outcome', () => {
  assert.match(repair, /IF v_count=0 THEN[\s\S]*outcome='no_eligible_employee'/);
  assert.match(repair, /safe_failure_code='NO_ELIGIBLE_EMPLOYEE'/);
  assert.match(repair, /created_task_count=0/);
  assert.match(repair, /v_unresolved:=v_unresolved\+1/);
  assert.match(repair, /'recurring\.no_eligible_employee'/);
});

test('canonical UTC shift intervals are preferred while legacy local rows remain compatible', () => {
  assert.equal((repair.match(/v_due BETWEEN shift\.starts_at AND shift\.ends_at/g) ?? []).length, 2);
  assert.equal((repair.match(/v_rule\.location_id IS NULL OR shift\.location_id=v_rule\.location_id/g) ?? []).length, 2);
  assert.equal((repair.match(/shift\.starts_at IS NULL AND shift\.ends_at IS NULL/g) ?? []).length, 2);
  assert.equal((repair.match(/shift\.shift_date=v_local::date/g) ?? []).length, 2);
  assert.doesNotMatch(repair, /browser|Intl\.DateTimeFormat|new Date\(/i);
});

test('routine names pass through storage, service, and rendering without invented prefixes', () => {
  assert.match(recurringContracts, /name: text\(row\.name, 160, true\)!/);
  assert.match(recurringV1, /p_rule->>'name'/);
  assert.match(recurringService, /\.select\('id,company_id,location_id,name,/);
  assert.match(recurringUi, /<h2 className="truncate font-black" dir="auto">\{rule\.name\}<\/h2>/);
  assert.doesNotMatch(recurringUi, /(?:before:|after:)[^"']*(?:ud|content-)|["'`]ud\$?\{?rule\.name/i);
});

test('repair is forward-only, service-only, and creates no business rows by itself', () => {
  assert.match(repair, /^-- Recurring Task Engine V1 materialization repair\./);
  assert.match(repair, /\bBEGIN;/);
  assert.match(repair, /COMMIT;\s*$/);
  assert.equal((repair.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 2);
  assert.doesNotMatch(repair, /CREATE TABLE|ALTER TABLE|DROP TABLE|TRUNCATE/);
  assert.match(repair, /SECURITY DEFINER SET search_path TO ''/g);
  assert.match(repair, /REVOKE ALL ON FUNCTION public\.materialize_recurring_task_occurrences[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(repair, /GRANT EXECUTE ON FUNCTION public\.materialize_recurring_task_occurrences[\s\S]*TO service_role/);
  assert.doesNotMatch(repair, /'[0-9a-f]{8}-[0-9a-f-]{27}'/i);
});

test('the two applied migrations retain their canonical normalized hashes', () => {
  assert.equal(migrationSha256(recurringV1), '40ee9ae2470f62b03ef559f8e04b899b2aaed7656a3ae11cb6240390bdbeef2b');
  assert.equal(migrationSha256(shiftV1), '6244382ddf479bb57aa3d3db1f0cdb9697befaeaa10c6ad2950b6ac42fb52791');
});
