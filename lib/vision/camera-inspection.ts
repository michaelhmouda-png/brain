import type { ActorRole } from '../brain/kernel/actor-context.ts';
import type {
  VisionErrorCode,
  VisionImageInput,
  VisionServiceResult,
} from './contracts.ts';
import {
  CAMERA_INSPECTION_VERSION,
  type CameraInspectionV1Result,
} from './camera-inspection-v1.ts';
import type { VisionService } from './service.ts';

export const CAMERA_INSPECTION_MANAGEMENT_ROLES = ['manager', 'owner', 'super_admin'] as const;

export type CameraInspectionApplicationError =
  | 'CAMERA_INSPECTION_FORBIDDEN'
  | 'CAMERA_INSPECTION_SNAPSHOT_NOT_FOUND'
  | 'CAMERA_INSPECTION_TENANT_MISMATCH'
  | 'CAMERA_INSPECTION_LOCATION_MISMATCH'
  | 'CAMERA_INSPECTION_STORAGE_UNAVAILABLE'
  | 'CAMERA_INSPECTION_PERSISTENCE_FAILED'
  | VisionErrorCode;

export type CameraInspectionActor = {
  profileId: string;
  companyId: string;
  role: ActorRole;
  correlationId: string;
};

export type CameraInspectionSnapshot = {
  id: string;
  companyId: string;
  locationId: string;
  gatewayId: string;
  nvrId: string;
  channelNumber: number;
  bucketId: 'camera-snapshots';
  storagePath: string;
  contentType: 'image/jpeg';
  byteSize: number;
  width: number;
  height: number;
  expiresAt: string;
};

export type CameraInspectionRecord = {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  inspectionVersion: typeof CAMERA_INSPECTION_VERSION;
  correlationId: string;
  model: string | null;
  result: CameraInspectionV1Result | null;
  warnings: string[];
  processingDurationMs: number | null;
  errorCode: CameraInspectionApplicationError | null;
  createdAt: string;
  completedAt: string | null;
};

export interface CameraInspectionAccess {
  loadAuthorizedSnapshot(snapshotId: string): Promise<CameraInspectionSnapshot | null>;
  locationIsAccessible(companyId: string, locationId: string): Promise<boolean>;
  loadSucceededForSnapshot?(
    snapshotId: string,
    companyId: string,
  ): Promise<CameraInspectionRecord | null>;
  createPending(input: {
    actor: CameraInspectionActor;
    snapshot: CameraInspectionSnapshot;
  }): Promise<CameraInspectionRecord>;
  downloadPrivateSnapshot(snapshot: CameraInspectionSnapshot): Promise<VisionImageInput>;
  complete(input: {
    inspectionId: string;
    companyId: string;
    result: CameraInspectionV1Result;
    model: string;
    warnings: string[];
    processingDurationMs: number;
  }): Promise<CameraInspectionRecord>;
  fail(input: {
    inspectionId: string;
    companyId: string;
    errorCode: CameraInspectionApplicationError;
    model: string | null;
    warnings: string[];
    processingDurationMs: number;
  }): Promise<CameraInspectionRecord>;
}

export type CameraInspectionExecution =
  | { ok: true; inspection: CameraInspectionRecord }
  | {
      ok: false;
      errorCode: CameraInspectionApplicationError;
      correlationId: string;
      inspection: CameraInspectionRecord | null;
    };

export function canRunCameraInspection(role: ActorRole): boolean {
  return CAMERA_INSPECTION_MANAGEMENT_ROLES.some((allowed) => allowed === role);
}

async function persistFailure(
  access: CameraInspectionAccess,
  actor: CameraInspectionActor,
  inspectionId: string,
  errorCode: CameraInspectionApplicationError,
  result?: Pick<VisionServiceResult, 'model' | 'warnings' | 'processingDurationMs'>,
): Promise<CameraInspectionExecution> {
  try {
    const inspection = await access.fail({
      inspectionId,
      companyId: actor.companyId,
      errorCode,
      model: result?.model ?? null,
      warnings: result?.warnings ?? [],
      processingDurationMs: result?.processingDurationMs ?? 0,
    });
    return { ok: false, errorCode, correlationId: actor.correlationId, inspection };
  } catch {
    return {
      ok: false,
      errorCode: 'CAMERA_INSPECTION_PERSISTENCE_FAILED',
      correlationId: actor.correlationId,
      inspection: null,
    };
  }
}

