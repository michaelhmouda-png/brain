import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { getWorkerHealth } from '@/lib/worker-health.server';

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };

export async function GET() {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    return NextResponse.json({ data: await getWorkerHealth(actor) }, { headers: HEADERS });
  } catch (error) {
    const code = error instanceof ActorContextError
      ? error.code
      : error instanceof Error && error.message === 'WORKER_HEALTH_FORBIDDEN'
        ? error.message
        : 'WORKER_HEALTH_UNAVAILABLE';
    const status = code === 'UNAUTHENTICATED' ? 401 : code.endsWith('FORBIDDEN') || code === 'ACCOUNT_INACTIVE' ? 403 : 503;
    return NextResponse.json({ error: code }, { status, headers: HEADERS });
  }
}
