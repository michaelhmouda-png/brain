import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { parseAgentMetadata } from '@/lib/brain-agent/contracts';
import { createAgentCredential, pairingCodeHash, requestAddressRateKey } from '@/lib/brain-agent/security.server';
import { admitAgentRequest } from '@/lib/brain-agent/rate-limit.server';

const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  try {
    const service = createSupabaseServer();
    const rate = await admitAgentRequest(service, 'pairing', requestAddressRateKey(request));
    if (!rate.admitted) return NextResponse.json({ error: 'PAIRING_UNAVAILABLE' }, { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfter) } });
    const body: unknown = await request.json().catch(() => null);
    const metadata = parseAgentMetadata(body, true);
    const code = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).pairingCode : null;
    if (!metadata?.publicAgentId || typeof code !== 'string' || !/^[0-9a-f]{32}$/i.test(code)) return NextResponse.json({ error: 'PAIRING_UNAVAILABLE' }, { status: 400, headers });
    const credential = createAgentCredential(metadata.publicAgentId);
    const { data, error } = await service.rpc('consume_device_pairing_request', { p_code_hash: pairingCodeHash(code.toLowerCase()), p_public_agent_id: metadata.publicAgentId, p_credential_hash: credential.hash, p_agent_version: metadata.agentVersion, p_platform: metadata.platform, p_os_version: metadata.osVersion, p_hostname_label: metadata.hostnameLabel, p_declared_capabilities: metadata.declaredCapabilities });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) return NextResponse.json({ error: 'PAIRING_UNAVAILABLE' }, { status: 401, headers });
    return NextResponse.json({ data: { credential: credential.token, gatewayId: row.gateway_id, locationId: row.location_id, pollingIntervalSeconds: 60, approvedCapabilities: row.approved_capabilities } }, { status: 201, headers });
  } catch {
    return NextResponse.json({ error: 'PAIRING_UNAVAILABLE' }, { status: 503, headers });
  }
}
