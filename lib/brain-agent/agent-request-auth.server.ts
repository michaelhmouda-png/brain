import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { admitAgentRequest } from './rate-limit.server';
import { agentHeartbeatRateKey, parseAgentCredential, requestAddressRateKey } from './security.server';

export type AuthenticatedAgentRequest = {
  publicAgentId: string;
  credentialHash: string;
};

export async function authenticateAgentCommandRequest(
  request: Request,
  service: SupabaseClient,
): Promise<{ agent: AuthenticatedAgentRequest | null; retryAfter: number | null }> {
  const parsed = parseAgentCredential(request.headers.get('authorization'));
  const { data: activeCredentialId, error } = parsed
    ? await service.rpc('resolve_device_agent_rate_identity', {
        p_public_agent_id: parsed.publicAgentId,
        p_credential_hash: parsed.hash,
      })
    : { data: null, error: null };
  if (error) throw new Error('BRAIN_AGENT_CREDENTIAL_LOOKUP_UNAVAILABLE');
  const authenticated = typeof activeCredentialId === 'string';
  const rate = await admitAgentRequest(
    service,
    authenticated ? 'command' : 'credential',
    authenticated ? agentHeartbeatRateKey(activeCredentialId) : requestAddressRateKey(request),
  );
  if (!rate.admitted) return { agent: null, retryAfter: rate.retryAfter };
  return {
    agent: parsed && authenticated
      ? { publicAgentId: parsed.publicAgentId, credentialHash: parsed.hash }
      : null,
    retryAfter: null,
  };
}
