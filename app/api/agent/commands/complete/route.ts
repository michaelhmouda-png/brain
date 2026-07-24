import { NextResponse } from 'next/server';
import { authenticateAgentCommandRequest } from '@/lib/brain-agent/agent-request-auth.server';
import { parseAgentCommandCompletion } from '@/lib/brain-agent/command-contracts';
import { createSupabaseServer } from '@/lib/supabaseServer';

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };
const unavailable = (status: number, retryAfter?: number) => NextResponse.json(
  { error: 'AGENT_COMMAND_UNAVAILABLE' },
  { status, headers: retryAfter ? { ...HEADERS, 'Retry-After': String(retryAfter) } : HEADERS },
);

export async function POST(request: Request) {
  try {
    const service = createSupabaseServer();
    const authenticated = await authenticateAgentCommandRequest(request, service);
    if (authenticated.retryAfter) return unavailable(429, authenticated.retryAfter);
    if (!authenticated.agent) return unavailable(401);
    const completion = parseAgentCommandCompletion(await request.json().catch(() => null));
    if (!completion) return unavailable(400);
    const { data, error } = await service.rpc('complete_device_command_v2', {
      p_public_agent_id: authenticated.agent.publicAgentId,
      p_credential_hash: authenticated.agent.credentialHash,
      p_command_id: completion.commandId,
      p_command_type: completion.commandType,
      p_lease_token: completion.leaseToken,
      p_outcome: completion.outcome,
      p_result_payload: completion.result,
      p_error_code: completion.errorCode,
      p_retryable: completion.retryable,
      p_diagnostic_payload: completion.diagnostic ?? null,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) return unavailable(409);
    return NextResponse.json({
      data: {
        commandId: row.command_id,
        status: row.command_status,
        duplicateDelivery: row.duplicate_delivery === true,
        nextAttemptAt: row.next_attempt_at,
      },
    }, { headers: HEADERS });
  } catch {
    return unavailable(503);
  }
}
