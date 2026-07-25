import {
  parseCameraInspectionV1,
  type CameraInspectionObservation,
} from '../camera-inspection-v1.ts';
import {
  parseVisionSkillResult,
  type VisionSkill,
  type VisionSkillInput,
  type VisionSkillMetadata,
  type VisionSkillName,
  type VisionSkillObservation,
  type VisionSkillRecommendation,
  type VisionSkillResult,
  type VisionSkillScalar,
} from './contracts.ts';

export type VisionSkillDraft = {
  confidence: number;
  observations: VisionSkillObservation[];
  recommendations: VisionSkillRecommendation[];
  warnings?: string[];
  metadata?: VisionSkillMetadata;
};

export abstract class BaseVisionSkill implements VisionSkill {
  abstract readonly name: VisionSkillName;
  readonly version = '1.0.0';

  protected abstract evaluate(input: VisionSkillInput): VisionSkillDraft;

  execute(input: VisionSkillInput): VisionSkillResult {
    if (!parseCameraInspectionV1(input.inspection)) {
      throw new Error('VISION_SKILL_INSPECTION_INVALID');
    }
    const draft = this.evaluate(input);
    const result = parseVisionSkillResult({
      skillVersion: this.version,
      skillName: this.name,
      confidence: this.normalizeConfidence(draft.confidence),
      observations: draft.observations,
      recommendations: draft.recommendations,
      warnings: [...new Set(draft.warnings ?? [])],
      metadata: {
        snapshotId: input.snapshot.id,
        cameraId: input.camera.id,
        companyId: input.company.id,
        locationId: input.location.id,
        inspectionId: input.context.inspectionId,
        advisoryOnly: true,
        ...draft.metadata,
      },
    });
    if (!result) throw new Error('VISION_SKILL_RESULT_INVALID');
    return result;
  }

  protected observed(
    type: string,
    value: VisionSkillScalar,
    description: string,
    confidence: number,
    requiresHumanReview = false,
  ): VisionSkillObservation {
    return {
      type,
      value,
      description,
      confidence: this.normalizeConfidence(confidence),
      state: 'observed',
      requiresHumanReview,
    };
  }

  protected unknown(type: string, description: string): VisionSkillObservation {
    return {
      type,
      value: 'unknown',
      description,
      confidence: 0,
      state: 'unknown',
      requiresHumanReview: false,
    };
  }

  protected advisory(code: string, description: string): VisionSkillRecommendation {
    return { code, description, advisory: true };
  }

  protected meanConfidence(observations: readonly VisionSkillObservation[]): number {
    const known = observations.filter((item) => item.state === 'observed');
    return known.length === 0
      ? 0
      : this.normalizeConfidence(known.reduce((sum, item) => sum + item.confidence, 0) / known.length);
  }

  protected readinessScore(values: readonly (number | null)[]): number | null {
    const known = values.filter((value): value is number => value !== null);
    return known.length === 0
      ? null
      : Math.round(known.reduce((sum, value) => sum + value, 0) / known.length * 100);
  }

  protected findInspectionObservation(
    input: VisionSkillInput,
    terms: readonly string[],
  ): CameraInspectionObservation | null {
    const lowered = terms.map((term) => term.toLowerCase());
    return [...input.inspection.observations]
      .filter((item) => {
        const content = `${item.type} ${item.description}`.toLowerCase();
        return lowered.some((term) => content.includes(term));
      })
      .sort((left, right) => right.confidence - left.confidence)[0] ?? null;
  }

  protected normalizeConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
  }
}
