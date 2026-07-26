import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { isDate, isUuid } from '@/lib/reservations/contracts';
import { comparableWeekdayLastYear } from '@/lib/reservations/history';
import { queryHistoricalMetrics } from '@/lib/reservations/history.server';
import { canManageReservations } from '@/lib/reservations/service.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET(request: Request) {
  try {
    const client = await createSupabaseServerAuth(); const actor = await resolveActorContext(client);
    if (!canManageReservations(actor.role)) return NextResponse.json({ error: 'RESERVATION_FORBIDDEN' }, { status: 403, headers: HEADERS });
    const params = new URL(request.url).searchParams; const locationId = params.get('locationId'); const date = params.get('date');
    if (!isUuid(locationId) || !isDate(date)) return NextResponse.json({ error: 'RESERVATION_INPUT_INVALID' }, { status: 400, headers: HEADERS });
    const comparableDate = comparableWeekdayLastYear(date);
    const [current, comparable] = await Promise.all([
      queryHistoricalMetrics(client, actor.companyId, locationId, date, date),
      queryHistoricalMetrics(client, actor.companyId, locationId, comparableDate, comparableDate),
    ]);
    return NextResponse.json({ data: { date, comparableDate, current, comparable, sufficientHistoricalData: comparable.reservationCount > 0 } }, { headers: HEADERS });
  } catch { return NextResponse.json({ error: 'RESERVATION_HISTORY_UNAVAILABLE' }, { status: 503, headers: HEADERS }); }
}
