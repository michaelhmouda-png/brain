import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CAMERA_INSPECTION_V1_JSON_SCHEMA,
  CAMERA_INSPECTION_VERSION,
  parseCameraInspectionV1,
} from '../lib/vision/camera-inspection-v1.ts';
import { VisionProviderError } from '../lib/vision/contracts.ts';
import {
  executeCameraInspection,
} from '../lib/vision/camera-inspection.ts';
import { createVisionService } from '../lib/vision/service.ts';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/202607250001_vision_service_camera_inspection_v1.sql');
const route = read('app/api/cameras/inspections/route.ts');
const infrastructure = read('lib/vision/camera-inspection-infrastructure.server.ts');
const openAiAdapter = read('lib/vision/providers/openai-vision.server.ts');
const taskEvidenceWorker = read('lib/task-evidence-verification.server.ts');
const id = () => crypto.randomUUID();

const jpegFixture = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  0x11, 0x22,
  0xff, 0xd9,
]);

function validResult(overrides = {}) {
  return {
    inspection_version: CAMERA_INSPECTION_VERSION,
    scene: {
      summary: 'A dining area is visible.',
      venue_state: 'unknown',
      lighting_state: 'on',
      confidence: 0.8,
    },
    people: {
      visible_count: 2,
      staff_likely_count: 1,
      customer_likely_count: 0,
      classification_confidence: 0.4,
      notes: 'One person is near a service area; role is uncertain.',
    },
    operations: {
      tables_state: 'partially_clean',
      bar_state: 'not_visible',
      floor_state: 'clear',
      entrance_state: 'not_visible',
      confidence: 0.65,
    },
    safety: {
      hazards_detected: [],
      requires_human_review: false,
      confidence: 0.7,
    },
    observations: [{
      type: 'lighting',
      description: 'Overhead lighting is visible.',
      confidence: 0.9,
    }],
    limitations: ['The entrance is outside the frame.'],
    ...overrides,
  };
}

function actor(overrides = {}) {
  return {
    profileId: id(),
    companyId: id(),
    role: 'owner',
    correlationId: id(),
    ...overrides,
  };
}

