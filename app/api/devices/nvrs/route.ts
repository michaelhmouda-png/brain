import { NextResponse } from 'next/server';
import { canManageNvrs, canViewCameraManager, parseNvrWrite } from '@/lib/camera-manager';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };
const safeError = (status: number, code: string) => NextResponse.json({ error: code }, { status, headers: HEADERS });

async function context() {
  const supabase = await createSupabaseServerAuth();
  const actor = await resolveActorContext(supabase);
  return { supabase, actor };
}

const actorFailure = (error: unknown) => error instanceof ActorContextError
  ? safeError(error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'ACTOR_CONTEXT_UNAVAILABLE' ? 503 : 403, error.code)
  : safeError(503, 'CAMERA_MANAGER_UNAVAILABLE');

async function validLocation(supabase: Awaited<ReturnType<typeof createSupabaseServerAuth>>, companyId: string, locationId: string) {
  const { data, error } = await supabase.from('locations').select('id').eq('id', locationId).eq('company_id', companyId).eq('status', 'active').maybeSingle();
  return !error && data?.id === locationId;
}

export async function GET() {
  try {
    const { supabase, actor } = await context();
    if (!canViewCameraManager(actor.role)) return safeError(403, 'CAMERA_MANAGER_FORBIDDEN');
    const [{ data: nvrs, error: nvrError }, { data: locations, error: locationError }] = await Promise.all([
      supabase.from('nvr_connections').select('id,location_id,gateway_id,name,vendor,local_host,http_port,rtsp_port,onvif_port,status,last_tested_at,created_at,updated_at').eq('company_id', actor.companyId).order('name'),
      supabase.from('locations').select('id,name,status').eq('company_id', actor.companyId).eq('status', 'active').order('name'),
    ]);
    if (nvrError || locationError) return safeError(503, 'CAMERA_MANAGER_UNAVAILABLE');
    return NextResponse.json({ data: { nvrs: nvrs ?? [], locations: locations ?? [], canManage: canManageNvrs(actor.role) } }, { headers: HEADERS });
  } catch (error) {
    return actorFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, actor } = await context();
    if (!canManageNvrs(actor.role)) return safeError(403, 'NVR_MANAGEMENT_FORBIDDEN');
    const input = parseNvrWrite(await request.json().catch(() => null), false);
    if (!input || !['unconfigured', 'configured'].includes(input.status) || !await validLocation(supabase, actor.companyId, input.locationId)) return safeError(400, 'INVALID_NVR_METADATA');
    const { data, error } = await supabase.from('nvr_connections').insert({
      company_id: actor.companyId, location_id: input.locationId, gateway_id: input.gatewayId,
      name: input.name, vendor: input.vendor, local_host: input.localHost,
      http_port: input.httpPort, rtsp_port: input.rtspPort, onvif_port: input.onvifPort,
      username_secret_reference: input.usernameSecretReference, password_secret_reference: input.passwordSecretReference,
      status: input.status, created_by: actor.profileId,
    }).select('id,location_id,gateway_id,name,vendor,local_host,http_port,rtsp_port,onvif_port,status,last_tested_at,created_at,updated_at').single();
    if (error || !data) return safeError(409, 'NVR_METADATA_NOT_SAVED');
    return NextResponse.json({ data }, { status: 201, headers: HEADERS });
  } catch (error) {
    return actorFailure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, actor } = await context();
    if (!canManageNvrs(actor.role)) return safeError(403, 'NVR_MANAGEMENT_FORBIDDEN');
    const input = parseNvrWrite(await request.json().catch(() => null), true);
    if (!input?.id || !['unconfigured', 'configured'].includes(input.status) || !await validLocation(supabase, actor.companyId, input.locationId)) return safeError(400, 'INVALID_NVR_METADATA');
    const { data, error } = await supabase.from('nvr_connections').update({
      location_id: input.locationId, gateway_id: input.gatewayId, name: input.name, vendor: input.vendor, local_host: input.localHost,
      http_port: input.httpPort, rtsp_port: input.rtspPort, onvif_port: input.onvifPort,
      username_secret_reference: input.usernameSecretReference, password_secret_reference: input.passwordSecretReference, status: input.status,
    }).eq('id', input.id).eq('company_id', actor.companyId).select('id,location_id,gateway_id,name,vendor,local_host,http_port,rtsp_port,onvif_port,status,last_tested_at,created_at,updated_at').maybeSingle();
    if (error) return safeError(409, 'NVR_METADATA_NOT_SAVED');
    if (!data) return safeError(404, 'NVR_NOT_FOUND');
    return NextResponse.json({ data }, { headers: HEADERS });
  } catch (error) {
    return actorFailure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, actor } = await context();
    if (!canManageNvrs(actor.role)) return safeError(403, 'NVR_MANAGEMENT_FORBIDDEN');
    const body: unknown = await request.json().catch(() => null);
    const candidateId = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>).id : null;
    const id = typeof candidateId === 'string' ? candidateId : '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return safeError(400, 'INVALID_NVR_METADATA');
    const { data, error } = await supabase.from('nvr_connections').delete().eq('id', id).eq('company_id', actor.companyId).select('id').maybeSingle();
    if (error) return safeError(409, 'NVR_IN_USE');
    if (!data) return safeError(404, 'NVR_NOT_FOUND');
    return NextResponse.json({ data: { deleted: true } }, { headers: HEADERS });
  } catch (error) {
    return actorFailure(error);
  }
}
