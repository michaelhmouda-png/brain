import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { agentManagementActorFailure } from '@/lib/brain-agent/management-auth.server';
import { isUuid } from '@/lib/brain-agent/contracts';
import { parseDeviceCommandEnqueue, parseNvrProbeEnqueue, sanitizeNvrProbeControlState } from '@/lib/brain-agent/command-contracts';
import { enqueueDeviceCommand, enqueueNvrProbeCommand, readDeviceCommand, readNvrProbeControlState } from '@/lib/brain-agent/command-transport.server';
import { canManageNvrs, canViewCameraManager } from '@/lib/camera-manager';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization',
};

const failure = (code: string, status: number) =>
  NextResponse.json({ error: code }, { status, headers: HEADERS });

export async function POST(request: Request) {
  try {
    const client = await createSupabaseServerAuth();
    const actor = await resolveActorContext(client);
    const body: unknown = await request.json().catch(() => null);
    const commandType = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).commandType
      : null;
    if (commandType === 'nvr_capability_probe' || commandType === 'nvr_health_diagnostics') {
      if (!canManageNvrs(actor.role)) return failure('NVR_PROBE_FORBIDDEN', 403);
      const input = parseNvrProbeEnqueue(body);
      if (!input) return failure('NVR_PROBE_INVALID', 400);
      const result = await enqueueNvrProbeCommand(client, input);
      if (!result.command) {
        const unavailable = result.errorCode === 'NVR_PROBE_GATEWAY_OFFLINE'
          || result.errorCode === 'NVR_PROBE_CREDENTIALS_NOT_REPORTED'
          || result.errorCode === 'DEVICE_COMMAND_GATEWAY_UNAVAILABLE';
        return failure(result.errorCode ?? 'NVR_PROBE_NOT_ENQUEUED', unavailable ? 409 : 400);
      }
      return NextResponse.json({ data: { ...result.command, requestId: result.command.commandId } }, {
        status: result.command.duplicateRequest || result.command.duplicateActive ? 200 : 202,
        headers: HEADERS,
      });
    }
    if (!canViewCameraManager(actor.role)) return failure('DEVICE_COMMAND_FORBIDDEN', 403);
    const input = parseDeviceCommandEnqueue(body);
    if (!input) return failure('DEVICE_COMMAND_INVALID', 400);
    const command = await enqueueDeviceCommand(client, input);
    if (!command) return failure('DEVICE_COMMAND_NOT_ENQUEUED', 409);
    return NextResponse.json({ data: command }, {
      status: command.duplicateRequest ? 200 : 202,
      headers: HEADERS,
    });
  } catch (error) {
    return agentManagementActorFailure(error, 'DEVICE_COMMAND_UNAVAILABLE');
  }
}

export async function GET(request: Request) {
  try {
    const client = await createSupabaseServerAuth();
    const actor = await resolveActorContext(client);
    if (!canViewCameraManager(actor.role)) return failure('DEVICE_COMMAND_FORBIDDEN', 403);
    const searchParams = new URL(request.url).searchParams;
    const nvrConnectionId = searchParams.get('nvrConnectionId');
    if (nvrConnectionId !== null) {
      if (!canManageNvrs(actor.role)) return failure('NVR_PROBE_FORBIDDEN', 403);
      if (!isUuid(nvrConnectionId)) return failure('NVR_PROBE_INVALID', 400);
      const result = await readNvrProbeControlState(client, nvrConnectionId);
      if (result.unavailable) return failure('NVR_PROBE_STATE_UNAVAILABLE', 503);
      const state = sanitizeNvrProbeControlState(result.state);
      if (!state) return failure('NVR_PROBE_STATE_INVALID', 503);
      return NextResponse.json({ data: state }, { headers: HEADERS });
    }
    const id = searchParams.get('id');
    if (!isUuid(id)) return failure('DEVICE_COMMAND_INVALID', 400);
    const result = await readDeviceCommand(client, id);
    if (result.unavailable) return failure('DEVICE_COMMAND_UNAVAILABLE', 503);
    if (!result.command) return failure('DEVICE_COMMAND_NOT_FOUND', 404);
    return NextResponse.json({ data: result.command }, { headers: HEADERS });
  } catch (error) {
    return agentManagementActorFailure(error, 'DEVICE_COMMAND_UNAVAILABLE');
  }
}
