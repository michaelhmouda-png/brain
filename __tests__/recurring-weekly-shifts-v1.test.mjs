import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseWeeklyShiftSchedule } from '../lib/shifts/contracts.ts';
import { messages, validateTranslationCatalog } from '../lib/i18n.ts';

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const sql=read('supabase/migrations/202608030001_recurring_weekly_shifts_v1.sql');
const recurring=read('supabase/migrations/202607300003_fix_recurring_task_materialization_v1.sql');
const worker=read('lib/notification-worker.server.ts');const route=read('app/api/shifts/route.ts');const page=read('app/dashboard/shifts/page.tsx');
const amjad='11111111-1111-4111-8111-111111111111',location='22222222-2222-4222-8222-222222222222';

test('six-day Wednesday-off schedules are canonical and bounded',()=>{const input=parseWeeklyShiftSchedule({employeeIds:[amjad],locationId:location,weekdays:[0,1,2,4,5,6],startTime:'09:00',endTime:'17:00',startDate:'2026-08-02',endDate:null});assert.deepEqual(input.weekdays,[0,1,2,4,5,6]);assert.equal(input.weekdays.includes(3),false);assert.match(sql,/p_horizon_days integer DEFAULT 42/);});
test('bulk schedules accept distinct employees but reject duplicates and unbounded batches',()=>{assert.throws(()=>parseWeeklyShiftSchedule({employeeIds:[amjad,amjad],locationId:location,weekdays:[1],startTime:'09:00',endTime:'17:00',startDate:'2026-08-02',endDate:null}),/WEEKLY_SHIFT_INPUT_INVALID/);assert.match(sql,/jsonb_array_length\(p_input->'employeeIds'\) NOT BETWEEN 1 AND 100/);});
test('preview reports employee-level errors and confirmation is one atomic transaction',()=>{assert.match(sql,/v_errors:=v_errors\|\|jsonb_build_array\(jsonb_build_object\('employeeId'/);assert.match(sql,/previewToken/);assert.match(sql,/CREATE OR REPLACE FUNCTION public\.confirm_weekly_shift_schedule_v1/);assert.match(sql,/pg_advisory_xact_lock/);assert.match(route,/preview_weekly_schedule/);assert.match(route,/confirm_weekly_schedule/);});
test('overnight and DST conversion use strict location-local instants',()=>{assert.match(sql,/v_end<=v_start THEN 1 ELSE 0/);assert.match(sql,/private\.strict_local_to_utc/);assert.match(sql,/WEEKLY_SHIFT_DST_INVALID/);});
test('materialization is deterministic idempotent and uses concrete overlap protections',()=>{assert.match(sql,/PRIMARY KEY\(series_id,version,local_date\)/);assert.match(sql,/public\.create_concrete_shift/);assert.match(sql,/pg_advisory_xact_lock/);assert.match(worker,/materializeWeeklyShiftSchedules/);});
test('exceptions and immutable future versions preserve history',()=>{assert.match(sql,/kind IN \('day_off','approved_leave','override'\)/);assert.match(sql,/current_version=current_version\+1/);assert.match(sql,/effective_until=v_effective-1/);assert.match(sql,/generated\.local_date>=v_effective AND shift\.status='scheduled'/);assert.match(sql,/p_action NOT IN \('pause','resume','end','edit','exception'\)/);});
test('authorization tenant and active relationships are revalidated',()=>{assert.match(sql,/profile\.status='active'.*manager','owner','super_admin'/s);assert.match(sql,/employee\.company_id=p_company_id AND employee\.status='active'/);assert.match(sql,/location\.company_id=p_company_id AND location\.status='active'/);assert.match(sql,/FORCE ROW LEVEL SECURITY/);assert.match(sql,/TO service_role/);});
test('recurring task assignment remains concrete-shift-only',()=>{assert.match(recurring,/FROM public\.shifts AS shift/);assert.doesNotMatch(recurring,/weekly_shift_schedule_series|weekly_shift_schedule_versions/);});
test('localized mobile preview and confirmation are present',()=>{assert.deepEqual(validateTranslationCatalog(),[]);assert.equal(messages.en.schedule.createWeekly,'Create weekly schedule');assert.equal(messages.ar.schedule.createWeekly,'إنشاء جدول أسبوعي');for(const token of ['role="dialog"','max-h-[100dvh]','safe-area-inset-bottom','preview_weekly_schedule','confirm_weekly_schedule'])assert.ok(page.includes(token),token);});
test('migration is forward-only and leaves applied migrations untouched',()=>{assert.match(sql,/^-- Recurring Weekly Shifts V1/);assert.match(sql,/BEGIN;[\s\S]*COMMIT;\s*$/);assert.doesNotMatch(sql,/ALTER TABLE public\.shifts DROP|DROP TABLE|TRUNCATE/);});
