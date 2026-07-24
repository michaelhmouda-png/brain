import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { parseAgentMetadata, type AgentContext } from '@/lib/brain-agent/contracts';
import { agentHeartbeatRateKey, parseAgentCredential, requestAddressRateKey } from '@/lib/brain-agent/security.server';
import { admitAgentRequest } from '@/lib/brain-agent/rate-limit.server';

const headers = { 'Cache-Control': 'private, no-store' };
const heartbeatFailure = (
  requestId: string,
  error: string,
  status: number,
  diagnostics?: { stage: string; databaseCode?: string },
  retryAfter?: number,
) => NextResponse.json(
  { error, requestId, ...(diagnostics ? { diagnostics } : {}) },
  {
    status,
    headers: {
      ...headers,
      'X-Request-ID': requestId,
      ...(retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) }),
    },
  },
);

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const service = createSupabaseServer();
    const parsed = parseAgentCredential(request.headers.get('authorization'));
    const { data: activeCredentialId, error: credentialLookupError } = parsed
      ? await service.rpc('resolve_device_agent_rate_identity', { p_public_agent_id: parsed.publicAgentId, p_credential_hash: parsed.hash })
      : { data: null, error: null };
    if (credentialLookupError) throw new Error('BRAIN_AGENT_CREDENTIAL_LOOKUP_UNAVAILABLE');
    const rateKey = typeof activeCredentialId === 'string' ? agentHeartbeatRateKey(activeCredentialId) : requestAddressRateKey(request);
    const rate = await admitAgentRequest(service, typeof activeCredentialId === 'string' ? 'heartbeat' : 'credential', rateKey);
    if (!rate.admitted) return heartbeatFailure(requestId, 'AGENT_RATE_LIMITED', 429, { stage: 'rate_limit' }, rate.retryAfter);
    const metadata = parseAgentMetadata(await request.json().catch(() => null), false);
    if (!parsed || !metadata || typeof activeCredentialId !== 'string') {
      return heartbeatFailure(requestId, 'AGENT_AUTHENTICATION_FAILED', 401, { stage: 'credential_or_metadata_validation' });
    }
    const { data, error } = await service.rpc('authenticate_device_agent_heartbeat', {
      p_public_agent_id: parsed.publicAgentId,
      p_credential_hash: parsed.hash,
      p_agent_version: metadata.agentVersion,
      p_platform: metadata.platform,
      p_os_version: metadata.osVersion,
      p_hostname_label: metadata.hostnameLabel,
      p_declared_capabilities: metadata.declaredCapabilities,
      p_credentialed_nvr_ids: metadata.credentialedNvrIds,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error) {
      const authenticationFailure = error.message === 'AGENT_AUTHENTICATION_FAILED';
      console.warn('[Brain Agent Heartbeat] RPC rejected', {
        requestId,
        authenticationFailure,
        databaseCode: error.code,
      });
      return heartbeatFailure(
        requestId,
        authenticationFailure ? 'AGENT_AUTHENTICATION_FAILED' : 'AGENT_HEARTBEAT_RPC_FAILED',
        authenticationFailure ? 401 : 503,
        { stage: 'authenticate_rpc', databaseCode: error.code },
      );
    }
    if (!row) return heartbeatFailure(requestId, 'AGENT_AUTHENTICATION_FAILED', 401, { stage: 'authenticate_rpc_empty' });
    const agentContext: AgentContext = { publicAgentId: parsed.publicAgentId, gatewayId: row.gateway_id, companyId: row.company_id, locationId: row.location_id, approvedCapabilities: Array.isArray(row.approved_capabilities) ? row.approved_capabilities : [] };
    return NextResponse.json(
      { data: { gatewayId: agentContext.gatewayId, locationId: agentContext.locationId, pollingIntervalSeconds: row.polling_interval_seconds, approvedCapabilities: agentContext.approvedCapabilities } },
      { headers: { ...headers, 'X-Request-ID': requestId } },
    );
  } catch {
    return heartbeatFailure(requestId, 'AGENT_UNAVAILABLE', 503, { stage: 'request_processing' });
  }
}
