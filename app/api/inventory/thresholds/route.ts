import { NextResponse } from 'next/server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { normalizeInventoryError, setLowStockThreshold } from '@/lib/inventory/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: HEADERS });

export async function PUT(request: Request) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Object.keys(body).some((key) => !['locationId','storageAreaId','inventoryItemId','threshold'].includes(key))) {
      return fail('INVENTORY_INPUT_INVALID', 400);
    }
    const result = await setLowStockThreshold(createSupabaseServer(), actor, {
      locationId: String(body.locationId ?? ''), storageAreaId: String(body.storageAreaId ?? ''),
      inventoryItemId: String(body.inventoryItemId ?? ''), threshold: String(body.threshold ?? ''),
    });
    return NextResponse.json({ data: result }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof ActorContextError) return fail(error.code, error.code === 'UNAUTHENTICATED' ? 401 : 403);
    const code = normalizeInventoryError(error);
    return fail(code, code.includes('FORBIDDEN') ? 403 : 400);
  }
}

