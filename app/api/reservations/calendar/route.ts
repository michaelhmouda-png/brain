import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { RESERVATION_PURPOSES, RESERVATION_SOURCES, RESERVATION_STATUSES, isDate, isUuid, oneOf } from '@/lib/reservations/contracts';
import { maskPhone } from '@/lib/reservations/phone';
import { aggregateReservationMetrics, isUpcomingArrivalStatus } from '@/lib/reservations/metrics';
import { canManageReservations } from '@/lib/reservations/service.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };
const venueNow = (timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}`,
  };
};
export async function GET(request: Request) {
  try {
    const client = await createSupabaseServerAuth(); const actor = await resolveActorContext(client);
    if (!canManageReservations(actor.role)) return NextResponse.json({ error: 'RESERVATION_FORBIDDEN' }, { status: 403, headers: HEADERS });
    const p = new URL(request.url).searchParams; const locationId = p.get('locationId'); const from = p.get('from'); const to = p.get('to'); const view = p.get('view');
    const status = p.get('status'); const source = p.get('source'); const purpose = p.get('purpose');
    if (!isUuid(locationId) || !isDate(from) || !isDate(to) || !['day','week','month'].includes(view ?? '') || from > to
      || status && !oneOf(RESERVATION_STATUSES, status) || source && !oneOf(RESERVATION_SOURCES, source) || purpose && !oneOf(RESERVATION_PURPOSES, purpose)) return NextResponse.json({ error: 'RESERVATION_INPUT_INVALID' }, { status: 400, headers: HEADERS });
    let query = client.from('reservations').select('id,reservation_date,reservation_time,guest_count,purpose,status,source,seating_preference,notes,guest:reservation_guests(first_name,last_name,phone_e164),creator:profiles!reservations_created_by_fkey(full_name)').eq('company_id', actor.companyId).eq('location_id', locationId).gte('reservation_date', from).lte('reservation_date', to);
    if (status) query = query.eq('status', status); if (source) query = query.eq('source', source); if (purpose) query = query.eq('purpose', purpose);
    const [{ data, error }, { data: waiting, error: waitingError }, { data: location }] = await Promise.all([query.order('reservation_date').order('reservation_time'), client.from('reservation_waitlist_entries').select('id,requested_date,preferred_time,guest_count,purpose,status,seating_preference').eq('company_id', actor.companyId).eq('location_id', locationId).gte('requested_date', from).lte('requested_date', to), client.from('locations').select('timezone').eq('id', locationId).eq('company_id', actor.companyId).single()]);
    if (error || waitingError || !location) throw new Error();
    const reservations = (data ?? []).map((row: Record<string, unknown>) => {
      const guest = row.guest as unknown as { first_name?: string; last_name?: string; phone_e164?: string } | null;
      return {
        id: String(row.id),
        reservation_date: String(row.reservation_date),
        reservation_time: String(row.reservation_time),
        guest_count: Number(row.guest_count),
        purpose: String(row.purpose),
        status: String(row.status),
        source: String(row.source),
        seating_preference: String(row.seating_preference),
        guest: guest ? { name: `${guest.first_name ?? ''} ${guest.last_name ?? ''}`.trim(), phone: maskPhone(guest.phone_e164 ?? '') } : null,
        hasNotes: Boolean(row.notes),
      };
    });
    const summary = aggregateReservationMetrics(
      (data ?? []).map((row) => ({ guest_count: row.guest_count, status: row.status })),
      waiting ?? [],
    );
    const currentAtVenue = venueNow(location.timezone);
    const nextArrival = reservations.find((row) =>
      isUpcomingArrivalStatus(String(row.status))
      && (row.reservation_date > currentAtVenue.date
        || row.reservation_date === currentAtVenue.date
          && String(row.reservation_time).slice(0, 5) >= currentAtVenue.time),
    );
    return NextResponse.json({
      data: {
        view,
        from,
        to,
        timezone: location.timezone,
        reservations,
        waitlist: waiting ?? [],
        summary,
        nextArrival: nextArrival
          ? {
              id: nextArrival.id,
              time: String(nextArrival.reservation_time).slice(0, 5),
              guestName: nextArrival.guest?.name ?? 'Guest',
              guestCount: nextArrival.guest_count,
            }
          : null,
      },
    }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof ActorContextError) {
      return NextResponse.json(
        { error: error.code },
        { status: error.code === 'UNAUTHENTICATED' ? 401 : 403, headers: HEADERS },
      );
    }
    return NextResponse.json({ error: 'RESERVATION_UNAVAILABLE' }, { status: 503, headers: HEADERS });
  }
}
