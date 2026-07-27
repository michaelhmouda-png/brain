import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { aggregateReservationMetrics } from './metrics.ts';
export { aggregateCalendar, comparableWeekdayLastYear, sameDateLastYear } from './history.ts';

export type HistoricalMetrics = {
  reservationCount: number;
  expectedGuestCount: number;
  seatedGuestCount: number;
  cancellationCount: number;
  cancellationRate: number;
  noShowCount: number;
  noShowRate: number;
  waitlistCount: number;
  waitlistConversionRate: number;
  averagePartySize: number;
  sourceDistribution: Record<string, number>;
  purposeDistribution: Record<string, number>;
  hourlyDistribution: Record<string, number>;
};

const increment = (target: Record<string, number>, key: string) => { target[key] = (target[key] ?? 0) + 1; };

export async function queryHistoricalMetrics(client: SupabaseClient, companyId: string, locationId: string, from: string, to: string): Promise<HistoricalMetrics> {
  const [{ data: reservations, error }, { data: waitlist, error: waitlistError }] = await Promise.all([
    client.from('reservations').select('guest_count,status,source,purpose,reservation_time').eq('company_id', companyId).eq('location_id', locationId).gte('reservation_date', from).lte('reservation_date', to),
    client.from('reservation_waitlist_entries').select('status,guest_count').eq('company_id', companyId).eq('location_id', locationId).gte('requested_date', from).lte('requested_date', to),
  ]);
  if (error || waitlistError) throw new Error('RESERVATION_HISTORY_UNAVAILABLE');
  const rows = reservations ?? []; const waiting = waitlist ?? [];
  const daily = aggregateReservationMetrics(rows, waiting);
  const cancellationCount = rows.filter((row) => row.status === 'cancelled').length;
  const noShowCount = rows.filter((row) => row.status === 'no_show').length;
  const sourceDistribution: Record<string, number> = {}; const purposeDistribution: Record<string, number> = {}; const hourlyDistribution: Record<string, number> = {};
  rows.forEach((row) => { increment(sourceDistribution, row.source); increment(purposeDistribution, row.purpose); increment(hourlyDistribution, String(row.reservation_time).slice(0, 2)); });
  return {
    reservationCount: daily.activeReservations, expectedGuestCount: daily.expectedGuests,
    seatedGuestCount: rows.filter((row) => ['seated','completed'].includes(row.status)).reduce((sum, row) => sum + row.guest_count, 0),
    cancellationCount, cancellationRate: rows.length ? cancellationCount / rows.length : 0,
    noShowCount, noShowRate: rows.length ? noShowCount / rows.length : 0,
    waitlistCount: waiting.length, waitlistConversionRate: waiting.length ? waiting.filter((row) => row.status === 'converted').length / waiting.length : 0,
    averagePartySize: rows.length ? rows.reduce((sum, row) => sum + row.guest_count, 0) / rows.length : 0,
    sourceDistribution, purposeDistribution, hourlyDistribution,
  };
}

export async function queryGuestVisitHistory(client: SupabaseClient, companyId: string, guestId: string) {
  const { data, error } = await client.from('reservations')
    .select('id,reservation_date,reservation_time,guest_count,purpose,seating_preference,status,source')
    .eq('company_id', companyId).eq('guest_id', guestId).order('starts_at', { ascending: false }).limit(50);
  if (error) throw new Error('RESERVATION_HISTORY_UNAVAILABLE');
  const rows = data ?? []; const completed = rows.filter((row) => row.status === 'completed');
  const frequencies = (field: 'purpose' | 'seating_preference') => rows.reduce<Record<string, number>>((result, row) => {
    result[row[field]] = (result[row[field]] ?? 0) + 1; return result;
  }, {});
  const mostCommon = (values: Record<string, number>) => Object.entries(values).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    totalReservations: rows.length, completedVisits: completed.length,
    cancellations: rows.filter((row) => row.status === 'cancelled').length,
    noShows: rows.filter((row) => row.status === 'no_show').length,
    lastReservation: rows[0] ?? null, lastCompletedVisit: completed[0] ?? null,
    averagePartySize: rows.length ? rows.reduce((sum, row) => sum + row.guest_count, 0) / rows.length : 0,
    commonPurpose: mostCommon(frequencies('purpose')), preferredSeating: mostCommon(frequencies('seating_preference')),
    recentReservations: rows.slice(0, 10),
  };
}
