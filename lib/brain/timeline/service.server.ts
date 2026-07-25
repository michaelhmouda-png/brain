import 'server-only';

import type { TimelineEventInput } from './contracts.ts';
import { timelineEventTypeRegistry, type TimelineEventTypeRegistry } from './event-type-registry.ts';
import { createTimelinePersistence } from './persistence.server.ts';

export function createTimelineService(
  persistence: ReturnType<typeof createTimelinePersistence>,
  registry: TimelineEventTypeRegistry = timelineEventTypeRegistry,
) {
  return {
    async record(input: TimelineEventInput) {
      const definition = registry.get(input.eventType);
      if (definition.sourceType !== input.sourceType) {
        throw new Error('BRAIN_TIMELINE_INPUT_INVALID');
      }
      return persistence.persist(input);
    },
  };
}
