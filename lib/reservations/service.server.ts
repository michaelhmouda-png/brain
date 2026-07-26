import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorContext } from '@/lib/brain/kernel/actor-context';
import { localDateTimeToInstant } from '@/lib/brain/tasks/batch/task-batch-time';
import {
  RESERVATION_PURPOSES,
  RESERVATION_SOURCES,
  RESERVATION_STATUSES,
  SEATING_PREFERENCES,
  isDate,
  isTime,
  isUuid,
  oneOf,
  type ManualReservationInput,
  type ReservationStatus,
} from './contracts.ts';
import { normalizePhone } from './phone.ts';

export const canManageReservations = (role: string) =>
  role === 'manager' || role === 'owner' || role === 'super_admin';

const bounded = (value: unknown, minimum: number, maximum: number, optional = false) => {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string') throw new Error('RESERVATION_INPUT_INVALID');
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) throw new Error('RESERVATION_INPUT_INVALID');
  return trimmed;
};

export function parseManualReservation(value: unknown): ManualReservationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RESERVATION_INPUT_INVALID');
  const row = value as Record<string, unknown>;
  const allowed = new Set(['firstName','lastName','countryCallingCode','phoneNumber','guestCount','purpose','purposeDetails','date','time','expectedDurationMinutes','notes','seatingPreference','source','locationId','waitlist','earliestTime','latestTime']);
  if (Object.keys(row).some((key) => !allowed.has(key))
      || !isUuid(row.locationId) || !isDate(row.date) || !isTime(row.time)
      || !Number.isInteger(row.guestCount) || Number(row.guestCount) < 1 || Number(row.guestCount) > 100
      || !Number.isInteger(row.expectedDurationMinutes) || Number(row.expectedDurationMinutes) < 15 || Number(row.expectedDurationMinutes) > 720
      || !oneOf(RESERVATION_PURPOSES, row.purpose) || !oneOf(SEATING_PREFERENCES, row.seatingPreference)
      || !oneOf(RESERVATION_SOURCES, row.source) || typeof row.waitlist !== 'boolean'
      || row.earliestTime !== undefined && !isTime(row.earliestTime)
      || row.latestTime !== undefined && !isTime(row.latestTime)) throw new Error('RESERVATION_INPUT_INVALID');
  const earliestTime = row.earliestTime as string | undefined;
  const latestTime = row.latestTime as string | undefined;
  if (earliestTime && latestTime && earliestTime > latestTime) throw new Error('RESERVATION_WAITLIST_WINDOW_INVALID');
  return {
    firstName: bounded(row.firstName, 1, 80)!,
    lastName: bounded(row.lastName, 1, 80)!,
    countryCallingCode: bounded(row.countryCallingCode, 2, 5)!,
    phoneNumber: bounded(row.phoneNumber, 4, 24)!,
    guestCount: Number(row.guestCount),
    purpose: row.purpose,
    purposeDetails: bounded(row.purposeDetails, 1, 500, true),
    date: row.date,
    time: row.time,
    expectedDurationMinutes: Number(row.expectedDurationMinutes),
    notes: bounded(row.notes, 1, 2000, true),
    seatingPreference: row.seatingPreference,
    source: row.source,
    locationId: row.locationId,
    waitlist: row.waitlist,
    earliestTime,
    latestTime,
  };
}

async function loadTimezone(authenticated: SupabaseClient, companyId: string, locationId: string) {
  const [{ data: company }, { data: location }] = await Promise.all([
    authenticated.from('companies').select('timezone').eq('id', companyId).single(),
    authenticated.from('locations').select('id,company_id,status,timezone').eq('id', locationId).eq('company_id', companyId).maybeSingle(),
  ]);
  if (!location || location.status !== 'active') throw new Error('RESERVATION_LOCATION_INVALID');
  const timezone = typeof location.timezone === 'string' && location.timezone || company?.timezone;
  if (typeof timezone !== 'string') throw new Error('RESERVATION_TIMEZONE_INVALID');
  return timezone;
}

