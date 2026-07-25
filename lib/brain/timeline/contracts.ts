export const TIMELINE_SEVERITIES = ['info', 'notice', 'warning', 'critical'] as const;
export const OBSERVATION_STATES = ['observed', 'unknown'] as const;
export const TIMELINE_SOURCE_TYPES = [
  'vision_skill',
  'task',
  'shift',
  'maintenance',
  'inventory',
  'incident',
  'integration',
] as const;

export type TimelineSeverity = (typeof TIMELINE_SEVERITIES)[number];
export type ObservationState = (typeof OBSERVATION_STATES)[number];
export type TimelineSourceType = (typeof TIMELINE_SOURCE_TYPES)[number];
export type TimelineValue = string | number | boolean | null | TimelineValue[] | {
  [key: string]: TimelineValue;
};

export type TimelineTenantContext = {
  companyId: string;
  locationId: string | null;
  actorProfileId: string;
};

export type TimelineObservationInput = {
  observationType: string;
  value: TimelineValue;
  description: string;
  confidence: number | null;
  state: ObservationState;
  requiresHumanReview: boolean;
};

export type TimelineEventInput = {
  tenant: TimelineTenantContext;
  eventType: string;
  sourceType: TimelineSourceType;
  sourceId: string | null;
  title: string;
  summary: string;
  severity: TimelineSeverity;
  confidence: number | null;
  occurredAt: string;
  correlationId: string;
  metadata: Record<string, TimelineValue>;
  observations: TimelineObservationInput[];
};

export type PersistedTimelineEvent = {
  eventId: string;
  observationIds: string[];
  deduplicated: boolean;
};

export type TimelineObservation = TimelineObservationInput & {
  id: string;
  timelineEventId: string;
  observedAt: string;
};

export type TimelineEvent = {
  id: string;
  companyId: string;
  locationId: string | null;
  locationName: string | null;
  eventType: string;
  sourceType: string;
  sourceId: string | null;
  actorProfileId: string | null;
  title: string;
  summary: string;
  severity: TimelineSeverity;
  confidence: number | null;
  occurredAt: string;
  correlationId: string;
  metadata: Record<string, TimelineValue>;
  requiresHumanReview: boolean;
  observations: TimelineObservation[];
};

export type TimelineQuery = {
  locationId?: string;
  eventType?: string;
  sourceType?: TimelineSourceType;
  severity?: TimelineSeverity;
  from?: string;
  to?: string;
  cursorOccurredAt?: string;
  cursorId?: string;
  limit: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$/;
const OBSERVATION_TYPE = /^[a-z][a-z0-9_.]{0,119}$/;
const UNSAFE_KEY = /(signed[_-]?url|storage[_-]?path|authorization|credential|password|secret|token|nonce|private[_-]?key)/i;

const isoDate = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const confidence = (value: unknown): value is number | null =>
  value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const text = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.trim() === value && value.length >= 1 && value.length <= maximum;

function safeJson(value: unknown, maximumBytes: number): boolean {
  try {
    return JSON.stringify(value).length <= maximumBytes;
  } catch {
    return false;
  }
}

export function validateTimelineEventInput(input: TimelineEventInput): TimelineEventInput {
  if (!UUID.test(input.tenant.companyId)
      || input.tenant.locationId !== null && !UUID.test(input.tenant.locationId)
      || !UUID.test(input.tenant.actorProfileId)
      || !EVENT_TYPE.test(input.eventType)
      || input.eventType.length > 120
      || !TIMELINE_SOURCE_TYPES.includes(input.sourceType)
      || input.sourceId !== null && !UUID.test(input.sourceId)
      || !text(input.title, 160)
      || !text(input.summary, 1200)
      || !TIMELINE_SEVERITIES.includes(input.severity)
      || !confidence(input.confidence)
      || !isoDate(input.occurredAt)
      || !UUID.test(input.correlationId)
      || typeof input.metadata !== 'object'
      || input.metadata === null
      || Array.isArray(input.metadata)
      || Object.keys(input.metadata).some((key) => UNSAFE_KEY.test(key))
      || UNSAFE_KEY.test(JSON.stringify(input.metadata))
      || !safeJson(input.metadata, 8192)
      || !Array.isArray(input.observations)
      || input.observations.length > 30) {
    throw new Error('BRAIN_TIMELINE_INPUT_INVALID');
  }
  const types = new Set<string>();
  for (const item of input.observations) {
    if (!OBSERVATION_TYPE.test(item.observationType)
        || types.has(item.observationType)
        || !text(item.description, 800)
        || !confidence(item.confidence)
        || !OBSERVATION_STATES.includes(item.state)
        || item.state === 'unknown' && item.confidence !== null && item.confidence !== 0
        || typeof item.requiresHumanReview !== 'boolean'
        || !safeJson(item.value, 2048)) {
      throw new Error('BRAIN_TIMELINE_OBSERVATION_INVALID');
    }
    types.add(item.observationType);
  }
  return input;
}

export function isTimelineSeverity(value: unknown): value is TimelineSeverity {
  return typeof value === 'string'
    && TIMELINE_SEVERITIES.some((candidate) => candidate === value);
}

export function isTimelineSourceType(value: unknown): value is TimelineSourceType {
  return typeof value === 'string'
    && TIMELINE_SOURCE_TYPES.some((candidate) => candidate === value);
}

export function isTimelineEventType(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120 && EVENT_TYPE.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function isIsoDate(value: unknown): value is string {
  return isoDate(value);
}
