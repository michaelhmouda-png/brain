import type { DomainEventEnvelope } from './domain-event-envelope.ts';
import { DomainEventError } from './domain-event-errors.ts';

export interface DomainEventRecorder {
  record<TType extends string, TPayload>(
    event: Readonly<DomainEventEnvelope<TType, TPayload>>,
  ): Promise<void>;
}

export interface StoredDomainEvent {
  id: string;
  event_type: string;
  schema_version: number;
  company_id: string;
  actor_id: string;
  aggregate_type: string;
  aggregate_id: string;
  command_id: string;
  correlation_id: string;
  causation_id: string;
  payload: unknown;
  occurred_at: string;
}

export interface DomainEventStore {
  insert(record: StoredDomainEvent): Promise<'inserted' | 'duplicate'>;
  findByCommand(commandId: string, eventType: string): Promise<StoredDomainEvent | null>;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map(key =>
      `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function recordFromEvent(event: Readonly<DomainEventEnvelope<string, unknown>>): StoredDomainEvent {
  return {
    id: event.eventId, event_type: event.eventType, schema_version: event.schemaVersion,
    company_id: event.tenant.tenantId, actor_id: event.actor.actorId,
    aggregate_type: event.aggregateType, aggregate_id: event.aggregateId,
    command_id: event.commandId, correlation_id: event.correlationId,
    causation_id: event.causationId, payload: event.payload, occurred_at: event.occurredAt,
  };
}

function sameLogicalEvent(existing: StoredDomainEvent, expected: StoredDomainEvent): boolean {
  return existing.event_type === expected.event_type &&
    existing.schema_version === expected.schema_version &&
    existing.company_id === expected.company_id && existing.actor_id === expected.actor_id &&
    existing.aggregate_type === expected.aggregate_type && existing.aggregate_id === expected.aggregate_id &&
    existing.command_id === expected.command_id && existing.correlation_id === expected.correlation_id &&
    existing.causation_id === expected.causation_id && stable(existing.payload) === stable(expected.payload);
}

export function createDomainEventRecorder(store: DomainEventStore): DomainEventRecorder {
  return {
    async record(event) {
      const expected = recordFromEvent(event);
      try {
        const outcome = await store.insert(expected);
        if (outcome === 'inserted') return;
        const existing = await store.findByCommand(event.commandId, event.eventType);
        if (existing && sameLogicalEvent(existing, expected)) return;
        throw new DomainEventError('EVENT_RECORDING_FAILED');
      } catch (error) {
        if (error instanceof DomainEventError) throw error;
        throw new DomainEventError('EVENT_RECORDING_FAILED', { cause: error });
      }
    },
  };
}
