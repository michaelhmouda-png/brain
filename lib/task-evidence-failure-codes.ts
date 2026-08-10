export const EVIDENCE_FAILURE_CODES = [
  'EVIDENCE_DOWNLOAD_FAILED',
  'EVIDENCE_IMAGE_PROCESSING_FAILED',
  'DERIVED_PREVIEW_UPLOAD_FAILED',
  'DERIVED_PREVIEW_RECORD_FAILED',
  'SUBMISSION_CONTEXT_MISSING',
  'OPENAI_VISION_MODEL_MISSING',
  'MALFORMED_AI_OUTPUT',
  'MALFORMED_AI_SUBMITTED_COUNT',
  'EVIDENCE_JOB_COMPLETE_FAILED',
  'VISION_PROVIDER_AUTH_FAILED',
  'VISION_PROVIDER_RATE_LIMITED',
  'VISION_PROVIDER_TIMEOUT',
  'VISION_PROVIDER_UNAVAILABLE',
  'VISION_PROVIDER_REQUEST_FAILED',
  'EVIDENCE_VERIFICATION_FAILED',
] as const;

export type EvidenceFailureCode = typeof EVIDENCE_FAILURE_CODES[number];

const allowed = new Set<string>(EVIDENCE_FAILURE_CODES);
const permanent = new Set<EvidenceFailureCode>([
  'EVIDENCE_IMAGE_PROCESSING_FAILED',
  'SUBMISSION_CONTEXT_MISSING',
  'OPENAI_VISION_MODEL_MISSING',
  'MALFORMED_AI_OUTPUT',
  'MALFORMED_AI_SUBMITTED_COUNT',
  'VISION_PROVIDER_AUTH_FAILED',
]);

type SafeErrorShape = { message?: unknown; name?: unknown; status?: unknown; code?: unknown };

export function safeEvidenceFailureCode(error: unknown): EvidenceFailureCode {
  const value = error && typeof error === 'object' ? error as SafeErrorShape : {};
  const messageCode = typeof value.message === 'string' ? value.message.split(':', 1)[0] : '';
  if (allowed.has(messageCode)) return messageCode as EvidenceFailureCode;
  if (value.name === 'SyntaxError') return 'MALFORMED_AI_OUTPUT';
  const status = typeof value.status === 'number' ? value.status : null;
  if (status === 401 || status === 403) return 'VISION_PROVIDER_AUTH_FAILED';
  if (status === 408) return 'VISION_PROVIDER_TIMEOUT';
  if (status === 429) return 'VISION_PROVIDER_RATE_LIMITED';
  if (status !== null && status >= 500 && status <= 599) return 'VISION_PROVIDER_UNAVAILABLE';
  if (status !== null || value.name === 'APIError') return 'VISION_PROVIDER_REQUEST_FAILED';
  return 'EVIDENCE_VERIFICATION_FAILED';
}

export function isPermanentEvidenceFailure(code: EvidenceFailureCode): boolean {
  return permanent.has(code);
}
