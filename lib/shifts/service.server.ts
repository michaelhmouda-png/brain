import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorContext } from '@/lib/brain/kernel/actor-context';
import { localDateTimeToInstant } from '@/lib/brain/tasks/batch/task-batch-time';
import {
  canManageShifts,
  nextLocalDate,
  parseCreateConcreteShift,
} from './contracts';

const SAFE_SHIFT_ERRORS = [
  'SHIFT_INPUT_INVALID',
  'SHIFT_FORBIDDEN',
  'SHIFT_EMPLOYEE_INVALID',
  'SHIFT_LOCATION_INVALID',
  'SHIFT_LOCAL_TIME_INVALID',
  'SHIFT_DUPLICATE',
  'SHIFT_CONFLICT',
] as const;

export function normalizeShiftCreationError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return SAFE_SHIFT_ERRORS.find((code) => message.includes(code)) ?? 'SHIFT_UNAVAILABLE';
}

export async function createConcreteShift(
  authenticated: SupabaseClient,
  service: SupabaseClient,
  actor: ActorContext,
  value: unknown,
) {
  if (!canManageShifts(actor.role)) throw new Error('SHIFT_FORBIDDEN');
  const input = parseCreateConcreteShift(value);

  const [{ data: employee, error: employeeError }, { data: location, error: locationError }] = await Promise.all([
    authenticated.from('employees')
      .select('id')
      .eq('id', input.employeeId)
      .eq('company_id', actor.companyId)
      .eq('status', 'active')
      .maybeSingle(),
    authenticated.from('locations')
      .select('id,timezone')
      .eq('id', input.locationId)
      .eq('company_id', actor.companyId)
      .eq('status', 'active')
      .maybeSingle(),
  ]);
  if (employeeError || !employee) throw new Error('SHIFT_EMPLOYEE_INVALID');
  if (locationError || !location || typeof location.timezone !== 'string') {
    throw new Error('SHIFT_LOCATION_INVALID');
  }

  let startsAt: string;
  let endsAt: string;
  try {
    startsAt = localDateTimeToInstant(`${input.date}T${input.startTime}`, location.timezone).dueAt;
    const endDate = input.endTime <= input.startTime ? nextLocalDate(input.date) : input.date;
    endsAt = localDateTimeToInstant(`${endDate}T${input.endTime}`, location.timezone).dueAt;
  } catch {
    throw new Error('SHIFT_LOCAL_TIME_INVALID');
  }

  const { data, error } = await service.rpc('create_concrete_shift', {
    p_actor_profile_id: actor.profileId,
    p_company_id: actor.companyId,
    p_employee_id: input.employeeId,
    p_location_id: input.locationId,
    p_shift_date: input.date,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_correlation_id: actor.correlationId,
  });
  if (error) throw new Error(normalizeShiftCreationError(new Error(error.message)));
  const shift = Array.isArray(data) ? data[0] : data;
  if (!shift) throw new Error('SHIFT_UNAVAILABLE');
  return {
    id: shift.id,
    employeeId: shift.employee_id,
    locationId: shift.location_id,
    date: shift.shift_date,
    startTime: String(shift.start_time).slice(0, 5),
    endTime: String(shift.end_time).slice(0, 5),
    startsAt: shift.starts_at,
    endsAt: shift.ends_at,
    status: shift.status,
    timezone: location.timezone,
  };
}
