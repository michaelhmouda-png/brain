import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  validateTimelineEventInput,
} from '../lib/brain/timeline/contracts.ts';
import {
  TimelineEventTypeRegistry,
  timelineEventTypeRegistry,
} from '../lib/brain/timeline/event-type-registry.ts';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/202607250003_brain_timeline_foundation_v1.sql');
const route = read('app/api/brain/timeline/route.ts');
const skillRoute = read('app/api/cameras/skills/route.ts');
const persistence = read('lib/brain/timeline/persistence.server.ts');
const retrieval = read('lib/brain/timeline/retrieval.server.ts');
const timelineService = read('lib/brain/timeline/service.server.ts');
const visionIntegration = read('lib/brain/timeline/vision-skill-integration.server.ts');
const page = read('app/dashboard/timeline/page.tsx');
const id = () => crypto.randomUUID();

function eventInput(overrides = {}) {
  return {
    tenant: {
      companyId: id(),
      locationId: id(),
      actorProfileId: id(),
    },
    eventType: 'vision.opening_readiness',
    sourceType: 'vision_skill',
    sourceId: id(),
    title: 'Opening Readiness observation',
    summary: 'A service counter is visible.',
    severity: 'info',
    confidence: 0.75,
    occurredAt: new Date().toISOString(),
    correlationId: id(),
    metadata: {
      skillName: 'opening_readiness',
      skillVersion: '1.0.0',
      recommendationCodes: ['VERIFY_POS_POWER'],
      advisoryOnly: true,
    },
    observations: [{
      observationType: 'opening.pos_power',
      value: 'unknown',
      description: 'The power state is not reliable.',
      confidence: 0,
      state: 'unknown',
      requiresHumanReview: false,
    }],
    ...overrides,
  };
}

test('migration creates shared event and observation tables rather than a camera-only history', () => {
  assert.match(migration, /CREATE TABLE public\.brain_timeline_events/);
  assert.match(migration, /CREATE TABLE public\.brain_observations/);
  assert.doesNotMatch(migration, /camera_timeline|vision_timeline/);
  for (const source of ['task', 'shift', 'maintenance', 'inventory', 'incident', 'integration']) {
    assert.match(read('lib/brain/timeline/contracts.ts'), new RegExp(`'${source}'`));
  }
});

test('database enforces forced RLS, management-only reads, and server-only writes', () => {
  assert.equal((migration.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length, 2);
  assert.match(migration, /private\.can_view_camera_manager\(brain_timeline_events\.company_id\)/);
  assert.match(migration, /FOR SELECT TO authenticated/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.brain_timeline_events FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.brain_timeline_events TO authenticated/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE)[^;]+authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.persist_brain_timeline_event[\s\S]+TO service_role/);
  assert.match(persistence, /^import 'server-only';/);
});

test('tenant and location relationships are validated for events and observations', () => {
  assert.match(migration, /location\.company_id = NEW\.company_id/);
  assert.match(migration, /profile\.company_id = NEW\.company_id/);
  assert.match(migration, /NEW\.company_id IS DISTINCT FROM v_event\.company_id/);
  assert.match(migration, /NEW\.location_id IS DISTINCT FROM v_event\.location_id/);
  assert.match(migration, /NEW\.source_type IS DISTINCT FROM v_event\.source_type/);
  assert.match(migration, /NEW\.source_id IS DISTINCT FROM v_event\.source_id/);
  assert.match(retrieval, /\.eq\('company_id', companyId\)/);
  assert.match(retrieval, /\.eq\('location_id', query\.locationId\)/);
});

test('Timeline tables are append-only with immutable source and tenant context', () => {
  assert.match(migration, /IF TG_OP IN \('UPDATE','DELETE'\)[\s\S]+BRAIN_TIMELINE_APPEND_ONLY/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON public\.brain_timeline_events/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON public\.brain_observations/);
  assert.doesNotMatch(migration, /ON DELETE CASCADE/);
});

test('confidence, state, metadata, and value bounds fail closed', () => {
  assert.match(migration, /confidence >= 0 AND confidence <= 1/g);
  assert.match(migration, /severity IN \('info','notice','warning','critical'\)/);
  assert.match(migration, /state IN \('observed','unknown'\)/);
  assert.match(migration, /octet_length\(metadata::text\) <= 8192/);
  assert.match(migration, /octet_length\(value::text\) <= 2048/);
  assert.throws(() => validateTimelineEventInput(eventInput({ confidence: 1.1 })), /BRAIN_TIMELINE_INPUT_INVALID/);
  assert.throws(() => validateTimelineEventInput(eventInput({
    observations: [{
      observationType: 'opening.pos_power',
      value: 'unknown',
      description: 'Unknown.',
      confidence: 0.4,
      state: 'unknown',
      requiresHumanReview: false,
    }],
  })), /BRAIN_TIMELINE_OBSERVATION_INVALID/);
});

