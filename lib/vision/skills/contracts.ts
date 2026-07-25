import type { CameraInspectionV1Result } from '../camera-inspection-v1.ts';

export const VISION_SKILL_NAMES = [
  'opening_readiness',
  'closing_readiness',
  'cleanliness',
  'safety',
  'equipment',
] as const;

export type VisionSkillName = (typeof VISION_SKILL_NAMES)[number];
export type VisionSkillScalar = string | number | boolean | null;
export type VisionSkillMetadata = Readonly<Record<string, VisionSkillScalar>>;

export type VisionSkillSnapshot = {
  id: string;
  channelNumber: number;
  byteSize: number;
  width: number;
  height: number;
  expiresAt: string;
};

export type VisionSkillCompany = {
  id: string;
  name: string;
  timezone: string;
};

export type VisionSkillLocation = {
  id: string;
  name: string;
};

export type VisionSkillCamera = {
  id: string;
  name: string;
  area: string | null;
  department: string | null;
  status: string;
};

export type VisionSkillExecutionContext = {
  correlationId: string;
  inspectionId: string;
  inspectionModel: string;
  requestedAt: string;
};

export type VisionSkillInput = {
  inspection: CameraInspectionV1Result;
  snapshot: VisionSkillSnapshot;
  company: VisionSkillCompany;
  location: VisionSkillLocation;
  camera: VisionSkillCamera;
  context: VisionSkillExecutionContext;
};

export type VisionSkillObservation = {
  type: string;
  value: VisionSkillScalar;
  description: string;
  confidence: number;
  state: 'observed' | 'unknown';
  requiresHumanReview: boolean;
};

export type VisionSkillRecommendation = {
  code: string;
  description: string;
  advisory: true;
};

export type VisionSkillResult = {
  skillVersion: string;
  skillName: VisionSkillName;
  confidence: number;
  observations: VisionSkillObservation[];
  recommendations: VisionSkillRecommendation[];
  warnings: string[];
  metadata: VisionSkillMetadata;
};

export interface VisionSkill {
  readonly name: VisionSkillName;
  readonly version: string;
  execute(input: VisionSkillInput): VisionSkillResult;
}

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const SAFE_VERSION = /^\d+\.\d+\.\d+$/;
const SAFE_TYPE = /^[a-z][a-z0-9_.]{0,79}$/;
const DISALLOWED_TEXT = [
  /\b(?:identified|recognized)\s+as\b/i,
  /\bface\s+recognition\b/i,
  /\b(?:race|ethnicity|religion|sexual orientation|political affiliation|medical condition|disability)\b/i,
  /\b(?:attendance|payroll|disciplinary)\b/i,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function safeText(value: unknown, maximum: number): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maximum
    && !DISALLOWED_TEXT.some((pattern) => pattern.test(value));
}

function scalar(value: unknown): value is VisionSkillScalar {
  return value === null
    || typeof value === 'string' && value.length <= 300
    || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value);
}

export function isVisionSkillName(value: unknown): value is VisionSkillName {
  return typeof value === 'string'
    && VISION_SKILL_NAMES.some((candidate) => candidate === value);
}

export function parseVisionSkillResult(value: unknown): VisionSkillResult | null {
  if (!isRecord(value) || !exactKeys(value, [
    'skillVersion',
    'skillName',
    'confidence',
    'observations',
    'recommendations',
    'warnings',
    'metadata',
  ])
      || !SAFE_VERSION.test(String(value.skillVersion))
      || !isVisionSkillName(value.skillName)
      || !isConfidence(value.confidence)
      || !Array.isArray(value.observations)
      || value.observations.length > 30
      || !Array.isArray(value.recommendations)
      || value.recommendations.length > 20
      || !Array.isArray(value.warnings)
      || value.warnings.length > 20
      || !isRecord(value.metadata)
      || Object.keys(value.metadata).length > 30) return null;

  const observations: VisionSkillObservation[] = [];
  for (const candidate of value.observations) {
    if (!isRecord(candidate) || !exactKeys(candidate, [
      'type',
      'value',
      'description',
      'confidence',
      'state',
      'requiresHumanReview',
    ])
        || typeof candidate.type !== 'string'
        || !SAFE_TYPE.test(candidate.type)
        || !scalar(candidate.value)
        || !safeText(candidate.description, 500)
        || !isConfidence(candidate.confidence)
        || !['observed', 'unknown'].includes(String(candidate.state))
        || typeof candidate.requiresHumanReview !== 'boolean'
        || candidate.state === 'unknown' && candidate.confidence !== 0) return null;
    observations.push(candidate as VisionSkillObservation);
  }

  const recommendations: VisionSkillRecommendation[] = [];
  for (const candidate of value.recommendations) {
    if (!isRecord(candidate) || !exactKeys(candidate, ['code', 'description', 'advisory'])
        || typeof candidate.code !== 'string'
        || !SAFE_CODE.test(candidate.code)
        || !safeText(candidate.description, 500)
        || candidate.advisory !== true) return null;
    recommendations.push(candidate as VisionSkillRecommendation);
  }

  if (!value.warnings.every((item) => typeof item === 'string' && SAFE_CODE.test(item))
      || !Object.values(value.metadata).every(scalar)) return null;

  return {
    skillVersion: value.skillVersion as string,
    skillName: value.skillName,
    confidence: value.confidence,
    observations,
    recommendations,
    warnings: [...new Set(value.warnings as string[])],
    metadata: { ...value.metadata } as VisionSkillMetadata,
  };
}
