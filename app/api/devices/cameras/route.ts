import { NextResponse } from 'next/server';
import { canViewCameraManager, parseCameraWrite } from '@/lib/camera-manager';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };
const safeError = (status: number, code: string) => NextResponse.json({ error: code }, { status, headers: HEADERS });
const actorFailure = (error: unknown) => error instanceof ActorContextError
  ? safeError(error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'ACTOR_CONTEXT_UNAVAILABLE' ? 503 : 403, error.code)
  : safeError(503, 'CAMERA_MANAGER_UNAVAILABLE');

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerAuth();
    const actor = await resolveActorContext(supabase);
    if (!canViewCameraManager(actor.role)) return safeError(403, 'CAMERA_MANAGER_FORBIDDEN');
    const locationId = new URL(request.url).searchParams.get('locationId');
    if (locationId && !/^[0-9a-f-]{36}$/i.test(locationId)) return safeError(400, 'INVALID_LOCATION');
    let query = supabase.from('cameras').select('id,location_id,nvr_connection_id,external_channel_id,name,area,department,stream_profile,status,ai_enabled,task_verification_enabled,last_seen_at,created_at,updated_at').eq('company_id', actor.companyId).order('name');
    if (locationId) query = query.eq('location_id', locationId);
    const { data, error } = await query;
    if (error) return safeError(503, 'CAMERA_MANAGER_UNAVAILABLE');
    return NextResponse.json({ data: data ?? [] }, { headers: HEADERS });
  } catch (error) {
    return actorFailure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createSupabaseServerAuth();
    const actor = await resolveActorContext(supabase);
    if (!canViewCameraManager(actor.role)) return safeError(403, 'CAMERA_MANAGER_FORBIDDEN');
    const input = parseCameraWrite(await request.json().catch(() => null));
    if (!input) return safeError(400, 'INVALID_CAMERA_METADATA');
    const { data, error } = await supabase.from('cameras').update({ name: input.name, area: input.area, department: input.department, ai_enabled: input.aiEnabled, task_verification_enabled: input.taskVerificationEnabled }).eq('id', input.id).eq('company_id', actor.companyId).select('id,location_id,nvr_connection_id,external_channel_id,name,area,department,stream_profile,status,ai_enabled,task_verification_enabled,last_seen_at,created_at,updated_at').maybeSingle();
    if (error) return safeError(409, 'CAMERA_METADATA_NOT_SAVED');
    if (!data) return safeError(404, 'CAMERA_NOT_FOUND');
    return NextResponse.json({ data }, { headers: HEADERS });
  } catch (error) {
    return actorFailure(error);
  }
}
