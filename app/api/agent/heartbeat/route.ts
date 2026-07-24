import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { parseAgentMetadata, type AgentContext } from '@/lib/brain-agent/contracts';
import { agentHeartbeatRateKey, parseAgentCredential, requestAddressRateKey } from '@/lib/brain-agent/security.server';
import { admitAgentRequest } from '@/lib/brain-agent/rate-limit.server';

const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  try {
    const service = createSupabaseServer();
    const parsed = parseAgentCredential(request.headers.get('authorization'));
    const { data: activeCredentialId, error: credentialLookupError } = parsed
      ? await service.rpc('resolve_device_agent_rate_identity', { p_public_agent_id: parsed.publicAgentId, p_credential_hash: parsed.hash })
      : { data: null, error: null };
    if (credentialLookupError) throw new Error('BRAIN_AGENT_CREDENTIAL_LOOKUP_UNAVAILABLE');
    const rateKey = typeof activeCredentialId === 'string' ? agentHeartbeatRateKey(activeCredentialId) : requestAddressRateKey(request);
    const rate = await admitAgentRequest(service, typeof activeCredentialId === 'string' ? 'heartbeat' : 'credential', rateKey);
    if (!rate.admitted) return NextResponse.json({ error: 'AGENT_UNAVAILABLE' }, { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfter) } });
    const metadata = parseAgentMetadata(await request.json().catch(() => null), false);
    if (!parsed || !metadata) return NextResponse.json({ error: 'AGENT_UNAVAILABLE' }, { status: 401, headers });
    const { data, error } = await service.rpc('authenticate_device_agent_heartbeat', { p_public_agent_id: parsed.publicAgentId, p_credential_hash: parsed.hash, p_agent_version: metadata.agentVersion, p_platform: metadata.platform, p_os_version: metadata.osVersion, p_hostname_label: metadata.hostnameLabel, p_declared_capabilities: metadata.declaredCapabilities });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) return NextResponse.json({ error: 'AGENT_UNAVAILABLE' }, { status: 401, headers });
    const agentContext: AgentContext = { publicAgentId: parsed.publicAgentId, gatewayId: row.gateway_id, companyId: row.company_id, locationId: row.location_id, approvedCapabilities: Array.isArray(row.approved_capabilities) ? row.approved_capabilities : [] };
    return NextResponse.json({ data: { gatewayId: agentContext.gatewayId, locationId: agentContext.locationId, pollingIntervalSeconds: row.polling_interval_seconds, approvedCapabilities: agentContext.approvedCapabilities } }, { headers });
  } catch {
    return NextResponse.json({ error: 'AGENT_UNAVAILABLE' }, { status: 503, headers });
  }
}
