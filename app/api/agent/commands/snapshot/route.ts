import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authenticateAgentCommandRequest } from '@/lib/brain-agent/agent-request-auth.server';
import { isUuid } from '@/lib/brain-agent/contracts';
import { createSupabaseServer } from '@/lib/supabaseServer';

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };
const MAXIMUM_BYTES = 5_242_880;
const CHANNEL_ID = /^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-6])$/;
const unavailable = (status: number, retryAfter?: number) => NextResponse.json(
  { error: 'AGENT_SNAPSHOT_UNAVAILABLE' },
  { status, headers: retryAfter ? { ...HEADERS, 'Retry-After': String(retryAfter) } : HEADERS },
);

async function boundedBody(request: Request): Promise<Buffer | null> {
  const declared = Number(request.headers.get('content-length'));
  if (!Number.isInteger(declared) || declared < 4 || declared > MAXIMUM_BYTES || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAXIMUM_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(part.value));
  }
  if (bytes !== declared) return null;
  const body = Buffer.concat(chunks);
  return body.length >= 4 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff ? body : null;
}

export async function POST(request: Request) {
  try {
    const service = createSupabaseServer();
    const authenticated = await authenticateAgentCommandRequest(request, service);
    if (authenticated.retryAfter) return unavailable(429, authenticated.retryAfter);
    if (!authenticated.agent) return unavailable(401);
    const commandId = request.headers.get('x-command-id');
    const leaseToken = request.headers.get('x-lease-token');
    const channelId = request.headers.get('x-channel-id');
    const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!isUuid(commandId) || !isUuid(leaseToken) || !channelId || !CHANNEL_ID.test(channelId) || contentType !== 'image/jpeg') {
      return unavailable(400);
    }
    const body = await boundedBody(request);
    if (!body) return unavailable(400);
    const sha256 = createHash('sha256').update(body).digest('hex');
    const { data, error } = await service.rpc('reserve_device_snapshot_upload', {
      p_public_agent_id: authenticated.agent.publicAgentId,
      p_credential_hash: authenticated.agent.credentialHash,
      p_command_id: commandId,
      p_lease_token: leaseToken,
      p_channel_id: channelId,
      p_content_type: contentType,
      p_byte_size: body.length,
      p_sha256: sha256,
    });
    const artifact = Array.isArray(data) ? data[0] : data;
    if (error || !artifact) return unavailable(409);
    const { error: uploadError } = await service.storage
      .from(artifact.bucket_id)
      .upload(artifact.storage_path, body, {
        contentType,
        cacheControl: '60',
        upsert: artifact.duplicate_upload === true,
      });
    if (uploadError) return unavailable(503);
    const { data: finalized, error: finalizeError } = await service.rpc('finalize_device_snapshot_upload', {
      p_public_agent_id: authenticated.agent.publicAgentId,
      p_credential_hash: authenticated.agent.credentialHash,
      p_command_id: commandId,
      p_lease_token: leaseToken,
      p_artifact_id: artifact.artifact_id,
    });
    if (finalizeError || finalized !== true) return unavailable(409);
    return NextResponse.json({ data: { artifactId: artifact.artifact_id } }, { status: 201, headers: HEADERS });
  } catch {
    return unavailable(503);
  }
}
