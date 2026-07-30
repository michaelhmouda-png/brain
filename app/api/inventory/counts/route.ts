import { NextResponse } from 'next/server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { boundedText, isUuid } from '@/lib/inventory/contracts';
import {
  canManageInventory, createCountSession, normalizeInventoryError,
} from '@/lib/inventory/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: HEADERS });

function errorResponse(error: unknown) {
  if (error instanceof ActorContextError) return fail(error.code, error.code === 'UNAUTHENTICATED' ? 401 : 403);
  const code = normalizeInventoryError(error);
  return fail(code, code === 'INVENTORY_FORBIDDEN' || code === 'INVENTORY_COUNT_FORBIDDEN' ? 403 : 400);
}

export async function GET() {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (actor.role === 'employee' && !actor.employeeId) return fail('INVENTORY_COUNT_FORBIDDEN', 403);
    const { data, error } = await authenticated
      .from('inventory_count_sessions')
      .select('id,location_id,storage_area_id,assigned_employee_id,status,notes,created_at,counting_started_at,submitted_at,approved_at,cancelled_at,inventory_count_lines(id,inventory_item_id,canonical_unit_snapshot,expected_quantity,counted_quantity,damaged_quantity,variance,note,inventory_items(name,sku))')
      .eq('company_id', actor.companyId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error('INVENTORY_UNAVAILABLE');
    return NextResponse.json({ data: data ?? [], evaluatedAt: new Date().toISOString() }, { headers: HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageInventory(actor.role)) return fail('INVENTORY_FORBIDDEN', 403);
    const value = await request.json().catch(() => null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVENTORY_INPUT_INVALID', 400);
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !['locationId','storageAreaId','assignedEmployeeId','notes'].includes(key))
        || !isUuid(row.locationId) || !isUuid(row.storageAreaId)
        || row.assignedEmployeeId !== undefined && row.assignedEmployeeId !== null && !isUuid(row.assignedEmployeeId)) {
      return fail('INVENTORY_INPUT_INVALID', 400);
    }
    const result = await createCountSession(createSupabaseServer(), actor, {
      locationId: row.locationId, storageAreaId: row.storageAreaId,
      assignedEmployeeId: row.assignedEmployeeId as string | null | undefined ?? null,
      notes: boundedText(row.notes, 1000),
    });
    return NextResponse.json({ data: result }, { status: 201, headers: HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