export async function createManualReservation(
  authenticated: SupabaseClient,
  serviceRole: SupabaseClient,
  actor: ActorContext,
  input: ManualReservationInput,
) {
  if (!canManageReservations(actor.role)) throw new Error('RESERVATION_FORBIDDEN');
  const phone = normalizePhone(input.countryCallingCode, input.phoneNumber);
  const timezone = await loadTimezone(authenticated, actor.companyId, input.locationId);
  const startsAt = localDateTimeToInstant(`${input.date}T${input.time}`, timezone).dueAt;
  const expectedEndAt = new Date(Date.parse(startsAt) + input.expectedDurationMinutes * 60_000).toISOString();
  const { data, error } = await serviceRole.rpc('create_manual_reservation', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId, p_location_id: input.locationId,
    p_first_name: input.firstName, p_last_name: input.lastName,
    p_country_calling_code: phone.countryCallingCode, p_national_phone_number: phone.nationalPhoneNumber,
    p_phone_e164: phone.phoneE164, p_guest_count: input.guestCount, p_purpose: input.purpose,
    p_purpose_details: input.purposeDetails ?? null, p_reservation_date: input.date,
    p_reservation_time: input.time, p_starts_at: startsAt, p_expected_end_at: expectedEndAt,
    p_notes: input.notes ?? null, p_seating_preference: input.seatingPreference, p_source: input.source,
    p_waitlist: input.waitlist, p_earliest_time: input.earliestTime ?? null,
    p_latest_time: input.latestTime ?? null, p_correlation_id: actor.correlationId,
  });
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error('RESERVATION_CREATE_FAILED');
  return { ...data[0], phoneE164: phone.phoneE164, correlationId: actor.correlationId, availability: { state: 'unknown', reason: 'CAPACITY_RULES_NOT_CONFIGURED' } };
}

export async function transitionReservation(
  serviceRole: SupabaseClient,
  actor: ActorContext,
  reservationId: string,
  status: ReservationStatus,
  reason?: string,
) {
  if (!canManageReservations(actor.role) || !isUuid(reservationId) || !oneOf(RESERVATION_STATUSES, status)) throw new Error('RESERVATION_FORBIDDEN');
  const { data, error } = await serviceRole.rpc('transition_reservation_status', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId, p_reservation_id: reservationId,
    p_new_status: status, p_reason: reason?.trim().slice(0, 500) || null, p_correlation_id: actor.correlationId,
  });
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error('RESERVATION_TRANSITION_FAILED');
  return { ...data[0], correlationId: actor.correlationId };
}

export async function convertWaitlist(
  serviceRole: SupabaseClient, actor: ActorContext, waitlistId: string,
  startsAt: string, expectedEndAt: string, source: string,
) {
  if (!canManageReservations(actor.role) || !isUuid(waitlistId) || !oneOf(RESERVATION_SOURCES, source)
      || Number.isNaN(Date.parse(startsAt)) || Date.parse(expectedEndAt) <= Date.parse(startsAt)) {
    throw new Error('RESERVATION_WAITLIST_CONVERSION_INVALID');
  }
  const { data, error } = await serviceRole.rpc('convert_reservation_waitlist', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId, p_waitlist_id: waitlistId,
    p_starts_at: startsAt, p_expected_end_at: expectedEndAt, p_source: source, p_correlation_id: actor.correlationId,
  });
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error('RESERVATION_WAITLIST_CONVERSION_FAILED');
  return { ...data[0], correlationId: actor.correlationId };
}

export function normalizeReservationError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const allowed = ['RESERVATION_INPUT_INVALID','RESERVATION_PHONE_INVALID','RESERVATION_CALLING_CODE_INVALID','RESERVATION_WAITLIST_WINDOW_INVALID','RESERVATION_LOCATION_INVALID','RESERVATION_TIMEZONE_INVALID','RESERVATION_FORBIDDEN','RESERVATION_NOT_FOUND','RESERVATION_STATUS_TRANSITION_INVALID'];
  return allowed.find((code) => message.includes(code)) ?? 'RESERVATION_UNAVAILABLE';
}
