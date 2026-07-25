const SAFE_CODES = new Set([
  'BRAIN_TIMELINE_INPUT_INVALID',
  'BRAIN_TIMELINE_OBSERVATION_INVALID',
  'BRAIN_TIMELINE_EVENT_TYPE_NOT_REGISTERED',
  'BRAIN_TIMELINE_PERSISTENCE_FAILED',
  'BRAIN_TIMELINE_READ_FAILED',
  'BRAIN_TIMELINE_FORBIDDEN',
]);

export function normalizeTimelineError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return SAFE_CODES.has(code) ? code : 'BRAIN_TIMELINE_UNAVAILABLE';
}
