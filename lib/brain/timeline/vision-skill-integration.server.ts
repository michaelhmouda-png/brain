import 'server-only';

import type { ActorContext } from '@/lib/brain/kernel/actor-context';
import type { VisionSkillInput, VisionSkillResult } from '@/lib/vision/skills/contracts';
import type { TimelineEventInput, TimelineSeverity } from './contracts.ts';
import type { createTimelineService } from './service.server.ts';

const EVENT_BY_SKILL = {
  opening_readiness: 'vision.opening_readiness',
  closing_readiness: 'vision.closing_readiness',
  cleanliness: 'vision.cleanliness',
  safety: 'vision.safety',
  equipment: 'vision.equipment',
} as const;

function title(skill: VisionSkillResult): string {
  return skill.skillName.split('_').map((word) =>
    word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function severity(skill: VisionSkillResult): TimelineSeverity {
  if (skill.metadata.requiresHumanReview === true) return 'warning';
  if (skill.warnings.length > 0) return 'notice';
  return 'info';
}

export function visionSkillTimelineEvent(
  actor: ActorContext,
  input: VisionSkillInput,
  skill: VisionSkillResult,
): TimelineEventInput {
  return {
    tenant: {
      companyId: actor.companyId,
      locationId: input.location.id,
      actorProfileId: actor.profileId,
    },
    eventType: EVENT_BY_SKILL[skill.skillName],
    sourceType: 'vision_skill',
    sourceId: input.context.inspectionId,
    title: `${title(skill)} observation`,
    summary: input.inspection.scene.summary,
    severity: severity(skill),
    confidence: skill.confidence,
    occurredAt: input.context.requestedAt,
    correlationId: input.context.correlationId,
    metadata: {
      skillName: skill.skillName,
      skillVersion: skill.skillVersion,
      readinessScore: typeof skill.metadata.readinessScore === 'number'
        ? skill.metadata.readinessScore
        : null,
      warnings: skill.warnings,
      recommendationCodes: skill.recommendations.map((item) => item.code),
      advisoryOnly: true,
    },
    observations: skill.observations.map((item) => ({
      observationType: item.type,
      value: item.value,
      description: item.description,
      confidence: item.confidence,
      state: item.state,
      requiresHumanReview: item.requiresHumanReview,
    })),
  };
}

export async function persistVisionSkillTimeline(
  service: ReturnType<typeof createTimelineService>,
  actor: ActorContext,
  input: VisionSkillInput,
  skill: VisionSkillResult,
) {
  return service.record(visionSkillTimelineEvent(actor, input, skill));
}
