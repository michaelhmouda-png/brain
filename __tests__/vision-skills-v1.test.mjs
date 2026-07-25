import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executeCameraInspection } from '../lib/vision/camera-inspection.ts';
import {
  CAMERA_INSPECTION_VERSION,
} from '../lib/vision/camera-inspection-v1.ts';
import { createVisionService } from '../lib/vision/service.ts';
import {
  parseVisionSkillResult,
  VISION_SKILL_NAMES,
} from '../lib/vision/skills/contracts.ts';
import {
  createVisionSkillRegistry,
  VisionSkillRegistry,
} from '../lib/vision/skills/registry.ts';
import { createVisionSkillService } from '../lib/vision/skills/service.ts';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const route = read('app/api/cameras/skills/route.ts');
const contextAccess = read('lib/vision/skills/context.server.ts');
const registrySource = read('lib/vision/skills/registry.ts');
const skillSources = [
  read('lib/vision/skills/base-skill.ts'),
  read('lib/vision/skills/built-in-skills.ts'),
  read('lib/vision/skills/service.ts'),
].join('\n');
const control = read('components/camera-manager/CameraSkillControl.tsx');
const snapshotControl = read('components/camera-manager/CameraSnapshotControl.tsx');
const id = () => crypto.randomUUID();

const jpegFixture = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  0x11, 0x22,
  0xff, 0xd9,
]);

function inspection(overrides = {}) {
  return {
    inspection_version: CAMERA_INSPECTION_VERSION,
    scene: {
      summary: 'A service area is visible.',
      venue_state: 'preparing',
      lighting_state: 'on',
      confidence: 0.9,
    },
    people: {
      visible_count: 0,
      staff_likely_count: 0,
      customer_likely_count: 0,
      classification_confidence: 0.8,
      notes: 'No people are visible.',
    },
    operations: {
      tables_state: 'clean',
      bar_state: 'ready',
      floor_state: 'clear',
      entrance_state: 'closed',
      confidence: 0.85,
    },
    safety: {
      hazards_detected: [],
      requires_human_review: false,
      confidence: 0.8,
    },
    observations: [{
      type: 'pos_display',
      description: 'A POS display appears powered on.',
      confidence: 0.88,
    }],
    limitations: ['Chair placement is outside the frame.'],
    ...overrides,
  };
}

