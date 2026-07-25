import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { isUuid } from '@/lib/brain-agent/contracts';
import {
  canRunCameraInspection,
  executeCameraInspection,
  type CameraInspectionRecord,
} from '@/lib/vision/camera-inspection';
import { createCameraInspectionAccess } from '@/lib/vision/camera-inspection-infrastructure.server';
import {
  isVisionSkillName,
  type VisionSkillName,
} from '@/lib/vision/skills/contracts';
import { loadVisionSkillEntities } from '@/lib/vision/skills/context.server';
import { createVisionSkillService } from '@/lib/vision/skills/service';
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
  NextResponse.json(data ? { error: code, data } : { error: code }, { status, headers: HEADERS });

function parseRequest(value: unknown): { snapshotId: string; skill: VisionSkillName } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'skill,snapshotId'
      || !isUuid(input.snapshotId)
      || !isVisionSkillName(input.skill)) return null;
  return { snapshotId: input.snapshotId, skill: input.skill };
}

function safeInspection(inspection: CameraInspectionRecord) {
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

function actorFailure(error: unknown) {
  if (!(error instanceof ActorContextError)) return failure('CAMERA_SKILL_UNAVAILABLE', 503);
  if (error.code === 'UNAUTHENTICATED') return failure(error.code, 401);
  if (error.code === 'ACTOR_CONTEXT_UNAVAILABLE') return failure(error.code, 503);
  return failure(error.code, 403);
}

function inspectionFailureStatus(code: string): number {
  if (code === 'CAMERA_INSPECTION_FORBIDDEN') return 403;
  if (code === 'CAMERA_INSPECTION_SNAPSHOT_NOT_FOUND') return 404;
  if (code === 'CAMERA_INSPECTION_TENANT_MISMATCH'
      || code === 'CAMERA_INSPECTION_LOCATION_MISMATCH') return 403;
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
    if (!canRunCameraInspection(actor.role)) return failure('CAMERA_SKILL_FORBIDDEN', 403);
    const input = parseRequest(await request.json().catch(() => null));
    if (!input) return failure('CAMERA_SKILL_INVALID', 400);

    const access = createCameraInspectionAccess(authenticated, createSupabaseServer());
    const snapshot = await access.loadAuthorizedSnapshot(input.snapshotId);
    if (!snapshot) return failure('CAMERA_INSPECTION_SNAPSHOT_NOT_FOUND', 404);
    if (snapshot.companyId !== actor.companyId) return failure('CAMERA_INSPECTION_TENANT_MISMATCH', 403);
    const entities = await loadVisionSkillEntities(authenticated, actor.companyId, snapshot);
    if (!entities) return failure('CAMERA_SKILL_CONTEXT_UNAVAILABLE', 409);

    const execution = await executeCameraInspection({
      actor: {
        profileId: actor.profileId,
        companyId: actor.companyId,
        role: actor.role,
        correlationId: actor.correlationId,
      },
      snapshotId: input.snapshotId,
      preloadedSnapshot: snapshot,
      access,
      vision: createServerVisionService(),
    });
    if (!execution.ok) {
      return failure(
        execution.errorCode,
        inspectionFailureStatus(execution.errorCode),
        execution.inspection
          ? safeInspection(execution.inspection)
          : { correlationId: execution.correlationId },
      );
    }
    if (!execution.inspection.result || !execution.inspection.model) {
      return failure('CAMERA_SKILL_INSPECTION_INVALID', 503);
    }

    const skill = createVisionSkillService().execute({
      skill: input.skill,
      data: {
        inspection: execution.inspection.result,
        snapshot: {
          id: snapshot.id,
          channelNumber: snapshot.channelNumber,
          byteSize: snapshot.byteSize,
          width: snapshot.width,
          height: snapshot.height,
          expiresAt: snapshot.expiresAt,
        },
        ...entities,
        context: {
          correlationId: actor.correlationId,
          inspectionId: execution.inspection.id,
          inspectionModel: execution.inspection.model,
          requestedAt: new Date().toISOString(),
        },
      },
    });
    return NextResponse.json({
      data: {
        inspection: safeInspection(execution.inspection),
        skill,
      },
    }, { headers: HEADERS });
  } catch (error) {
    return actorFailure(error);
  }
}
