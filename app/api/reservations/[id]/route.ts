import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { isUuid } from '@/lib/reservations/contracts';
import {
  canManageReservations,
  normalizeReservationError,
  parseReservationUpdate,
  updateReservation,
} from '@/lib/reservations/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: HEADERS });
const failure = (error: unknown) => {
  const code = error instanceof ActorContextError ? error.code : normalizeReservationError(error);
  return fail(
    code,
    code === 'UNAUTHENTICATED' ? 401
      : code.includes('FORBIDDEN') ? 403
        : code === 'RESERVATION_NOT_FOUND' ? 404
          : code === 'RESERVATION_UNAVAILABLE' ? 503
            : 422,
  );
};
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; if (!isUuid(id)) return fail('RESERVATION_INPUT_INVALID', 400);
    const client = await createSupabaseServerAuth(); const actor = await resolveActorContext(client);
    if (!canManageReservations(actor.role)) return fail('RESERVATION_FORBIDDEN', 403);
    const { data, error } = await client.from('reservations').select('*,guest:reservation_guests(id,first_name,last_name,phone_e164,preferred_language,marketing_consent),history:reservation_status_history(id,previous_status,new_status,reason,changed_at)').eq('id', id).eq('company_id', actor.companyId).maybeSingle();
    if (error) return fail('RESERVATION_UNAVAILABLE', 503);
    if (!data) return fail('RESERVATION_NOT_FOUND', 404);
    return NextResponse.json({ data }, { headers: HEADERS });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) return fail('RESERVATION_INPUT_INVALID', 400);
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageReservations(actor.role)) return fail('RESERVATION_FORBIDDEN', 403);
    const input = parseReservationUpdate(await request.json().catch(() => null));
    const data = await updateReservation(authenticated, createSupabaseServer(), actor, id, input);
    return NextResponse.json({ data }, { headers: HEADERS });
  } catch (error) {
    return failure(error);
  }
}
