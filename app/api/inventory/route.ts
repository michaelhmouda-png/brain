import { NextResponse } from 'next/server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import {
  canManageInventory,
  createInventoryItem,
  listInventory,
  normalizeInventoryError,
  parseInventoryItem,
} from '@/lib/inventory/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: HEADERS });

function responseError(error: unknown) {
  if (error instanceof ActorContextError) return fail(error.code, error.code === 'UNAUTHENTICATED' ? 401 : 403);
  const code = normalizeInventoryError(error);
  const status = code === 'INVENTORY_FORBIDDEN' ? 403
    : code === 'INVENTORY_UNAVAILABLE' ? 503
    : code.includes('DUPLICATE') || code.includes('CONFLICT') ? 409 : 400;
  return fail(code, status);
}

export async function GET(request: Request) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageInventory(actor.role)) return fail('INVENTORY_FORBIDDEN', 403);
    const params = new URL(request.url).searchParams;
    const allowed = new Set(['locationId', 'storageAreaId', 'search', 'category', 'lowOnly']);
    if ([...params.keys()].some((key) => !allowed.has(key))) return fail('INVENTORY_INPUT_INVALID', 400);
    const [stock, locationsResult, areasResult, employeesResult, catalogResult] = await Promise.all([
      listInventory(authenticated, actor, {
        locationId: params.get('locationId') ?? undefined,
        storageAreaId: params.get('storageAreaId') ?? undefined,
        search: params.get('search') ?? undefined,
        category: params.get('category') ?? undefined,
        lowOnly: params.get('lowOnly') === 'true',
      }),
      authenticated.from('locations').select('id,name,timezone').eq('company_id', actor.companyId).eq('status', 'active').order('name'),
      authenticated.from('inventory_storage_areas').select('id,location_id,name,status').eq('company_id', actor.companyId).order('name'),
      authenticated.from('employees').select('id,first_name,last_name,location_id').eq('company_id', actor.companyId).eq('status', 'active').order('first_name'),
      authenticated.from('inventory_items').select('id,name,description,category,canonical_unit,sku,barcode,status,default_low_stock_threshold,created_at,updated_at').eq('company_id', actor.companyId).order('name'),
    ]);
    if (locationsResult.error || areasResult.error || employeesResult.error || catalogResult.error) throw new Error('INVENTORY_UNAVAILABLE');
    return NextResponse.json({
      data: {
        evaluatedAt: new Date().toISOString(),
        stock,
        locations: locationsResult.data ?? [],
        storageAreas: areasResult.data ?? [],
        employees: employeesResult.data ?? [],
        catalog: catalogResult.data ?? [],
      },
    }, { headers: HEADERS });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: Request) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageInventory(actor.role)) return fail('INVENTORY_FORBIDDEN', 403);
    const input = parseInventoryItem(await request.json().catch(() => null));
    const item = await createInventoryItem(createSupabaseServer(), actor, input);
    return NextResponse.json({ data: item }, { status: 201, headers: HEADERS });
  } catch (error) {
    return responseError(error);
  }
}
