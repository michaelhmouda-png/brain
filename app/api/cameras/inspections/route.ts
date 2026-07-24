import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { isUuid } from '@/lib/brain-agent/contracts';
import { CAMERA_INSPECTION_VERSION } from '@/lib/vision/camera-inspection-v1';
import {
  canRunCameraInspection,
  executeCameraInspection,
  type CameraInspectionRecord,
} from '@/lib/vision/camera-inspection';
import { createCameraInspectionAccess } from '@/lib/vision/camera-inspection-infrastructure.server';
import { createServerVisionService } from '@/lib/vision/service.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization',
};

const failure = (code: string, status: number, data?: Record<string, unknown>) =>
  NextResponse.json(
    data ? { error: code, data } : { error: code },
    { status, headers: HEADERS },
  );

function actorFailure(error: unknown) {
  if (!(error instanceof ActorContextError)) return failure('CAMERA_INSPECTION_UNAVAILABLE', 503);
  if (error.code === 'UNAUTHENTICATED') return failure(error.code, 401);
  if (error.code === 'ACTOR_CONTEXT_UNAVAILABLE') return failure(error.code, 503);
  return failure(error.code, 403);
}

function parseRequest(value: unknown): {
  snapshotId: string;
  inspectionVersion: typeof CAMERA_INSPECTION_VERSION;
} | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'inspectionVersion,snapshotId'
      || !isUuid(input.snapshotId)
      || input.inspectionVersion !== CAMERA_INSPECTION_VERSION) return null;
  return {
    snapshotId: input.snapshotId,
    inspectionVersion: CAMERA_INSPECTION_VERSION,
  };
}

function safeRecord(inspection: CameraInspectionRecord) {
  return {
    inspectionId: inspection.id,
    status: inspection.status,
    inspectionVersion: inspection.inspectionVersion,
    model: inspection.model,
    result: inspection.result,
    warnings: inspection.warnings,
    processingDurationMs: inspection.processingDurationMs,
    errorCode: inspection.errorCode,
    correlationId: inspection.correlationId,
    createdAt: inspection.createdAt,
    completedAt: inspection.completedAt,
  };
}

function failureStatus(code: string): number {
  if (code === 'CAMERA_INSPECTION_FORBIDDEN') return 403;
  if (code === 'CAMERA_INSPECTION_SNAPSHOT_NOT_FOUND') return 404;
  if (code === 'CAMERA_INSPECTION_TENANT_MISMATCH'
      || code === 'CAMERA_INSPECTION_LOCATION_MISMATCH') return 403;
  if (code === 'VISION_CONFIGURATION_UNAVAILABLE') return 503;
  if (code === 'VISION_PROVIDER_TIMEOUT') return 504;
  if (code === 'VISION_PROVIDER_REFUSED'
      || code === 'VISION_MALFORMED_OUTPUT'
      || code === 'VISION_OUTPUT_POLICY_VIOLATION'
      || code === 'VISION_IMAGE_INVALID') return 422;
  return 503;
}

export async function POST(request: Request) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canRunCameraInspection(actor.role)) return failure('CAMERA_INSPECTION_FORBIDDEN', 403);
    const input = parseRequest(await request.json().catch(() => null));
    if (!input) return failure('CAMERA_INSPECTION_INVALID', 400);

    const execution = await executeCameraInspection({
      actor: {
        profileId: actor.profileId,
        companyId: actor.companyId,
        role: actor.role,
        correlationId: actor.correlationId,
      },
      snapshotId: input.snapshotId,
      access: createCameraInspectionAccess(authenticated, createSupabaseServer()),
      vision: createServerVisionService(),
    });

    if (!execution.ok) {
      return failure(
        execution.errorCode,
        failureStatus(execution.errorCode),
        execution.inspection
          ? safeRecord(execution.inspection)
          : { correlationId: execution.correlationId },
      );
    }
    return NextResponse.json({ data: safeRecord(execution.inspection) }, { headers: HEADERS });
  } catch (error) {
    return actorFailure(error);
  }
}
