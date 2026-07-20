import { isRecord, stringField } from './client-api.ts';

export interface MaintenanceTicket {
  id: string;
  title: string;
  priority: string;
  status: string;
  due_date: string;
  location: string;
  assigned_to?: { first_name: string; last_name: string };
}

export function normalizeMaintenanceTicket(value: unknown): MaintenanceTicket | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, 'id');
  if (!id) return null;
  const relation = Array.isArray(value.assigned_to) ? value.assigned_to[0] : value.assigned_to;
  const locationRelation = Array.isArray(value.location) ? value.location[0] : value.location;
  return {
    id,
    title: stringField(value, 'title') || 'Untitled ticket',
    priority: stringField(value, 'priority') || 'low',
    status: stringField(value, 'status') || 'open',
    due_date: stringField(value, 'due_date'),
    location: isRecord(locationRelation) ? stringField(locationRelation, 'name') : '',
    assigned_to: isRecord(relation)
      ? { first_name: stringField(relation, 'first_name'), last_name: stringField(relation, 'last_name') }
      : undefined,
  };
}
