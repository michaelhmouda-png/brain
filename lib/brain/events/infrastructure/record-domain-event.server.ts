import { createSupabaseServer } from '../../../supabaseServer.ts';
import {
  createDomainEventRecorder,
  type DomainEventRecorder,
  type StoredDomainEvent,
} from '../../kernel/events/domain-event-recorder.ts';
import { createTaskCreatedOutboxDelivery } from '../outbox/task-created-outbox-delivery.ts';

export function createServerDomainEventRecorder(): DomainEventRecorder {
  const supabase = createSupabaseServer();
  return createDomainEventRecorder({
    async insert(record) {
      const { error } = await supabase.from('brain_domain_events').insert(record);
      if (!error) return 'inserted';
      if (error.code === '23505') return 'duplicate';
      const failure = new Error('DOMAIN_EVENT_INSERT_FAILED', { cause: error });
      Object.assign(failure, {
        code: error.code,
        details: error.details,
        hint: error.hint,
        operation: 'domain_event.persistence.insert',
      });
      throw failure;
    },
    async findByCommand(commandId, eventType) {
      const { data, error } = await supabase
        .from('brain_domain_events')
        .select('id,event_type,schema_version,company_id,actor_id,aggregate_type,aggregate_id,command_id,correlation_id,causation_id,payload,occurred_at')
        .eq('command_id', commandId)
        .eq('event_type', eventType)
        .maybeSingle();
      if (error) {
        const failure = new Error('DOMAIN_EVENT_LOOKUP_FAILED', { cause: error });
        Object.assign(failure, {
          code: error.code,
          details: error.details,
          hint: error.hint,
          operation: 'domain_event.persistence.lookup',
        });
        throw failure;
      }
      return data as StoredDomainEvent | null;
    },
  });
}

export function createServerOutboxDomainEventRecorder(): DomainEventRecorder {
  const supabase = createSupabaseServer();
  const recorder = createServerDomainEventRecorder();
  return createTaskCreatedOutboxDelivery(recorder, {
    async markDelivered(eventId, commandId) {
      const { data, error } = await supabase
        .from('brain_event_outbox')
        .update({ delivery_status: 'delivered', delivered_at: new Date().toISOString(), last_safe_error_code: null })
        .eq('id', eventId)
        .eq('command_id', commandId)
        .eq('event_type', 'task.created')
        .eq('delivery_status', 'pending')
        .select('id')
        .maybeSingle();
      if (!error && data) return 'delivered';
      if (!error) {
        const { data: existing, error: lookupError } = await supabase
          .from('brain_event_outbox')
          .select('id,command_id,event_type,delivery_status')
          .eq('id', eventId)
          .maybeSingle();
        if (!lookupError && existing?.command_id === commandId &&
            existing.event_type === 'task.created' && existing.delivery_status === 'delivered') return 'already_delivered';
      }
      return 'conflict';
    },
    async noteFailure(eventId, commandId, safeCode) {
      await supabase
        .from('brain_event_outbox')
        .update({
          last_safe_error_code: safeCode,
          available_at: new Date().toISOString(),
        })
        .eq('id', eventId)
        .eq('command_id', commandId)
        .eq('delivery_status', 'pending');
    },
  });
}
