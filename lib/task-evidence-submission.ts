import {
  TASK_EVIDENCE_MAX_BYTES,
  TASK_EVIDENCE_MIME_TYPES,
  type TaskEvidenceMimeType,
  type TaskEvidenceSourceType,
} from './task-evidence.ts';

export const TASK_EVIDENCE_MAX_ITEMS = 10;
export const TASK_EVIDENCE_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const TASK_EVIDENCE_COUNT_MAX = 1_000_000_000;
export const TASK_EVIDENCE_COUNT_UNITS = [
  'bags',
  'pieces',
  'boxes',
  'bottles',
  'kilograms',
  'litres',
  'trays',
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UNIT_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export type TaskEvidenceSubmissionItemInput = {
  itemId: string;
  ordinal: number;
  sourceType: TaskEvidenceSourceType;
  mimeType: TaskEvidenceMimeType;
  sizeBytes: number;
  sha256: string;
};

export type TaskEvidenceSubmittedCount = {
  quantity: number;
  unit: string;
  damagedQuantity: number | null;
  locationDetails: string | null;
  notes: string | null;
};

export type PrepareTaskEvidenceSubmissionInput = {
  taskId: string;
  locationId: string | null;
  sourceType: TaskEvidenceSourceType | 'mixed_capture';
  idempotencyKey: string;
  items: TaskEvidenceSubmissionItemInput[];
  count: TaskEvidenceSubmittedCount | null;
};

export type TaskEvidenceCountRequirement = {
  countRequired: boolean;
  countLabel: string;
  unit: string;
  damagedQuantityRequested: boolean;
  allowDecimals: boolean;
  instructions: string | null;
  version: number;
};

export type EvidenceSetResult = {
  schemaVersion: 2;
  verdict: 'verified' | 'rejected' | 'needs_human_review';
  confidence: number;
  explanation: string;
  perImageObservations: Array<{
    itemId: string;
    ordinal: number;
    observations: string[];
  }>;
  completeSetObservations: string[];
  reasonCodes: string[];
  uncertaintyFlags: string[];
  fullAreaCovered: boolean | null;
  submittedQuantity: number | null;
  observedQuantity: number | null;
  observedQuantityConfidence: number | null;
  countComparison: 'matches' | 'mismatch' | 'cannot_verify' | 'not_applicable';
  missingViewConcerns: string[];
  duplicateViewConcerns: string[];
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maximum ? trimmed : undefined;
}

export function isTaskEvidenceCountUnit(value: unknown): value is string {
  return typeof value === 'string' && UNIT_PATTERN.test(value);
}

export function parsePrepareTaskEvidenceSubmission(
  value: unknown,
): PrepareTaskEvidenceSubmissionInput | null {
  const input = record(value);
  if (
    !input
    || typeof input.taskId !== 'string'
    || !UUID_PATTERN.test(input.taskId)
    || (input.locationId !== null
      && input.locationId !== undefined
      && (typeof input.locationId !== 'string' || !UUID_PATTERN.test(input.locationId)))
    || !['mobile_camera', 'gallery_upload', 'mixed_capture'].includes(String(input.sourceType))
    || typeof input.idempotencyKey !== 'string'
    || !UUID_PATTERN.test(input.idempotencyKey)
    || !Array.isArray(input.items)
    || input.items.length < 1
    || input.items.length > TASK_EVIDENCE_MAX_ITEMS
  ) {
    return null;
  }

  const hashes = new Set<string>();
  let totalBytes = 0;
  const items: TaskEvidenceSubmissionItemInput[] = [];
  for (let index = 0; index < input.items.length; index += 1) {
    const item = record(input.items[index]);
    if (
      !item
      || typeof item.itemId !== 'string'
      || !UUID_PATTERN.test(item.itemId)
      || item.ordinal !== index + 1
      || (item.sourceType !== 'mobile_camera' && item.sourceType !== 'gallery_upload')
      || typeof item.mimeType !== 'string'
      || !TASK_EVIDENCE_MIME_TYPES.some((mime) => mime === item.mimeType)
      || typeof item.sizeBytes !== 'number'
      || !Number.isSafeInteger(item.sizeBytes)
      || item.sizeBytes <= 0
      || item.sizeBytes > TASK_EVIDENCE_MAX_BYTES
      || typeof item.sha256 !== 'string'
      || !SHA256_PATTERN.test(item.sha256)
      || hashes.has(item.sha256)
    ) {
      return null;
    }
    hashes.add(item.sha256);
    totalBytes += item.sizeBytes;
    items.push({
      itemId: item.itemId,
      ordinal: item.ordinal,
      sourceType: item.sourceType,
      mimeType: item.mimeType as TaskEvidenceMimeType,
      sizeBytes: item.sizeBytes,
      sha256: item.sha256,
    });
  }
  if (totalBytes > TASK_EVIDENCE_MAX_TOTAL_BYTES) return null;

  let count: TaskEvidenceSubmittedCount | null = null;
  if (input.count !== undefined && input.count !== null) {
    const rawCount = record(input.count);
    const locationDetails = boundedText(rawCount?.locationDetails, 500);
    const notes = boundedText(rawCount?.notes, 1000);
    if (
      !rawCount
      || typeof rawCount.quantity !== 'number'
      || !Number.isFinite(rawCount.quantity)
      || rawCount.quantity < 0
      || rawCount.quantity > TASK_EVIDENCE_COUNT_MAX
      || !isTaskEvidenceCountUnit(rawCount.unit)
      || (rawCount.damagedQuantity !== null
        && rawCount.damagedQuantity !== undefined
        && (typeof rawCount.damagedQuantity !== 'number'
          || !Number.isFinite(rawCount.damagedQuantity)
          || rawCount.damagedQuantity < 0
          || rawCount.damagedQuantity > rawCount.quantity))
      || locationDetails === undefined
      || notes === undefined
    ) {
      return null;
    }
    count = {
      quantity: rawCount.quantity,
      unit: rawCount.unit,
      damagedQuantity: typeof rawCount.damagedQuantity === 'number'
        ? rawCount.damagedQuantity
        : null,
      locationDetails,
      notes,
    };
  }

  return {
    taskId: input.taskId,
    locationId: typeof input.locationId === 'string' ? input.locationId : null,
    sourceType: input.sourceType as PrepareTaskEvidenceSubmissionInput['sourceType'],
    idempotencyKey: input.idempotencyKey,
    items,
    count,
  };
}

function stringArray(value: unknown, maximumItems = 20): string[] | null {
  if (
    !Array.isArray(value)
    || value.length > maximumItems
    || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 300)
  ) {
    return null;
  }
  return value.map((item) => item.trim());
}

