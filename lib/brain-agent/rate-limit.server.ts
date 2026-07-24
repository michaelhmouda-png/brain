import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function admitAgentRequest(service: SupabaseClient, scope: 'pairing'|'credential'|'heartbeat'|'command', identifierHash: string) {
  const policy = scope === 'pairing'
    ? { limit: 10, seconds: 600 }
    : scope === 'credential'
      ? { limit: 30, seconds: 300 }
      : scope === 'command'
        ? { limit: 240, seconds: 60 }
        : { limit: 120, seconds: 60 };
  const { data, error } = await service.rpc('admit_device_agent_request', {
    p_scope: scope, p_identifier_hash: identifierHash, p_limit: policy.limit, p_window_seconds: policy.seconds,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || typeof row.admitted !== 'boolean') throw new Error('BRAIN_AGENT_RATE_LIMIT_UNAVAILABLE');
  return { admitted: row.admitted, retryAfter: typeof row.retry_after_seconds === 'number' ? row.retry_after_seconds : 1 };
}
