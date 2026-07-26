import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { RESERVATION_STATUSES, isUuid, oneOf } from '@/lib/reservations/contracts';
import { canManageReservations, normalizeReservationError, transitionReservation } from '@/lib/reservations/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const body: unknown = await request.json().catch(() => null);
    if (!isUuid(id) || !body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'RESERVATION_INPUT_INVALID' }, { status: 400, headers: HEADERS });
    const row = body as Record<string, unknown>; if (!oneOf(RESERVATION_STATUSES, row.status) || row.reason !== undefined && typeof row.reason !== 'string') return NextResponse.json({ error: 'RESERVATION_INPUT_INVALID' }, { status: 400, headers: HEADERS });
    const authenticated = await createSupabaseServerAuth(); const actor = await resolveActorContext(authenticated);
    if (!canManageReservations(actor.role)) return NextResponse.json({ error: 'RESERVATION_FORBIDDEN' }, { status: 403, headers: HEADERS });
    const data = await transitionReservation(createSupabaseServer(), actor, id, row.status, row.reason as string | undefined);
    return NextResponse.json({ data }, { headers: HEADERS });
  } catch (error) {
    const code = error instanceof ActorContextError ? error.code : normalizeReservationError(error);
    return NextResponse.json({ error: code }, { status: code === 'UNAUTHENTICATED' ? 401 : code.includes('FORBIDDEN') ? 403 : 422, headers: HEADERS });
  }
}
