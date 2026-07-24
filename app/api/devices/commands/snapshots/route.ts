import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { agentManagementActorFailure } from '@/lib/brain-agent/management-auth.server';
import { isUuid } from '@/lib/brain-agent/contracts';
import { canViewCameraManager } from '@/lib/camera-manager';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };
const failure = (code: string, status: number) => NextResponse.json({ error: code }, { status, headers: HEADERS });

export async function GET(request: Request) {
  try {
    const authClient = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authClient);
    if (!canViewCameraManager(actor.role)) return failure('SNAPSHOT_FORBIDDEN', 403);
    const id = new URL(request.url).searchParams.get('id');
    if (!isUuid(id)) return failure('SNAPSHOT_INVALID', 400);
    const { data, error } = await authClient.rpc('get_device_snapshot_artifact', { p_artifact_id: id });
    const artifact = Array.isArray(data) ? data[0] : data;
    if (error) return failure('SNAPSHOT_UNAVAILABLE', 503);
    if (!artifact) return failure('SNAPSHOT_NOT_FOUND', 404);
    const service = createSupabaseServer();
    const { data: signed, error: signedError } = await service.storage
      .from(artifact.bucket_id)
      .createSignedUrl(artifact.storage_path, 60);
    if (signedError || !signed?.signedUrl) return failure('SNAPSHOT_UNAVAILABLE', 503);
    return NextResponse.json({
      data: {
        artifactId: artifact.artifact_id,
        contentType: artifact.content_type,
        expiresAt: artifact.expires_at,
        signedUrl: signed.signedUrl,
        signedUrlExpiresInSeconds: 60,
      },
    }, { headers: HEADERS });
  } catch (error) {
    return agentManagementActorFailure(error, 'SNAPSHOT_UNAVAILABLE');
  }
}
