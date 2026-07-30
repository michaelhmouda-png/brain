import { NextResponse } from 'next/server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { canManageRecurringTasks } from '@/lib/recurring-tasks/contracts';
import { changeRecurringRule, normalizeRecurringTaskError } from '@/lib/recurring-tasks/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageRecurringTasks(actor.role)) return NextResponse.json({ error: 'RECURRING_FORBIDDEN' }, { status: 403, headers: HEADERS });
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || !['version', 'pause', 'resume', 'end'].includes(String((body as Record<string, unknown>).action))) {
      return NextResponse.json({ error: 'RECURRING_RULE_INVALID' }, { status: 400, headers: HEADERS });
    }
    const row = body as { action: 'version'|'pause'|'resume'|'end'; expectedVersion: number; rule?: unknown };
    return NextResponse.json({ data: await changeRecurringRule(createSupabaseServer(), actor, id, row) }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof ActorContextError) return NextResponse.json({ error: error.code }, {
      status: error.code === 'UNAUTHENTICATED' ? 401 : 403, headers: HEADERS,
    });
    const code = normalizeRecurringTaskError(error);
    return NextResponse.json({ error: code }, {
      status: code === 'RECURRING_FORBIDDEN' ? 403 : code === 'RECURRING_VERSION_CONFLICT' ? 409 : 400,
      headers: HEADERS,
    });
  }
}