function snapshot(actorValue, overrides = {}) {
  return {
    id: id(),
    companyId: actorValue.companyId,
    locationId: id(),
    gatewayId: id(),
    nvrId: id(),
    channelNumber: 1,
    bucketId: 'camera-snapshots',
    storagePath: 'private/path.jpg',
    contentType: 'image/jpeg',
    byteSize: jpegFixture.byteLength,
    width: 3,
    height: 2,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function pendingRecord(actorValue) {
  return {
    id: id(),
    status: 'pending',
    inspectionVersion: CAMERA_INSPECTION_VERSION,
    correlationId: actorValue.correlationId,
    model: null,
    result: null,
    warnings: [],
    processingDurationMs: null,
    errorCode: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

function harness({
  actorValue = actor(),
  snapshotValue,
  locationAccessible = true,
  storageFailure = false,
  provider,
} = {}) {
  const selectedSnapshot = snapshotValue === undefined ? snapshot(actorValue) : snapshotValue;
  const calls = {
    load: 0,
    location: 0,
    create: 0,
    download: 0,
    complete: [],
    fail: [],
    provider: [],
  };
  let pending = pendingRecord(actorValue);
  const access = {
    async loadAuthorizedSnapshot() {
      calls.load += 1;
      return selectedSnapshot;
    },
    async locationIsAccessible() {
      calls.location += 1;
      return locationAccessible;
    },
    async createPending() {
      calls.create += 1;
      return pending;
    },
    async downloadPrivateSnapshot() {
      calls.download += 1;
      if (storageFailure) throw new Error('storage unavailable');
      return { bytes: jpegFixture, mimeType: 'image/jpeg', width: 3, height: 2 };
    },
    async complete(input) {
      calls.complete.push(input);
      return {
        ...pending,
        status: 'succeeded',
        model: input.model,
        result: input.result,
        warnings: input.warnings,
        processingDurationMs: input.processingDurationMs,
        completedAt: new Date().toISOString(),
      };
    },
    async fail(input) {
      calls.fail.push(input);
      return {
        ...pending,
        status: 'failed',
        model: input.model,
        warnings: input.warnings,
        processingDurationMs: input.processingDurationMs,
        errorCode: input.errorCode,
        completedAt: new Date().toISOString(),
      };
    },
  };
  const selectedProvider = provider ?? {
    async inspect(request) {
      calls.provider.push(request);
      return { rawResult: validResult(), model: 'mock-vision-model', warnings: [] };
    },
  };
  let tick = 0;
  const vision = createVisionService({
    provider: selectedProvider,
    now: () => {
      tick += 10;
      return tick;
    },
  });
  return { actorValue, selectedSnapshot, access, vision, calls };
}

test('camera_inspection_v1 accepts the exact valid schema', () => {
  assert.deepEqual(parseCameraInspectionV1(validResult()), validResult());
  assert.equal(CAMERA_INSPECTION_V1_JSON_SCHEMA.additionalProperties, false);
  assert.equal(CAMERA_INSPECTION_V1_JSON_SCHEMA.properties.scene.additionalProperties, false);
  assert.equal(CAMERA_INSPECTION_V1_JSON_SCHEMA.properties.people.additionalProperties, false);
});

test('schema rejects extra properties, invalid confidence, and excessive arrays', () => {
  assert.equal(parseCameraInspectionV1({ ...validResult(), extra: true }), null);
  assert.equal(parseCameraInspectionV1({
    ...validResult(),
    scene: { ...validResult().scene, confidence: 1.01 },
  }), null);
  assert.equal(parseCameraInspectionV1({
    ...validResult(),
    observations: Array.from({ length: 21 }, (_, index) => ({
      type: `item_${index}`,
      description: 'Visible item.',
      confidence: 0.5,
    })),
  }), null);
});

test('schema rejects identity and sensitive-trait claims', () => {
  assert.equal(parseCameraInspectionV1({
    ...validResult(),
    scene: { ...validResult().scene, summary: 'The employee is named Alex.' },
  }), null);
  assert.equal(parseCameraInspectionV1({
    ...validResult(),
    people: { ...validResult().people, notes: 'A person appears female.' },
  }), null);
});

test('employee authorization fails before snapshot or provider access', async () => {
  const actorValue = actor({ role: 'employee' });
  const run = harness({ actorValue });
  const result = await executeCameraInspection({
    actor: actorValue,
    snapshotId: id(),
    access: run.access,
    vision: run.vision,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'CAMERA_INSPECTION_FORBIDDEN');
  assert.equal(run.calls.load, 0);
  assert.equal(run.calls.download, 0);
  assert.equal(run.calls.provider.length, 0);
});

test('snapshot not found returns a safe failure without persistence', async () => {
  const run = harness({ snapshotValue: null });
  const result = await executeCameraInspection({
    actor: run.actorValue,
    snapshotId: id(),
    access: run.access,
    vision: run.vision,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'CAMERA_INSPECTION_SNAPSHOT_NOT_FOUND');
  assert.equal(run.calls.create, 0);
});

test('tenant and location mismatches fail before storage retrieval', async () => {
  const tenantRun = harness();
  tenantRun.selectedSnapshot.companyId = id();
  const tenantResult = await executeCameraInspection({
    actor: tenantRun.actorValue,
    snapshotId: tenantRun.selectedSnapshot.id,
    access: tenantRun.access,
    vision: tenantRun.vision,
  });
  assert.equal(tenantResult.ok, false);
  assert.equal(tenantResult.errorCode, 'CAMERA_INSPECTION_TENANT_MISMATCH');
  assert.equal(tenantRun.calls.download, 0);

  const locationRun = harness({ locationAccessible: false });
  const locationResult = await executeCameraInspection({
    actor: locationRun.actorValue,
    snapshotId: locationRun.selectedSnapshot.id,
    access: locationRun.access,
    vision: locationRun.vision,
  });
  assert.equal(locationResult.ok, false);
  assert.equal(locationResult.errorCode, 'CAMERA_INSPECTION_LOCATION_MISMATCH');
  assert.equal(locationRun.calls.download, 0);
});

test('private storage retrieval failure is persisted as failed', async () => {
  const run = harness({ storageFailure: true });
  const result = await executeCameraInspection({
    actor: run.actorValue,
    snapshotId: run.selectedSnapshot.id,
    access: run.access,
    vision: run.vision,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'CAMERA_INSPECTION_STORAGE_UNAVAILABLE');
  assert.equal(run.calls.create, 1);
  assert.equal(run.calls.fail.length, 1);
  assert.equal(run.calls.fail[0].errorCode, 'CAMERA_INSPECTION_STORAGE_UNAVAILABLE');
  assert.equal(run.calls.provider.length, 0);
});

test('malformed provider output fails closed and persists normalized failure', async () => {
  const run = harness({
    provider: {
      async inspect() {
        return {
          rawResult: { ...validResult(), extra: 'not allowed' },
          model: 'mock-vision-model',
          warnings: [],
        };
      },
    },
  });
  const result = await executeCameraInspection({
    actor: run.actorValue,
    snapshotId: run.selectedSnapshot.id,
    access: run.access,
    vision: run.vision,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'VISION_MALFORMED_OUTPUT');
  assert.equal(run.calls.fail.length, 1);
  assert.equal(run.calls.fail[0].errorCode, 'VISION_MALFORMED_OUTPUT');
  assert.equal(run.calls.complete.length, 0);
});

test('provider timeout is normalized and persisted without retry', async () => {
  let attempts = 0;
  const run = harness({
    provider: {
      async inspect() {
        attempts += 1;
        throw new VisionProviderError('VISION_PROVIDER_TIMEOUT', 'mock-vision-model');
      },
    },
  });
  const result = await executeCameraInspection({
    actor: run.actorValue,
    snapshotId: run.selectedSnapshot.id,
    access: run.access,
    vision: run.vision,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'VISION_PROVIDER_TIMEOUT');
  assert.equal(attempts, 1);
  assert.equal(run.calls.fail[0].errorCode, 'VISION_PROVIDER_TIMEOUT');
});

test('validated result and correlation ID are propagated to success persistence', async () => {
  const run = harness();
  const result = await executeCameraInspection({
    actor: run.actorValue,
    snapshotId: run.selectedSnapshot.id,
    access: run.access,
    vision: run.vision,
  });
  assert.equal(result.ok, true);
  assert.equal(result.inspection.status, 'succeeded');
  assert.equal(run.calls.complete.length, 1);
  assert.deepEqual(run.calls.complete[0].result, validResult());
  assert.equal(run.calls.provider[0].tenant.correlationId, run.actorValue.correlationId);
  assert.equal(result.inspection.correlationId, run.actorValue.correlationId);
  assert.equal(run.calls.fail.length, 0);
});

test('API and infrastructure never accept image URLs, expose signed URLs, or contact an NVR', () => {
  assert.match(route, /resolveActorContext/);
  assert.match(route, /canRunCameraInspection\(actor\.role\)/);
  assert.match(route, /snapshotId/);
  assert.doesNotMatch(route, /imageUrl|signedUrl|storagePath|local_host|device_commands|snapshot_request|fetch\(['"]https?:/i);
  assert.match(infrastructure, /\.storage[\s\S]*\.download\(snapshot\.storagePath\)/);
  assert.doesNotMatch(infrastructure, /createSignedUrl|local_host|device_commands|snapshot_request|agent/i);
  assert.match(openAiAdapter, /store:\s*false/);
  assert.match(openAiAdapter, /maxRetries:\s*0/);
  assert.doesNotMatch(openAiAdapter, /console\.|signedUrl|storagePath|credential/i);
});

test('migration enforces tenant context, management reads, server writes, and terminal consistency', () => {
  assert.match(migration, /^--[\s\S]*\bBEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /CREATE TABLE public\.camera_inspections/);
  assert.match(migration, /UNIQUE \(snapshot_artifact_id, inspection_version\)/);
  assert.match(migration, /inspection_version = 'camera_inspection_v1'/);
  assert.match(migration, /status IN \('pending','succeeded','failed'\)/);
  assert.match(migration, /status = 'succeeded'[\s\S]*result IS NOT NULL/);
  assert.match(migration, /status = 'failed'[\s\S]*error_code IS NOT NULL/);
  assert.match(migration, /artifact\.company_id = NEW\.company_id[\s\S]*artifact\.location_id = NEW\.location_id[\s\S]*artifact\.nvr_connection_id = NEW\.nvr_connection_id[\s\S]*artifact\.gateway_id = NEW\.gateway_id/);
  assert.match(migration, /profile\.role IN \('manager','owner','super_admin'\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /private\.can_view_camera_manager\(camera_inspections\.company_id\)/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.camera_inspections TO authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.camera_inspections TO service_role/);
  assert.doesNotMatch(migration, /GRANT (?:ALL|DELETE|TRUNCATE)/);
});

test('existing task-evidence vision worker remains unchanged and separate', () => {
  assert.match(taskEvidenceWorker, /processOneEvidenceVerification/);
  assert.match(taskEvidenceWorker, /task_evidence_verification/);
  assert.doesNotMatch(taskEvidenceWorker, /camera_inspection_v1|createServerVisionService/);
});
