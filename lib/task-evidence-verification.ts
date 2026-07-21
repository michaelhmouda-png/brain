export const TASK_EVIDENCE_VERIFICATION_SCHEMA_VERSION = 1;
export const TASK_EVIDENCE_CONFIDENCE_THRESHOLD = 0.8;

export type AiEvidenceVerdict = 'verified' | 'rejected' | 'needs_human_review';
export type EvidenceVerificationResult = {
  verdict: AiEvidenceVerdict;
  confidence: number;
  explanation: string;
  reasonCodes: string[];
  visibleObservations: string[];
  uncertaintyFlags: string[];
};

const VERDICTS = new Set<AiEvidenceVerdict>(['verified', 'rejected', 'needs_human_review']);
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function shortStrings(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > maxLength) return null;
    output.push(item);
  }
  return output;
}

export function parseEvidenceVerificationResult(value: unknown): EvidenceVerificationResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const verdict = typeof row.verdict === 'string' && VERDICTS.has(row.verdict as AiEvidenceVerdict)
    ? row.verdict as AiEvidenceVerdict : null;
  const reasonCodes = shortStrings(row.reasonCodes, 12, 64);
  const observations = shortStrings(row.visibleObservations, 12, 240);
  const uncertainty = shortStrings(row.uncertaintyFlags, 12, 64);
  if (!verdict || typeof row.confidence !== 'number' || !Number.isFinite(row.confidence) ||
      row.confidence < 0 || row.confidence > 1 || typeof row.explanation !== 'string' ||
      row.explanation.length === 0 || row.explanation.length > 600 || !reasonCodes ||
      !reasonCodes.every((code) => CODE.test(code)) || !observations || !uncertainty ||
      !uncertainty.every((code) => CODE.test(code))) return null;
  return { verdict, confidence: row.confidence, explanation: row.explanation,
    reasonCodes, visibleObservations: observations, uncertaintyFlags: uncertainty };
}

export function routeEvidenceVerdict(result: EvidenceVerificationResult, priority: string): EvidenceVerificationResult {
  if (priority.toLowerCase() === 'critical') return {
    ...result, verdict: 'needs_human_review', reasonCodes: [...new Set([...result.reasonCodes, 'CRITICAL_TASK_REQUIRES_REVIEW'])],
  };
  if (result.confidence < TASK_EVIDENCE_CONFIDENCE_THRESHOLD || result.uncertaintyFlags.length > 0) return {
    ...result, verdict: 'needs_human_review', reasonCodes: [...new Set([...result.reasonCodes, 'LOW_CONFIDENCE_OR_UNCERTAIN'])],
  };
  return result;
}

export const EVIDENCE_RESULT_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'confidence', 'explanation', 'reasonCodes', 'visibleObservations', 'uncertaintyFlags'],
  properties: {
    verdict: { type: 'string', enum: ['verified', 'rejected', 'needs_human_review'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    explanation: { type: 'string', minLength: 1, maxLength: 600 },
    reasonCodes: { type: 'array', maxItems: 12, items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,63}$' } },
    visibleObservations: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 240 } },
    uncertaintyFlags: { type: 'array', maxItems: 12, items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,63}$' } },
  },
} as const;