function skillInput(result = inspection()) {
  return {
    inspection: result,
    snapshot: {
      id: id(),
      channelNumber: 1,
      byteSize: jpegFixture.byteLength,
      width: 3,
      height: 2,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    company: { id: id(), name: 'Example Company', timezone: 'Asia/Beirut' },
    location: { id: id(), name: 'Example Location' },
    camera: {
      id: id(),
      name: 'Camera 1',
      area: 'Bar',
      department: 'Operations',
      status: 'online',
    },
    context: {
      correlationId: id(),
      inspectionId: id(),
      inspectionModel: 'mock-vision-model',
      requestedAt: new Date().toISOString(),
    },
  };
}

test('registry exposes exactly five built-in skills without switch dispatch', () => {
  const registry = createVisionSkillRegistry();
  assert.deepEqual(registry.list(), VISION_SKILL_NAMES);
  for (const name of VISION_SKILL_NAMES) assert.equal(registry.get(name).name, name);
  assert.doesNotMatch(registrySource, /\bswitch\s*\(/);
  assert.match(registrySource, /\.register\(new OpeningReadinessSkill\(\)\)/);
});

test('future skills require one registration and duplicate names fail closed', () => {
  const registry = new VisionSkillRegistry();
  const custom = {
    name: 'opening_readiness',
    version: '1.0.0',
    execute() {
      throw new Error('not executed');
    },
  };
  registry.register(custom);
  assert.equal(registry.get('opening_readiness'), custom);
  assert.throws(() => registry.register(custom), /VISION_SKILL_ALREADY_REGISTERED/);
});

test('all five skills return the normalized Timeline-ready contract', () => {
  const service = createVisionSkillService();
  for (const skill of VISION_SKILL_NAMES) {
    const result = service.execute({ skill, data: skillInput() });
    assert.deepEqual(parseVisionSkillResult(result), result);
    assert.equal(result.skillName, skill);
    assert.equal(result.skillVersion, '1.0.0');
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
    assert.ok(result.observations.length > 0);
    assert.ok(result.recommendations.every((item) => item.advisory === true));
    assert.equal(result.metadata.advisoryOnly, true);
  }
});

test('opening and closing readiness provide scores and advisory recommendations', () => {
  const service = createVisionSkillService();
  const opening = service.execute({ skill: 'opening_readiness', data: skillInput() });
  const closing = service.execute({ skill: 'closing_readiness', data: skillInput() });
  assert.equal(typeof opening.metadata.readinessScore, 'number');
  assert.ok(opening.observations.some((item) => item.type === 'opening.pos_power' && item.value === 'on'));
  assert.equal(typeof closing.metadata.readinessScore, 'number');
  assert.ok(closing.recommendations.some((item) => item.code === 'VERIFY_CLOSING_LIGHTS'));
});

test('unknown visual evidence stays unknown with zero signal confidence', () => {
  const unknownInspection = inspection({
    scene: {
      summary: 'Only a limited view is available.',
      venue_state: 'unknown',
      lighting_state: 'unknown',
      confidence: 0.2,
    },
    people: {
      visible_count: 0,
      staff_likely_count: 0,
      customer_likely_count: 0,
      classification_confidence: 0.1,
      notes: 'The view is insufficient.',
    },
    operations: {
      tables_state: 'not_visible',
      bar_state: 'not_visible',
      floor_state: 'not_visible',
      entrance_state: 'not_visible',
      confidence: 0.1,
    },
    safety: {
      hazards_detected: [],
      requires_human_review: true,
      confidence: 0.1,
    },
    observations: [],
  });
  const service = createVisionSkillService();
  const equipment = service.execute({ skill: 'equipment', data: skillInput(unknownInspection) });
  assert.equal(equipment.confidence, 0);
  assert.ok(equipment.observations.every((item) => item.state === 'unknown' && item.confidence === 0));
  assert.ok(equipment.warnings.includes('INSUFFICIENT_VISIBLE_EVIDENCE'));
});

test('result validation rejects bad confidence and non-advisory recommendations', () => {
  const valid = createVisionSkillService().execute({
    skill: 'cleanliness',
    data: skillInput(),
  });
  assert.equal(parseVisionSkillResult({ ...valid, confidence: 1.1 }), null);
  assert.equal(parseVisionSkillResult({
    ...valid,
    recommendations: [{ code: 'BAD', description: 'Do something.', advisory: false }],
  }), null);
  assert.equal(parseVisionSkillResult({
    ...valid,
    observations: [{ ...valid.observations[0], state: 'unknown', confidence: 0.5 }],
  }), null);
});

test('cleanliness and safety generate bounded advisory recommendations', () => {
  const dirty = inspection({
    operations: {
      tables_state: 'dirty',
      bar_state: 'not_ready',
      floor_state: 'cluttered',
      entrance_state: 'open',
      confidence: 0.9,
    },
    safety: {
      hazards_detected: [{
        type: 'trip_hazard',
        description: 'A visible item obstructs part of the floor.',
        confidence: 0.8,
      }],
      requires_human_review: true,
      confidence: 0.8,
    },
  });
  const service = createVisionSkillService();
  const cleanliness = service.execute({ skill: 'cleanliness', data: skillInput(dirty) });
  const safety = service.execute({ skill: 'safety', data: skillInput(dirty) });
  assert.ok(cleanliness.recommendations.some((item) => item.code === 'REVIEW_TABLE_CLEANLINESS'));
  assert.ok(cleanliness.recommendations.some((item) => item.code === 'REVIEW_FLOOR_CLEANLINESS'));
  assert.equal(safety.metadata.requiresHumanReview, true);
  assert.ok(safety.recommendations.some((item) => item.code === 'HUMAN_SAFETY_REVIEW'));
});

test('multiple manual skills reuse one inspection provider call and no skill owns a prompt', async () => {
  const actor = {
    profileId: id(),
    companyId: id(),
    role: 'owner',
    correlationId: id(),
  };
  const snapshot = {
    id: id(),
    companyId: actor.companyId,
    locationId: id(),
    gatewayId: id(),
    nvrId: id(),
    channelNumber: 1,
    bucketId: 'camera-snapshots',
    storagePath: 'private/snapshot.jpg',
    contentType: 'image/jpeg',
    byteSize: jpegFixture.byteLength,
    width: 3,
    height: 2,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  let providerCalls = 0;
  let loadCalls = 0;
  let storedInspection = null;
  const pending = {
    id: id(),
    status: 'pending',
    inspectionVersion: CAMERA_INSPECTION_VERSION,
    correlationId: actor.correlationId,
    model: null,
    result: null,
    warnings: [],
    processingDurationMs: null,
    errorCode: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  const access = {
    async loadAuthorizedSnapshot() {
      loadCalls += 1;
      return snapshot;
    },
    async locationIsAccessible() {
      return true;
    },
    async loadSucceededForSnapshot() {
      return storedInspection;
    },
    async createPending() {
      return pending;
    },
    async downloadPrivateSnapshot() {
      return { bytes: jpegFixture, mimeType: 'image/jpeg', width: 3, height: 2 };
    },
    async complete(input) {
      storedInspection = {
        ...pending,
        status: 'succeeded',
        model: input.model,
        result: input.result,
        processingDurationMs: input.processingDurationMs,
        completedAt: new Date().toISOString(),
      };
      return storedInspection;
    },
    async fail() {
      throw new Error('unexpected failure');
    },
  };
  const vision = createVisionService({
    provider: {
      async inspect() {
        providerCalls += 1;
        return { rawResult: inspection(), model: 'mock-vision-model', warnings: [] };
      },
    },
  });
  const execution = await executeCameraInspection({
    actor,
    snapshotId: snapshot.id,
    preloadedSnapshot: snapshot,
    access,
    vision,
  });
  assert.equal(execution.ok, true);
  assert.equal(providerCalls, 1);
  assert.equal(loadCalls, 0);
  if (!execution.ok) return;
  createVisionSkillService().execute({
    skill: 'opening_readiness',
    data: skillInput(execution.inspection.result),
  });
  const reused = await executeCameraInspection({
    actor,
    snapshotId: snapshot.id,
    preloadedSnapshot: snapshot,
    access,
    vision,
  });
  assert.equal(reused.ok, true);
  if (reused.ok) {
    createVisionSkillService().execute({
      skill: 'safety',
      data: skillInput(reused.inspection.result),
    });
  }
  assert.equal(providerCalls, 1);
  assert.doesNotMatch(skillSources, /OPENAI_|responses\.create|provider\.inspect|PROMPT/);
});

test('API authenticates management and validates snapshot, company, location, and camera ownership', () => {
  assert.match(route, /resolveActorContext\(authenticated\)/);
  assert.match(route, /canRunCameraInspection\(actor\.role\)/);
  assert.match(route, /snapshot\.companyId !== actor\.companyId/);
  assert.match(route, /loadVisionSkillEntities\(authenticated, actor\.companyId, snapshot\)/);
  assert.match(contextAccess, /\.eq\('company_id', companyId\)/);
  assert.match(contextAccess, /\.eq\('location_id', snapshot\.locationId\)/);
  assert.match(contextAccess, /\.eq\('nvr_connection_id', snapshot\.nvrId\)/);
  assert.match(contextAccess, /\.eq\('external_channel_id', String\(snapshot\.channelNumber\)\)/);
});

test('skills API and Camera Manager cannot request a snapshot or contact an NVR', () => {
  assert.doesNotMatch(route, /snapshot_request|device_commands|local_host|signedUrl|createSignedUrl|fetch\(['"]https?:/i);
  assert.doesNotMatch(contextAccess, /storage_path|local_host|credential|password|username/i);
  assert.match(control, /body: JSON\.stringify\(\{ snapshotId, skill: selected \}\)/);
  assert.match(snapshotControl, /CameraSkillControl snapshotId=\{access\.artifactId\}/);
  assert.doesNotMatch(control, /snapshot_request|gatewayId|nvrConnectionId|signedUrl|setInterval/i);
});

test('Camera Manager exposes one manual dropdown with all five registered skills', () => {
  assert.match(control, /VISION_SKILL_NAMES\.map/);
  assert.match(control, /opening_readiness: copy\.skillOpeningReadiness/);
  assert.match(control, /closing_readiness: copy\.skillClosingReadiness/);
  assert.match(control, /cleanliness: copy\.skillCleanliness/);
  assert.match(control, /safety: copy\.skillSafety/);
  assert.match(control, /equipment: copy\.skillEquipment/);
  assert.match(control, /onClick=\{\(\) => void runSkill\(\)\}/);
  assert.doesNotMatch(control, /useEffect|setInterval|automatic/i);
});