test('event registry is reusable and contains every Vision Skill without switch dispatch', () => {
  assert.deepEqual(
    timelineEventTypeRegistry.list().map((item) => item.eventType),
    [
      'vision.opening_readiness',
      'vision.closing_readiness',
      'vision.cleanliness',
      'vision.safety',
      'vision.equipment',
    ],
  );
  const custom = new TimelineEventTypeRegistry()
    .register({ eventType: 'integration.example', sourceType: 'integration' });
  assert.equal(custom.get('integration.example').sourceType, 'integration');
  assert.doesNotMatch(read('lib/brain/timeline/event-type-registry.ts'), /\bswitch\s*\(/);
});

test('service persists one event and propagates correlation and observation results', () => {
  assert.match(timelineService, /^import 'server-only';/);
  assert.match(timelineService, /return persistence\.persist\(input\)/);
  assert.match(persistence, /p_correlation_id: safe\.correlationId/);
  assert.match(persistence, /p_observations: safe\.observations/);
  assert.match(persistence, /eventId: row\.event_id/);
  assert.match(persistence, /observationIds: row\.observation_ids/);
  assert.match(persistence, /deduplicated: row\.deduplicated/);
});

test('source deduplication is atomic and duplicate Vision execution returns existing IDs', () => {
  assert.match(migration, /brain_timeline_source_dedup_uidx/);
  assert.match(migration, /company_id, event_type, source_type, source_id/);
  assert.match(migration, /SELECT event\.\* INTO v_event[\s\S]+FOR UPDATE/);
  assert.match(migration, /EXCEPTION WHEN unique_violation/);
  assert.match(migration, /RETURN QUERY SELECT v_event\.id, v_observation_ids, true/);
  assert.match(migration, /BRAIN_TIMELINE_IDEMPOTENCY_CONFLICT/);
  assert.match(visionIntegration, /sourceId: input\.context\.inspectionId/);
});

test('Vision integration is opt-in, authorization-bound, and failed skills cannot persist', () => {
  assert.match(skillRoute, /persistTimeline: input\.persistTimeline === true/);
  assert.match(skillRoute, /if \(!canRunCameraInspection\(actor\.role\)\)/);
  assert.ok(skillRoute.indexOf('persistVisionSkillTimeline(') > skillRoute.indexOf('if (!execution.ok)'));
  assert.ok(skillRoute.indexOf('persistVisionSkillTimeline(') > skillRoute.indexOf('const skill ='));
  assert.match(read('components/camera-manager/CameraSkillControl.tsx'), /body: JSON\.stringify\(\{ snapshotId, skill: selected \}\)/);
  assert.doesNotMatch(read('components/camera-manager/CameraSkillControl.tsx'), /persistTimeline/);
});

test('Vision Timeline projection stores normalized safe metadata and no private artifacts', () => {
  assert.match(visionIntegration, /^import 'server-only';/);
  assert.match(visionIntegration, /sourceId: input\.context\.inspectionId/);
  assert.match(visionIntegration, /correlationId: input\.context\.correlationId/);
  assert.match(visionIntegration, /recommendationCodes: skill\.recommendations\.map/);
  assert.match(visionIntegration, /observations: skill\.observations\.map/);
  assert.doesNotMatch(visionIntegration, /signedUrl|storagePath|credential|password|image\/jpeg/i);
});

test('read API denies employees and supports bounded filters, date range, and cursor pagination', () => {
  assert.match(route, /\['manager', 'owner', 'super_admin'\]\.includes\(actor\.role\)/);
  assert.match(route, /BRAIN_TIMELINE_FORBIDDEN/);
  for (const filter of ['locationId', 'eventType', 'sourceType', 'severity', 'from', 'to', 'cursor', 'limit']) {
    assert.match(route, new RegExp(`'${filter}'`));
  }
  assert.match(retrieval, /\.order\('occurred_at', \{ ascending: false \}\)/);
  assert.match(retrieval, /query\.limit \+ 1/);
  assert.match(retrieval, /nextCursor/);
  assert.match(route, /Cache-Control': 'private, no-store/);
});

test('minimal management UI is read-only and expands normalized observations', () => {
  assert.match(page, /fetch\(`\/api\/brain\/timeline/);
  assert.match(page, /<details/);
  assert.match(page, /Human review/);
  assert.match(page, /Observations \(\{event\.observations\.length\}\)/);
  assert.doesNotMatch(page, /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/);
  assert.doesNotMatch(page, /edit|delete/i);
});

test('migration and application do not create tasks, alerts, notifications, or Brain Score effects', () => {
  const sources = [
    migration,
    skillRoute,
    read('lib/brain/timeline/vision-skill-integration.server.ts'),
  ].join('\n');
  assert.doesNotMatch(sources, /INSERT INTO public\.(?:tasks|notifications|notification_outbox)/i);
  assert.doesNotMatch(sources, /brainScore|snapshot_request|device_commands|createSignedUrl/i);
});
