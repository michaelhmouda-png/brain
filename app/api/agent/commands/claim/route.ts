import { NextResponse } from 'next/server';
import { authenticateAgentCommandRequest } from '@/lib/brain-agent/agent-request-auth.server';
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
    const body: unknown = await request.json().catch(() => null);
    const limit = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).limit
      : null;
    if (limit !== 1) return unavailable(400);
    const { data, error } = await service.rpc('claim_device_commands', {
      p_public_agent_id: authenticated.agent.publicAgentId,
      p_credential_hash: authenticated.agent.credentialHash,
      p_limit: 1,
    });
    if (error) return unavailable(401);
    const commands = (Array.isArray(data) ? data : []).map((row) => ({
      commandId: row.command_id,
      commandType: row.command_type,
      nvrConnectionId: row.nvr_connection_id,
      request: row.request_payload,
      target: row.target,
      leaseToken: row.lease_token,
      leaseExpiresAt: row.lease_expires_at,
      attemptNumber: row.attempt_number,
      commandExpiresAt: row.command_expires_at,
    }));
    return NextResponse.json({ data: { commands, pollingIntervalSeconds: 5 } }, { headers: HEADERS });
  } catch {
    return unavailable(503);
  }
}