export async function executeCameraInspection({
  actor,
  snapshotId,
  preloadedSnapshot,
  access,
  vision,
}: {
  actor: CameraInspectionActor;
  snapshotId: string;
  preloadedSnapshot?: CameraInspectionSnapshot;
  access: CameraInspectionAccess;
  vision: VisionService;
}): Promise<CameraInspectionExecution> {
  if (!canRunCameraInspection(actor.role)) {
    return {
      ok: false,
      errorCode: 'CAMERA_INSPECTION_FORBIDDEN',
      correlationId: actor.correlationId,
      inspection: null,
    };
  }

  const snapshot = preloadedSnapshot ?? await access.loadAuthorizedSnapshot(snapshotId);
  if (!snapshot) {
    return {
      ok: false,
      errorCode: 'CAMERA_INSPECTION_SNAPSHOT_NOT_FOUND',
      correlationId: actor.correlationId,
      inspection: null,
    };
  }
  if (snapshot.id !== snapshotId) {
    return {
      ok: false,
      errorCode: 'CAMERA_INSPECTION_SNAPSHOT_NOT_FOUND',
      correlationId: actor.correlationId,
      inspection: null,
    };
  }
  if (snapshot.companyId !== actor.companyId) {
    return {
      ok: false,
      errorCode: 'CAMERA_INSPECTION_TENANT_MISMATCH',
      correlationId: actor.correlationId,
      inspection: null,
    };
  }
  if (!await access.locationIsAccessible(actor.companyId, snapshot.locationId)) {
    return {
      ok: false,
      errorCode: 'CAMERA_INSPECTION_LOCATION_MISMATCH',
      correlationId: actor.correlationId,
      inspection: null,
    };
  }
  if (access.loadSucceededForSnapshot) {
    try {
      const existing = await access.loadSucceededForSnapshot(snapshot.id, actor.companyId);
      if (existing) return { ok: true, inspection: existing };
    } catch {
      return {
        ok: false,
        errorCode: 'CAMERA_INSPECTION_PERSISTENCE_FAILED',
        correlationId: actor.correlationId,
        inspection: null,
      };
    }
  }

  let pending: CameraInspectionRecord;
  try {
    pending = await access.createPending({ actor, snapshot });
  } catch {
    return {
      ok: false,
      errorCode: 'CAMERA_INSPECTION_PERSISTENCE_FAILED',
      correlationId: actor.correlationId,
      inspection: null,
    };
  }

  let image: VisionImageInput;
  try {
    image = await access.downloadPrivateSnapshot(snapshot);
  } catch {
    return persistFailure(
      access,
      actor,
      pending.id,
      'CAMERA_INSPECTION_STORAGE_UNAVAILABLE',
    );
  }

  const result = await vision.inspect({
    inspectionType: CAMERA_INSPECTION_VERSION,
    image,
    tenant: {
      companyId: actor.companyId,
      locationId: snapshot.locationId,
      correlationId: actor.correlationId,
    },
    domainContext: {
      channelNumber: snapshot.channelNumber,
      imageWidth: snapshot.width,
      imageHeight: snapshot.height,
    },
  });

  if (!result.ok) {
    return persistFailure(access, actor, pending.id, result.errorCode, result);
  }

  try {
    const inspection = await access.complete({
      inspectionId: pending.id,
      companyId: actor.companyId,
      result: result.result,
      model: result.model,
      warnings: result.warnings,
      processingDurationMs: result.processingDurationMs,
    });
    return { ok: true, inspection };
  } catch {
    return persistFailure(
      access,
      actor,
      pending.id,
      'CAMERA_INSPECTION_PERSISTENCE_FAILED',
      result,
    );
  }
}
