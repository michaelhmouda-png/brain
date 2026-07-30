import { NextResponse } from 'next/server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { boundedText, isUuid } from '@/lib/inventory/contracts';
import { canManageInventory, createStorageArea, normalizeInventoryError } from '@/lib/inventory/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: HEADERS });

export async function POST(request: Request) {
  try {
    const auth = await createSupabaseServerAuth();
    const actor = await resolveActorContext(auth);
    if (!canManageInventory(actor.role)) return fail('INVENTORY_FORBIDDEN', 403);
    const value = await request.json().catch(() => null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVENTORY_INPUT_INVALID', 400);
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !['locationId', 'name', 'description'].includes(key))
        || !isUuid(row.locationId)) return fail('INVENTORY_INPUT_INVALID', 400);
    const area = await createStorageArea(createSupabaseServer(), actor, {
      locationId: row.locationId,
      name: boundedText(row.name, 160, true)!,
      description: boundedText(row.description, 1000),
    });
    return NextResponse.json({ data: area }, { status: 201, headers: HEADERS });
  } catch (error) {
    if (error instanceof ActorContextError) return fail(error.code, error.code === 'UNAUTHENTICATED' ? 401 : 403);
    const code = normalizeInventoryError(error);
    return fail(code, code === 'INVENTORY_FORBIDDEN' ? 403 : code.includes('DUPLICATE') ? 409 : 400);
  }
}

