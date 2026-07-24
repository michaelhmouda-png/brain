import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { isUuid } from '@/lib/brain-agent/contracts';
import { agentManagementActorFailure } from '@/lib/brain-agent/management-auth.server';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };
export async function POST(request: Request) {
  try {
    const client = await createSupabaseServerAuth(); const actor = await resolveActorContext(client);
    if (actor.role !== 'owner' && actor.role !== 'super_admin') return NextResponse.json({ error: 'AGENT_REVOCATION_FORBIDDEN' }, { status: 403, headers });
    const body: unknown = await request.json().catch(() => null); const id = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).gatewayId : null;
    if (!isUuid(id)) return NextResponse.json({ error: 'AGENT_INVALID' }, { status: 400, headers });
    const { data, error } = await client.rpc('revoke_device_agent', { p_gateway_id: id });
    if (error) return NextResponse.json({ error: 'AGENT_REVOCATION_FAILED' }, { status: 409, headers });
    return NextResponse.json({ data: { revoked: data === true } }, { headers });
  } catch (error) { return agentManagementActorFailure(error, 'AGENT_REVOCATION_FAILED'); }
}
