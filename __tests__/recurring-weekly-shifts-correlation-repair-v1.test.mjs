import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const repair=read('supabase/migrations/202608030002_fix_weekly_shift_correlation_v1.sql');
const applied=read('supabase/migrations/202608030001_recurring_weekly_shifts_v1.sql');

test('repair is forward-only and replaces only the two affected functions',()=>{
  assert.match(repair,/^-- Recurring Weekly Shifts V1 correlation repair\./);
  assert.equal((repair.match(/CREATE OR REPLACE FUNCTION/g)??[]).length,2);
  assert.match(repair,/public\.confirm_weekly_shift_schedule_v1/);
  assert.match(repair,/public\.materialize_weekly_shift_schedules_v1/);
  assert.doesNotMatch(repair,/\b(?:INSERT|UPDATE|DELETE)\s+public\.shifts\b/i);
  assert.match(repair,/BEGIN;[\s\S]*COMMIT;\s*$/);
});

test('confirmation supplies a non-null deterministic provenance correlation for every preview row',()=>{
  const confirmation=repair.slice(repair.indexOf('CREATE OR REPLACE FUNCTION public.confirm_weekly_shift_schedule_v1'),repair.indexOf('CREATE OR REPLACE FUNCTION public.materialize_weekly_shift_schedules_v1'));
  assert.match(confirmation,/FOR v_row IN SELECT value FROM jsonb_array_elements\(v_preview->'rows'\)/);
  assert.match(confirmation,/v_correlation_id:=md5\('weekly-shift-v1:'\|\|v_series\.id::text\|\|':1:'\|\|v_employee_id::text\|\|':'\|\|\(v_row->>'date'\)\)::uuid/);
  assert.match(confirmation,/public\.create_concrete_shift\([\s\S]*v_correlation_id\) created/);
  assert.doesNotMatch(confirmation,/public\.create_concrete_shift\([\s\S]*,NULL\) created/);
  assert.match(confirmation,/v_count:=v_count\+1/);
  assert.match(confirmation,/'shiftsCreated',v_count/);
});

test('worker correlation is stable across retries and includes complete canonical provenance',()=>{
  const worker=repair.slice(repair.indexOf('CREATE OR REPLACE FUNCTION public.materialize_weekly_shift_schedules_v1'));
  assert.match(worker,/v_correlation_id:=md5\('weekly-shift-v1:'\|\|v_series\.id::text\|\|':'\|\|v_version\.version::text\|\|':'\|\|v_series\.employee_id::text\|\|':'\|\|v_date::text\)::uuid/);
  assert.match(worker,/public\.create_concrete_shift\([\s\S]*v_correlation_id\) created/);
  assert.doesNotMatch(worker,/gen_random_uuid\(\)|random\(\)/);
});

test('idempotent provenance and concrete protections prevent retry duplicates',()=>{
  assert.match(repair,/NOT EXISTS\(SELECT 1 FROM public\.weekly_shift_generated_shifts generated WHERE generated\.series_id=v_series\.id AND generated\.version=v_version\.version AND generated\.local_date=v_date\)/);
  assert.match(repair,/INSERT INTO public\.weekly_shift_generated_shifts/);
  assert.match(repair,/public\.create_concrete_shift/);
  assert.match(repair,/pg_advisory_xact_lock/);
});

test('atomicity DST exceptions authorization and 42-day behavior remain intact',()=>{
  for(const fragment of ["private.weekly_shift_preview","WEEKLY_SHIFT_STALE_PREVIEW","private.strict_local_to_utc","day_off','approved_leave","p_horizon_days integer DEFAULT 42","location.company_id=v_series.company_id","employee.company_id=v_series.company_id","SECURITY DEFINER SET search_path=''","TO service_role"])assert.ok(repair.includes(fragment),fragment);
});

test('already-applied 202608030001 remains byte-for-byte unchanged',()=>{
  assert.equal(createHash('sha256').update(applied).digest('hex'),'fb42fca9bb3e3739254ef67e7998509d2fc39186a9966ecf081b182f0ab43d1c');
});
