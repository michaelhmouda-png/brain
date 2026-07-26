import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { RESERVATION_PURPOSES, RESERVATION_SOURCES, RESERVATION_STATUSES, isDate, isUuid, oneOf } from '@/lib/reservations/contracts';
import { canManageReservations, createManualReservation, normalizeReservationError, parseManualReservation } from '@/lib/reservations/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: HEADERS });

function actorError(error: unknown) {
  if (error instanceof ActorContextError) return fail(error.code, error.code === 'UNAUTHENTICATED' ? 401 : 403);
  const code = normalizeReservationError(error);
  return fail(code, code === 'RESERVATION_FORBIDDEN' ? 403 : code === 'RESERVATION_UNAVAILABLE' ? 503 : 400);
}

export async function POST(request: Request) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageReservations(actor.role)) return fail('RESERVATION_FORBIDDEN', 403);
    const input = parseManualReservation(await request.json().catch(() => null));
    const result = await createManualReservation(authenticated, createSupabaseServer(), actor, input);
    return NextResponse.json({ data: result }, { status: 201, headers: HEADERS });
  } catch (error) { return actorError(error); }
}

export async function GET(request: Request) {
  try {
    const client = await createSupabaseServerAuth(); const actor = await resolveActorContext(client);
    if (!canManageReservations(actor.role)) return fail('RESERVATION_FORBIDDEN', 403);
    const params = new URL(request.url).searchParams;
    const allowed = new Set(['date','locationId','status','phone','guestName','source','purpose','page','limit']);
    if ([...params.keys()].some((key) => !allowed.has(key))) return fail('RESERVATION_INPUT_INVALID', 400);
    const date = params.get('date'); const locationId = params.get('locationId'); const status = params.get('status');
    const source = params.get('source'); const purpose = params.get('purpose');
    const page = Number(params.get('page') ?? '1'); const limit = Number(params.get('limit') ?? '50');
    if (date && !isDate(date) || locationId && !isUuid(locationId) || status && !oneOf(RESERVATION_STATUSES, status)
      || source && !oneOf(RESERVATION_SOURCES, source) || purpose && !oneOf(RESERVATION_PURPOSES, purpose)
      || !Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return fail('RESERVATION_INPUT_INVALID', 400);
    let query = client.from('reservations').select('id,location_id,guest_id,reservation_date,reservation_time,starts_at,expected_end_at,guest_count,purpose,purpose_details,seating_preference,status,source,notes,created_at,guest:reservation_guests(id,first_name,last_name,phone_e164),creator:profiles!reservations_created_by_fkey(full_name)', { count: 'exact' }).eq('company_id', actor.companyId);
    if (date) query = query.eq('reservation_date', date); if (locationId) query = query.eq('location_id', locationId);
    if (status) query = query.eq('status', status); if (source) query = query.eq('source', source); if (purpose) query = query.eq('purpose', purpose);
    const phone = params.get('phone')?.trim(); if (phone) query = query.eq('reservation_guests.phone_e164', phone);
    const guestName = params.get('guestName')?.trim(); if (guestName) query = query.or(`first_name.ilike.%${guestName.replace(/[%_,()]/g, '')}%,last_name.ilike.%${guestName.replace(/[%_,()]/g, '')}%`, { referencedTable: 'reservation_guests' });
    const { data, error, count } = await query.order('starts_at').range((page - 1) * limit, page * limit - 1);
    if (error) throw new Error('RESERVATION_UNAVAILABLE');
    return NextResponse.json({ data: { reservations: data ?? [], page, limit, total: count ?? 0 } }, { headers: HEADERS });
  } catch (error) { return actorError(error); }
}
