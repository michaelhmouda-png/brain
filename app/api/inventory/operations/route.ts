import { NextResponse } from 'next/server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import {
  canManageInventory, normalizeInventoryError, parseInventoryMovement,
  parseInventoryTransfer, recordMovement, transferStock,
} from '@/lib/inventory/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: HEADERS });

export async function POST(request: Request) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageInventory(actor.role)) return fail('INVENTORY_FORBIDDEN', 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('INVENTORY_INPUT_INVALID', 400);
    const row = body as Record<string, unknown>;
    if (row.operation === 'movement') {
      const input = { ...row };
      delete input.operation;
      const result = await recordMovement(createSupabaseServer(), actor, parseInventoryMovement(input));
      return NextResponse.json({ data: result }, { status: 201, headers: HEADERS });
    }
    if (row.operation === 'transfer') {
      const input = { ...row };
      delete input.operation;
      const result = await transferStock(createSupabaseServer(), actor, parseInventoryTransfer(input));
      return NextResponse.json({ data: result }, { status: 201, headers: HEADERS });
    }
    return fail('INVENTORY_INPUT_INVALID', 400);
  } catch (error) {
    if (error instanceof ActorContextError) return fail(error.code, error.code === 'UNAUTHENTICATED' ? 401 : 403);
    const code = normalizeInventoryError(error);
    const status = code === 'INVENTORY_FORBIDDEN' ? 403
      : code.includes('CONFLICT') || code === 'INVENTORY_INSUFFICIENT_STOCK' ? 409
      : code === 'INVENTORY_UNAVAILABLE' ? 503 : 400;
    return fail(code, status);
  }
}
