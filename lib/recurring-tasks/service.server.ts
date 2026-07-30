import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorContext } from '@/lib/brain/kernel/actor-context';
import { canManageRecurringTasks, parseRecurringTaskRule, type RecurringTaskRuleInput } from './contracts';

export function normalizeRecurringTaskError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return [
    'RECURRING_RULE_INVALID', 'RECURRING_TIMEZONE_INVALID', 'RECURRING_FORBIDDEN',
    'RECURRING_LOCATION_INVALID', 'RECURRING_DEPARTMENT_INVALID', 'RECURRING_EMPLOYEE_INVALID',
    'RECURRING_OPERATING_HOURS_REQUIRED', 'RECURRING_RULE_NOT_FOUND',
    'RECURRING_RULE_STATE_INVALID', 'RECURRING_VERSION_CONFLICT',
  ].find((code) => message.includes(code)) ?? 'RECURRING_UNAVAILABLE';
}

function assertManager(actor: ActorContext) {
  if (!canManageRecurringTasks(actor.role)) throw new Error('RECURRING_FORBIDDEN');
}

export async function listRecurringRules(authenticated: SupabaseClient, actor: ActorContext) {
  assertManager(actor);
  const { data, error } = await authenticated
    .from('recurring_task_rules')
    .select('id,company_id,location_id,name,description,status,timezone,current_version,next_occurrence_at,created_at,updated_at,recurring_task_rule_versions(version,recurrence,time_anchor,task_template,workforce,assignment_mode,reminder_offsets_minutes,start_date,end_date),locations(name)')
    .eq('company_id', actor.companyId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error('RECURRING_UNAVAILABLE');
  return data ?? [];
}

export async function listRecurringOutcomes(authenticated: SupabaseClient, actor: ActorContext, ruleId?: string) {
  assertManager(actor);
  let query = authenticated.from('recurring_task_occurrences')
    .select('id,rule_id,rule_version,local_occurrence_at,due_at,outcome,eligible_count,created_task_count,safe_failure_code,created_at,completed_at')
    .eq('company_id', actor.companyId).order('created_at', { ascending: false }).limit(100);
  if (ruleId) query = query.eq('rule_id', ruleId);
  const { data, error } = await query;
  if (error) throw new Error('RECURRING_UNAVAILABLE');
  return data ?? [];
}

async function manage(
  service: SupabaseClient,
  actor: ActorContext,
  action: 'create'|'version'|'pause'|'resume'|'end',
  ruleId: string | null,
  expectedVersion: number | null,
  input: RecurringTaskRuleInput | null,
) {
  assertManager(actor);
  const { data, error } = await service.rpc('manage_recurring_task_rule', {
    p_actor_profile_id: actor.profileId,
    p_company_id: actor.companyId,
    p_action: action,
    p_rule_id: ruleId,
    p_expected_version: expectedVersion,
    p_rule: input,
    p_correlation_id: actor.correlationId,
  });
  if (error) throw new Error(normalizeRecurringTaskError(new Error(error.message)));
  return Array.isArray(data) ? data[0] : data;
}

export async function createRecurringRule(service: SupabaseClient, actor: ActorContext, value: unknown) {
  return manage(service, actor, 'create', null, null, parseRecurringTaskRule(value));
}

export async function changeRecurringRule(
  service: SupabaseClient,
  actor: ActorContext,
  ruleId: string,
  value: { action: 'version'|'pause'|'resume'|'end'; expectedVersion: number; rule?: unknown },
) {
  if (!/^[0-9a-f-]{36}$/i.test(ruleId) || !Number.isInteger(value.expectedVersion) || value.expectedVersion < 1) {
    throw new Error('RECURRING_RULE_INVALID');
  }
  return manage(service, actor, value.action, ruleId, value.expectedVersion,
    value.action === 'version' ? parseRecurringTaskRule(value.rule) : null);
}

export async function previewRecurringRule(
  service: SupabaseClient,
  actor: ActorContext,
  value: unknown,
) {
  assertManager(actor);
  const input = parseRecurringTaskRule(value);
  const { data, error } = await service.rpc('preview_recurring_task_rule', {
    p_actor_profile_id: actor.profileId,
    p_company_id: actor.companyId,
    p_rule: input,
    p_limit: 8,
  });
  if (error) throw new Error(normalizeRecurringTaskError(new Error(error.message)));
  return data ?? [];
}

export async function processRecurringTaskWork(service: SupabaseClient) {
  const reminders = await service.rpc('generate_recurring_task_reminder_obligations', { p_batch_limit: 100 });
  if (reminders.error) throw new Error('RECURRING_REMINDER_GENERATION_FAILED');
  const occurrences = await service.rpc('materialize_recurring_task_occurrences', {
    p_batch_limit: 10,
    p_horizon_hours: 24,
    p_lease_seconds: 120,
  });
  if (occurrences.error) throw new Error('RECURRING_MATERIALIZATION_FAILED');
  return { reminders: reminders.data, occurrences: occurrences.data };
}

export async function configureLocationOperatingHours(
  service: SupabaseClient,
  actor: ActorContext,
  value: unknown,
) {
  assertManager(actor);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RECURRING_RULE_INVALID');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !['locationId','days'].includes(key))
      || typeof row.locationId !== 'string' || !Array.isArray(row.days) || row.days.length !== 7) {
    throw new Error('RECURRING_RULE_INVALID');
  }
  const seen = new Set<number>();
  const days = row.days.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('RECURRING_RULE_INVALID');
    const day = entry as Record<string, unknown>;
    if (Object.keys(day).some((key) => !['weekday','isClosed','opensAt','closesAt'].includes(key))
        || !Number.isInteger(day.weekday) || Number(day.weekday) < 0 || Number(day.weekday) > 6
        || seen.has(Number(day.weekday)) || typeof day.isClosed !== 'boolean') throw new Error('RECURRING_RULE_INVALID');
    seen.add(Number(day.weekday));
    const time = (field: 'opensAt'|'closesAt') => {
      const candidate = day[field];
      if (day.isClosed) return null;
      if (typeof candidate !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate)) {
        throw new Error('RECURRING_RULE_INVALID');
      }
      return candidate;
    };
    return { weekday: Number(day.weekday), isClosed: day.isClosed, opensAt: time('opensAt'), closesAt: time('closesAt') };
  });
  const { data, error } = await service.rpc('configure_location_operating_hours', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId,
    p_location_id: row.locationId, p_days: days, p_correlation_id: actor.correlationId,
  });
  if (error) throw new Error(normalizeRecurringTaskError(new Error(error.message)));
  return data;
}
