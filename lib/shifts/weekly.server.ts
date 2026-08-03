import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorContext } from '@/lib/brain/kernel/actor-context';
import { canManageShifts, parseWeeklyShiftSchedule } from './contracts';

const SAFE = ['WEEKLY_SHIFT_INPUT_INVALID', 'WEEKLY_SHIFT_FORBIDDEN', 'WEEKLY_SHIFT_EMPLOYEE_INVALID',
  'WEEKLY_SHIFT_LOCATION_INVALID', 'WEEKLY_SHIFT_DST_INVALID', 'WEEKLY_SHIFT_DUPLICATE',
  'WEEKLY_SHIFT_CONFLICT', 'WEEKLY_SHIFT_STALE_PREVIEW', 'WEEKLY_SHIFT_FUTURE_ONLY', 'WEEKLY_SHIFT_SERIES_INVALID'] as const;

export function normalizeWeeklyShiftError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return SAFE.find((code) => message.includes(code)) ?? 'WEEKLY_SHIFT_UNAVAILABLE';
}

export async function previewWeeklyShiftSchedule(service: SupabaseClient, actor: ActorContext, value: unknown) {
  if (!canManageShifts(actor.role)) throw new Error('WEEKLY_SHIFT_FORBIDDEN');
  const input = parseWeeklyShiftSchedule(value);
  const { data, error } = await service.rpc('preview_weekly_shift_schedule_v1', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId, p_input: input,
  });
  if (error) throw new Error(normalizeWeeklyShiftError(new Error(error.message)));
  return data;
}

export async function confirmWeeklyShiftSchedule(service: SupabaseClient, actor: ActorContext, value: unknown, previewToken: unknown) {
  if (!canManageShifts(actor.role)) throw new Error('WEEKLY_SHIFT_FORBIDDEN');
  const input = parseWeeklyShiftSchedule(value);
  if (typeof previewToken !== 'string' || !/^[0-9a-f]{64}$/.test(previewToken)) throw new Error('WEEKLY_SHIFT_STALE_PREVIEW');
  const { data, error } = await service.rpc('confirm_weekly_shift_schedule_v1', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId, p_input: input, p_preview_token: previewToken,
  });
  if (error) throw new Error(normalizeWeeklyShiftError(new Error(error.message)));
  return data;
}

export async function materializeWeeklyShiftSchedules(service: SupabaseClient) {
  const { data, error } = await service.rpc('materialize_weekly_shift_schedules_v1', { p_batch_limit: 25, p_horizon_days: 42 });
  if (error) throw new Error('WEEKLY_SHIFT_MATERIALIZATION_FAILED');
  return data;
}

export async function manageWeeklyShiftSchedules(service: SupabaseClient, actor: ActorContext, action: unknown, seriesIds: unknown, input: unknown) {
  if (!canManageShifts(actor.role)) throw new Error('WEEKLY_SHIFT_FORBIDDEN');
  if (typeof action !== 'string' || !['pause','resume','end','edit','exception'].includes(action)
      || !Array.isArray(seriesIds) || seriesIds.length < 1 || seriesIds.length > 100
      || seriesIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))
      || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('WEEKLY_SHIFT_INPUT_INVALID');
  const { data, error } = await service.rpc('manage_weekly_shift_schedules_v1', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId, p_action: action,
    p_series_ids: seriesIds, p_input: input,
  });
  if (error) throw new Error(normalizeWeeklyShiftError(new Error(error.message)));
  return data;
}
