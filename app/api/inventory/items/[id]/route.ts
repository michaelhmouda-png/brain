import { NextResponse } from 'next/server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import {
  canManageInventory, normalizeInventoryError, parseInventoryItem, updateInventoryItem,
} from '@/lib/inventory/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: HEADERS });

function errorResponse(error: unknown) {
  if (error instanceof ActorContextError) return fail(error.code, error.code === 'UNAUTHENTICATED' ? 401 : 403);
  const code = normalizeInventoryError(error);
  return fail(code, code.includes('FORBIDDEN') ? 403 : code.includes('NOT_FOUND') ? 404 : code.includes('IMMUTABLE') ? 409 : 400);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageInventory(actor.role)) return fail('INVENTORY_FORBIDDEN', 403);
    const { id } = await context.params;
    const [item, balances, movements, counts] = await Promise.all([
      authenticated.from('inventory_items').select('id,name,description,category,canonical_unit,sku,barcode,status,default_low_stock_threshold,created_at,updated_at').eq('id', id).eq('company_id', actor.companyId).maybeSingle(),
      authenticated.from('inventory_balances').select('location_id,storage_area_id,quantity,canonical_unit,last_movement_at,inventory_storage_areas(name),locations(name)').eq('inventory_item_id', id).eq('company_id', actor.companyId),
      authenticated.from('inventory_movements').select('id,location_id,storage_area_id,movement_type,quantity_delta,balance_after,canonical_unit_snapshot,reason,actor_profile_id,correlation_id,source_type,source_id,created_at').eq('inventory_item_id', id).eq('company_id', actor.companyId).order('created_at', { ascending: false }).limit(100),
      authenticated.from('inventory_count_lines').select('session_id,expected_quantity,counted_quantity,damaged_quantity,variance,inventory_count_sessions(status,created_at,approved_at)').eq('inventory_item_id', id).eq('company_id', actor.companyId).order('created_at', { ascending: false }).limit(50),
    ]);
    if (item.error || balances.error || movements.error || counts.error) throw new Error('INVENTORY_UNAVAILABLE');
    if (!item.data) return fail('INVENTORY_ITEM_NOT_FOUND', 404);
    return NextResponse.json({ data: {
      item: item.data, balances: balances.data ?? [], movements: movements.data ?? [], countHistory: counts.data ?? [],
      evaluatedAt: new Date().toISOString(),
    } }, { headers: HEADERS });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageInventory(actor.role)) return fail('INVENTORY_FORBIDDEN', 403);
    const { id } = await context.params;
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('INVENTORY_INPUT_INVALID', 400);
    const { status, ...itemFields } = raw as Record<string, unknown>;
    if (status !== 'active' && status !== 'inactive') return fail('INVENTORY_INPUT_INVALID', 400);
    const item = await updateInventoryItem(createSupabaseServer(), actor, id, { ...parseInventoryItem(itemFields), status });
    return NextResponse.json({ data: item }, { headers: HEADERS });
  } catch (error) { return errorResponse(error); }
}

