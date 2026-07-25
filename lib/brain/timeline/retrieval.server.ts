import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  TimelineEvent,
  TimelineObservation,
  TimelineQuery,
  TimelineSeverity,
} from './contracts.ts';

const EVENT_COLUMNS = [
  'id',
  'company_id',
  'location_id',
  'event_type',
  'source_type',
  'source_id',
  'actor_profile_id',
  'title',
  'summary',
  'severity',
  'confidence',
  'occurred_at',
  'correlation_id',
  'metadata',
  'locations(name)',
  'brain_observations(id,timeline_event_id,observation_type,value,description,confidence,state,requires_human_review,observed_at)',
].join(',');

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseObservation(value: unknown): TimelineObservation | null {
  const row = record(value);
  if (!row
      || typeof row.id !== 'string'
      || typeof row.timeline_event_id !== 'string'
      || typeof row.observation_type !== 'string'
      || typeof row.description !== 'string'
      || !['observed', 'unknown'].includes(String(row.state))
      || typeof row.requires_human_review !== 'boolean'
      || typeof row.observed_at !== 'string'
      || row.confidence !== null && typeof row.confidence !== 'number') return null;
  return {
    id: row.id,
    timelineEventId: row.timeline_event_id,
    observationType: row.observation_type,
    value: row.value as TimelineObservation['value'],
    description: row.description,
    confidence: row.confidence as number | null,
    state: row.state as TimelineObservation['state'],
    requiresHumanReview: row.requires_human_review,
    observedAt: row.observed_at,
  };
}

function parseEvent(value: unknown): TimelineEvent | null {
  const row = record(value);
  const location = Array.isArray(row?.locations)
    ? record(row?.locations[0])
    : record(row?.locations);
  const observations = Array.isArray(row?.brain_observations)
    ? row.brain_observations.map(parseObservation)
    : [];
  if (!row
      || typeof row.id !== 'string'
      || typeof row.company_id !== 'string'
      || row.location_id !== null && typeof row.location_id !== 'string'
      || typeof row.event_type !== 'string'
      || typeof row.source_type !== 'string'
      || row.source_id !== null && typeof row.source_id !== 'string'
      || row.actor_profile_id !== null && typeof row.actor_profile_id !== 'string'
      || typeof row.title !== 'string'
      || typeof row.summary !== 'string'
      || !['info', 'notice', 'warning', 'critical'].includes(String(row.severity))
      || row.confidence !== null && typeof row.confidence !== 'number'
      || typeof row.occurred_at !== 'string'
      || typeof row.correlation_id !== 'string'
      || !record(row.metadata)
      || observations.some((item) => item === null)) return null;
  const safeObservations = observations as TimelineObservation[];
  return {
    id: row.id,
    companyId: row.company_id,
    locationId: row.location_id as string | null,
    locationName: typeof location?.name === 'string' ? location.name : null,
    eventType: row.event_type,
    sourceType: row.source_type,
    sourceId: row.source_id as string | null,
    actorProfileId: row.actor_profile_id as string | null,
    title: row.title,
    summary: row.summary,
    severity: row.severity as TimelineSeverity,
    confidence: row.confidence as number | null,
    occurredAt: row.occurred_at,
    correlationId: row.correlation_id,
    metadata: row.metadata as TimelineEvent['metadata'],
    requiresHumanReview: safeObservations.some((item) => item.requiresHumanReview),
    observations: safeObservations.sort((left, right) =>
      left.observationType.localeCompare(right.observationType)),
  };
}

export async function retrieveTimeline(
  authenticated: SupabaseClient,
  companyId: string,
  query: TimelineQuery,
): Promise<{ events: TimelineEvent[]; nextCursor: string | null }> {
  let request = authenticated
    .from('brain_timeline_events')
    .select(EVENT_COLUMNS)
    .eq('company_id', companyId)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(query.limit + 1);
  if (query.locationId) request = request.eq('location_id', query.locationId);
  if (query.eventType) request = request.eq('event_type', query.eventType);
  if (query.sourceType) request = request.eq('source_type', query.sourceType);
  if (query.severity) request = request.eq('severity', query.severity);
  if (query.from) request = request.gte('occurred_at', query.from);
  if (query.to) request = request.lte('occurred_at', query.to);
  if (query.cursorOccurredAt && query.cursorId) {
    request = request.or(
      `occurred_at.lt.${query.cursorOccurredAt},and(occurred_at.eq.${query.cursorOccurredAt},id.lt.${query.cursorId})`,
    );
  }
  const { data, error } = await request;
  if (error || !Array.isArray(data)) throw new Error('BRAIN_TIMELINE_READ_FAILED');
  const parsed = data.map(parseEvent);
  if (parsed.some((event) => event === null)) throw new Error('BRAIN_TIMELINE_READ_FAILED');
  const all = parsed as TimelineEvent[];
  const hasMore = all.length > query.limit;
  const events = all.slice(0, query.limit);
  const last = events.at(-1);
  return {
    events,
    nextCursor: hasMore && last
      ? Buffer.from(JSON.stringify({ occurredAt: last.occurredAt, id: last.id }))
        .toString('base64url')
      : null,
  };
}

export async function retrieveTimelineForBrain(
  authenticated: SupabaseClient,
  companyId: string,
  query: Omit<TimelineQuery, 'limit'> & { limit?: number } = {},
) {
  return retrieveTimeline(authenticated, companyId, {
    ...query,
    limit: Math.min(Math.max(query.limit ?? 25, 1), 100),
  });
}
