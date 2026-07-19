import { createSupabaseServer } from '../../../supabaseServer.ts';
import {
  createDomainEventRecorder,
  type DomainEventRecorder,
  type StoredDomainEvent,
} from '../../kernel/events/domain-event-recorder.ts';

export function createServerDomainEventRecorder(): DomainEventRecorder {
  const supabase = createSupabaseServer();
  return createDomainEventRecorder({
    async insert(record) {
      const { error } = await supabase.from('brain_domain_events').insert(record);
      if (!error) return 'inserted';
      if (error.code === '23505') return 'duplicate';
      throw new Error('DOMAIN_EVENT_INSERT_FAILED');
    },
    async findByCommand(commandId, eventType) {
      const { data, error } = await supabase
        .from('brain_domain_events')
        .select('id,event_type,schema_version,company_id,actor_id,aggregate_type,aggregate_id,command_id,correlation_id,causation_id,payload,occurred_at')
        .eq('command_id', commandId)
        .eq('event_type', eventType)
        .maybeSingle();
      if (error) throw new Error('DOMAIN_EVENT_LOOKUP_FAILED');
      return data as StoredDomainEvent | null;
    },
  });
}
