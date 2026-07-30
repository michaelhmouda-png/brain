import { NextResponse } from 'next/server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import {
  approveCountSession, normalizeInventoryError, parseCountLines, updateCountSession,
} from '@/lib/inventory/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: HEADERS });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    const { id } = await context.params;
    const value = await request.json().catch(() => null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVENTORY_INPUT_INVALID', 400);
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !['action', 'lines', 'idempotencyKey'].includes(key))) {
      return fail('INVENTORY_INPUT_INVALID', 400);
    }
    let result: object;
    if (row.action === 'approve') {
      result = await approveCountSession(createSupabaseServer(), actor, id, String(row.idempotencyKey ?? ''));
    } else if (row.action === 'start' || row.action === 'submit' || row.action === 'cancel') {
      result = await updateCountSession(createSupabaseServer(), actor, id, row.action, null);
    } else if (row.action === 'save') {
      result = await updateCountSession(createSupabaseServer(), actor, id, 'save', parseCountLines(row.lines));
    } else {
      return fail('INVENTORY_INPUT_INVALID', 400);
    }
    return NextResponse.json({ data: result }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof ActorContextError) return fail(error.code, error.code === 'UNAUTHENTICATED' ? 401 : 403);
    const code = normalizeInventoryError(error);
    const status = code.includes('FORBIDDEN') ? 403 : code.includes('STALE') || code.includes('TRANSITION') ? 409 : 400;
    return fail(code, status);
  }
}

