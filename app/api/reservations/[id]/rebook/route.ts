import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { isUuid } from '@/lib/reservations/contracts';
import {
  canManageReservations,
  normalizeReservationError,
  parseReservationRebook,
  rebookReservation,
} from '@/lib/reservations/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization',
};
const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: HEADERS });

function failure(error: unknown) {
  const code = error instanceof ActorContextError ? error.code : normalizeReservationError(error);
  const status = code === 'UNAUTHENTICATED' ? 401
    : code.includes('FORBIDDEN') ? 403
      : code === 'RESERVATION_NOT_FOUND' ? 404
        : ['RESERVATION_ALREADY_REBOOKED', 'RESERVATION_REBOOK_IDEMPOTENCY_CONFLICT'].includes(code) ? 409
          : code === 'RESERVATION_UNAVAILABLE' ? 503
            : 422;
  return fail(code, status);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) return fail('RESERVATION_REBOOK_INPUT_INVALID', 400);
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageReservations(actor.role)) return fail('RESERVATION_FORBIDDEN', 403);
    const input = parseReservationRebook(await request.json().catch(() => null));
    const data = await rebookReservation(
      authenticated,
      createSupabaseServer(),
      actor,
      id,
      input,
    );
    return NextResponse.json(
      { data },
      { status: data.replayed ? 200 : 201, headers: HEADERS },
    );
  } catch (error) {
    return failure(error);
  }
}
