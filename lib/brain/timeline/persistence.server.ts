import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validateTimelineEventInput,
  type PersistedTimelineEvent,
  type TimelineEventInput,
} from './contracts.ts';

type RpcRow = {
  event_id?: unknown;
  observation_ids?: unknown;
  deduplicated?: unknown;
};

export function createTimelinePersistence(serviceRole: SupabaseClient) {
  return {
    async persist(input: TimelineEventInput): Promise<PersistedTimelineEvent> {
      const safe = validateTimelineEventInput(input);
      const { data, error } = await serviceRole.rpc('persist_brain_timeline_event', {
        p_company_id: safe.tenant.companyId,
        p_location_id: safe.tenant.locationId,
        p_event_type: safe.eventType,
        p_source_type: safe.sourceType,
        p_source_id: safe.sourceId,
        p_actor_profile_id: safe.tenant.actorProfileId,
        p_title: safe.title,
        p_summary: safe.summary,
        p_severity: safe.severity,
        p_confidence: safe.confidence,
        p_occurred_at: safe.occurredAt,
        p_correlation_id: safe.correlationId,
        p_metadata: safe.metadata,
        p_observations: safe.observations,
      });
      const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null;
      if (error
          || !row
          || typeof row.event_id !== 'string'
          || !Array.isArray(row.observation_ids)
          || !row.observation_ids.every((id) => typeof id === 'string')
          || typeof row.deduplicated !== 'boolean') {
        throw new Error('BRAIN_TIMELINE_PERSISTENCE_FAILED');
      }
      return {
        eventId: row.event_id,
        observationIds: row.observation_ids as string[],
        deduplicated: row.deduplicated,
      };
    },
  };
}