export function parseEvidenceSetResult(
  value: unknown,
  expectedItems: ReadonlyArray<{ itemId: string; ordinal: number }>,
): EvidenceSetResult | null {
  const result = record(value);
  if (
    !result
    || result.schemaVersion !== 2
    || !['verified', 'rejected', 'needs_human_review'].includes(String(result.verdict))
    || typeof result.confidence !== 'number'
    || result.confidence < 0
    || result.confidence > 1
    || typeof result.explanation !== 'string'
    || !result.explanation.trim()
    || result.explanation.length > 600
    || !Array.isArray(result.perImageObservations)
    || result.perImageObservations.length !== expectedItems.length
    || (result.fullAreaCovered !== null && typeof result.fullAreaCovered !== 'boolean')
    || !['matches', 'mismatch', 'cannot_verify', 'not_applicable'].includes(
      String(result.countComparison),
    )
  ) {
    return null;
  }

  const perImageObservations = result.perImageObservations.map((value, index) => {
    const row = record(value);
    const expected = expectedItems[index];
    const observations = stringArray(row?.observations);
    if (
      !row
      || row.itemId !== expected.itemId
      || row.ordinal !== expected.ordinal
      || !observations
    ) {
      return null;
    }
    return { itemId: expected.itemId, ordinal: expected.ordinal, observations };
  });
  if (perImageObservations.some((item) => item === null)) return null;

  const completeSetObservations = stringArray(result.completeSetObservations);
  const reasonCodes = stringArray(result.reasonCodes);
  const uncertaintyFlags = stringArray(result.uncertaintyFlags);
  const missingViewConcerns = stringArray(result.missingViewConcerns);
  const duplicateViewConcerns = stringArray(result.duplicateViewConcerns);
  if (
    !completeSetObservations
    || !reasonCodes
    || !uncertaintyFlags
    || !missingViewConcerns
    || !duplicateViewConcerns
  ) {
    return null;
  }

  const optionalCount = (input: unknown) =>
    input === null
      ? null
      : typeof input === 'number'
        && Number.isFinite(input)
        && input >= 0
        && input <= TASK_EVIDENCE_COUNT_MAX
        ? input
        : undefined;
  const submittedQuantity = optionalCount(result.submittedQuantity);
  const observedQuantity = optionalCount(result.observedQuantity);
  const observedQuantityConfidence = result.observedQuantityConfidence === null
    ? null
    : typeof result.observedQuantityConfidence === 'number'
      && result.observedQuantityConfidence >= 0
      && result.observedQuantityConfidence <= 1
      ? result.observedQuantityConfidence
      : undefined;
  if (
    submittedQuantity === undefined
    || observedQuantity === undefined
    || observedQuantityConfidence === undefined
  ) {
    return null;
  }

  return {
    schemaVersion: 2,
    verdict: result.verdict as EvidenceSetResult['verdict'],
    confidence: result.confidence,
    explanation: result.explanation.trim(),
    perImageObservations: perImageObservations as EvidenceSetResult['perImageObservations'],
    completeSetObservations,
    reasonCodes,
    uncertaintyFlags,
    fullAreaCovered: result.fullAreaCovered,
    submittedQuantity,
    observedQuantity,
    observedQuantityConfidence,
    countComparison: result.countComparison as EvidenceSetResult['countComparison'],
    missingViewConcerns,
    duplicateViewConcerns,
  };
}

