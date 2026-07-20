import type { DomainEventEnvelope } from '../../kernel/events/domain-event-envelope.ts';
import type { DomainEventRecorder } from '../../kernel/events/domain-event-recorder.ts';

export interface TaskCreatedOutboxStateStore {
  markDelivered(eventId: string, commandId: string): Promise<'delivered' | 'already_delivered' | 'conflict'>;
  noteFailure(eventId: string, commandId: string, safeCode: string): Promise<void>;
}

export function createTaskCreatedOutboxDelivery(
  recorder: DomainEventRecorder,
  state: TaskCreatedOutboxStateStore,
): DomainEventRecorder {
  return {
    async record<TType extends string, TPayload>(event: Readonly<DomainEventEnvelope<TType, TPayload>>) {
      if (event.eventType !== 'task.created') throw new Error('UNSUPPORTED_OUTBOX_EVENT');
      try {
        await recorder.record(event);
      } catch (error) {
        await state.noteFailure(event.eventId, event.commandId, 'EVENT_RECORDING_FAILED').catch(() => undefined);
        throw error;
      }
      const outcome = await state.markDelivered(event.eventId, event.commandId);
      if (outcome === 'conflict') throw new Error('OUTBOX_DELIVERY_STATE_FAILED');
    },
  };
}
