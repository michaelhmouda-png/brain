import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { isUuid } from '@/lib/brain-agent/contracts';
import { agentManagementActorFailure } from '@/lib/brain-agent/management-auth.server';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };
async function managed() { const client = await createSupabaseServerAuth(); const actor = await resolveActorContext(client); return { client, actor }; }
function gatewayId(value: unknown): string | null { const id = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).gatewayId : null; return isUuid(id) ? id : null; }
export async function POST(request: Request) {
  try {
    const { client, actor } = await managed();
    if (actor.role !== 'owner' && actor.role !== 'super_admin') return NextResponse.json({ error: 'PAIRING_FORBIDDEN' }, { status: 403, headers });
    const id = gatewayId(await request.json().catch(() => null));
    if (!id) return NextResponse.json({ error: 'PAIRING_INVALID' }, { status: 400, headers });
    const { data, error } = await client.rpc('create_device_pairing_request', { p_gateway_id: id }); const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) return NextResponse.json({ error: 'PAIRING_UNAVAILABLE' }, { status: 409, headers });
    return NextResponse.json({ data: { gatewayId: row.gateway_id, pairingCode: row.pairing_code, expiresAt: row.expires_at } }, { status: 201, headers });
  } catch (error) { return agentManagementActorFailure(error, 'PAIRING_UNAVAILABLE'); }
}
export async function DELETE(request: Request) {
  try {
    const { client, actor } = await managed();
    if (actor.role !== 'owner' && actor.role !== 'super_admin') return NextResponse.json({ error: 'PAIRING_FORBIDDEN' }, { status: 403, headers });
    const id = gatewayId(await request.json().catch(() => null));
    if (!id) return NextResponse.json({ error: 'PAIRING_INVALID' }, { status: 400, headers });
    const { data, error } = await client.rpc('revoke_device_pairing_request', { p_gateway_id: id });
    if (error) return NextResponse.json({ error: 'PAIRING_UNAVAILABLE' }, { status: 409, headers });
    return NextResponse.json({ data: { revoked: data === true } }, { headers });
  } catch (error) { return agentManagementActorFailure(error, 'PAIRING_UNAVAILABLE'); }
}