export function routeEvidenceSetVerdict(
  result: EvidenceSetResult,
  priority: string,
  countRequired: boolean,
): EvidenceSetResult {
  const requiresReview = result.confidence < 0.8
    || priority === 'critical'
    || result.fullAreaCovered !== true
    || result.missingViewConcerns.length > 0
    || result.duplicateViewConcerns.length > 0
    || result.uncertaintyFlags.length > 0
    || (countRequired && result.countComparison !== 'matches')
    || result.reasonCodes.some((code) => code.startsWith('safety_'));
  return requiresReview && result.verdict === 'verified'
    ? {
        ...result,
        verdict: 'needs_human_review',
        reasonCodes: [...new Set([...result.reasonCodes, 'policy_human_review_required'])],
      }
    : result;
}

export const EVIDENCE_SET_RESULT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'verdict',
    'confidence',
    'explanation',
    'perImageObservations',
    'completeSetObservations',
    'reasonCodes',
    'uncertaintyFlags',
    'fullAreaCovered',
    'submittedQuantity',
    'observedQuantity',
    'observedQuantityConfidence',
    'countComparison',
    'missingViewConcerns',
    'duplicateViewConcerns',
  ],
  properties: {
    schemaVersion: { type: 'integer', const: 2 },
    verdict: { type: 'string', enum: ['verified', 'rejected', 'needs_human_review'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    explanation: { type: 'string', minLength: 1, maxLength: 600 },
    perImageObservations: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['itemId', 'ordinal', 'observations'],
        properties: {
          itemId: { type: 'string', format: 'uuid' },
          ordinal: { type: 'integer', minimum: 1, maximum: 10 },
          observations: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 300 },
          },
        },
      },
    },
    completeSetObservations: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 300 },
    },
    reasonCodes: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 80 },
    },
    uncertaintyFlags: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 80 },
    },
    fullAreaCovered: { type: ['boolean', 'null'] },
    submittedQuantity: { type: ['number', 'null'], minimum: 0 },
    observedQuantity: { type: ['number', 'null'], minimum: 0 },
    observedQuantityConfidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    countComparison: {
      type: 'string',
      enum: ['matches', 'mismatch', 'cannot_verify', 'not_applicable'],
    },
    missingViewConcerns: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 300 },
    },
    duplicateViewConcerns: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 300 },
    },
  },
} as const;
