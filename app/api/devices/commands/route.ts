import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { agentManagementActorFailure } from '@/lib/brain-agent/management-auth.server';
import { isUuid } from '@/lib/brain-agent/contracts';
import { parseDeviceCommandEnqueue } from '@/lib/brain-agent/command-contracts';
import { enqueueDeviceCommand, readDeviceCommand } from '@/lib/brain-agent/command-transport.server';
import { canViewCameraManager } from '@/lib/camera-manager';
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
    if (!canViewCameraManager(actor.role)) return failure('DEVICE_COMMAND_FORBIDDEN', 403);
    const input = parseDeviceCommandEnqueue(await request.json().catch(() => null));
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
    const id = new URL(request.url).searchParams.get('id');
    if (!isUuid(id)) return failure('DEVICE_COMMAND_INVALID', 400);
    const result = await readDeviceCommand(client, id);
    if (result.unavailable) return failure('DEVICE_COMMAND_UNAVAILABLE', 503);
    if (!result.command) return failure('DEVICE_COMMAND_NOT_FOUND', 404);
    return NextResponse.json({ data: result.command }, { headers: HEADERS });
  } catch (error) {
    return agentManagementActorFailure(error, 'DEVICE_COMMAND_UNAVAILABLE');
  }
}
