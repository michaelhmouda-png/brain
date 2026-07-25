import type { TimelineSourceType } from './contracts.ts';

export type TimelineEventTypeDefinition = {
  eventType: string;
  sourceType: TimelineSourceType;
};

export class TimelineEventTypeRegistry {
  readonly #events = new Map<string, TimelineEventTypeDefinition>();

  register(definition: TimelineEventTypeDefinition): this {
    if (this.#events.has(definition.eventType)) {
      throw new Error('BRAIN_TIMELINE_EVENT_TYPE_ALREADY_REGISTERED');
    }
    this.#events.set(definition.eventType, Object.freeze({ ...definition }));
    return this;
  }

  get(eventType: string): TimelineEventTypeDefinition {
    const definition = this.#events.get(eventType);
    if (!definition) throw new Error('BRAIN_TIMELINE_EVENT_TYPE_NOT_REGISTERED');
    return definition;
  }

  list(): readonly TimelineEventTypeDefinition[] {
    return Object.freeze([...this.#events.values()]);
  }
}

export const timelineEventTypeRegistry = new TimelineEventTypeRegistry()
  .register({ eventType: 'vision.opening_readiness', sourceType: 'vision_skill' })
  .register({ eventType: 'vision.closing_readiness', sourceType: 'vision_skill' })
  .register({ eventType: 'vision.cleanliness', sourceType: 'vision_skill' })
  .register({ eventType: 'vision.safety', sourceType: 'vision_skill' })
  .register({ eventType: 'vision.equipment', sourceType: 'vision_skill' });
