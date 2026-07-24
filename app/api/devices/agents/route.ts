import { NextResponse } from 'next/server';
import { canViewCameraManager } from '@/lib/camera-manager';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';
import { agentManagementActorFailure } from '@/lib/brain-agent/management-auth.server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };
const failure = (code: string, status: number) => NextResponse.json({ error: code }, { status, headers: HEADERS });

export async function GET() {
  try {
    const authClient = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authClient);
    if (!canViewCameraManager(actor.role)) return failure('AGENT_FORBIDDEN', 403);
    const service = createSupabaseServer();
    const [{ data: gateways, error: gatewayError }, { data: pairings, error: pairingError }, { data: locations, error: locationError }] = await Promise.all([
      service.from('device_gateways').select('id,location_id,name,status,last_seen_at,agent_version,platform,paired_at').eq('company_id', actor.companyId).order('name'),
      service.from('device_pairing_requests').select('gateway_id,expires_at,used_at,revoked_at').eq('company_id', actor.companyId).is('used_at', null).is('revoked_at', null),
      service.from('locations').select('id,name').eq('company_id', actor.companyId).eq('status', 'active'),
    ]);
    if (gatewayError || pairingError || locationError) return failure('AGENT_UNAVAILABLE', 503);
    const gatewayIds = (gateways ?? []).map((gateway) => gateway.id);
    let credentials: unknown[] = [];
    let capabilities: unknown[] = [];
    if (gatewayIds.length > 0) {
      const [{ data: credentialRows, error: credentialError }, { data: capabilityRows, error: capabilityError }] = await Promise.all([
        service.from('device_agent_credentials').select('gateway_id,revoked_at').in('gateway_id', gatewayIds),
        service.from('device_gateway_capabilities').select('gateway_id,capability_code,declared_version,approved,revoked_at').in('gateway_id', gatewayIds),
      ]);
      if (credentialError || capabilityError) return failure('AGENT_UNAVAILABLE', 503);
      credentials = credentialRows ?? [];
      capabilities = capabilityRows ?? [];
    }
    return NextResponse.json({ data: { gateways: gateways ?? [], pairings: pairings ?? [], credentials, capabilities, locations: locations ?? [], canManage: actor.role === 'owner' || actor.role === 'super_admin' } }, { headers: HEADERS });
  } catch (error) { return agentManagementActorFailure(error, 'AGENT_UNAVAILABLE'); }
}

export async function POST(request: Request) {
  try {
    const client = await createSupabaseServerAuth();
    const actor = await resolveActorContext(client);
    if (actor.role !== 'owner' && actor.role !== 'super_admin') return failure('GATEWAY_FORBIDDEN', 403);
    const body: unknown = await request.json().catch(() => null);
    const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (!record || typeof record.locationId !== 'string' || typeof record.name !== 'string') return failure('GATEWAY_INVALID', 400);
    const { data, error } = await client.rpc('create_device_gateway', { p_location_id: record.locationId, p_name: record.name });
    if (error || typeof data !== 'string') return failure('GATEWAY_NOT_CREATED', 409);
    return NextResponse.json({ data: { gatewayId: data } }, { status: 201, headers: HEADERS });
  } catch (error) { return agentManagementActorFailure(error, 'GATEWAY_NOT_CREATED'); }
}
