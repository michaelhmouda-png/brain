import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BrainRequestContext } from '../../kernel/request-context.ts';
import { createSupabaseServer } from '../../../supabaseServer.ts';
import { localDateTimeToInstant } from './task-batch-time.ts';

export const MAX_TASK_BATCH_SIZE = 25;
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

export type CanonicalBatchTask = {
  item_index: number; title: string; description: string; assigned_employee_id: string;
  assigned_employee_name: string; location_id: string; location_name: string;
  priority: string; status: 'pending'; due_local: string; due_at: string; due_date: string;
};

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function deterministicUuid(material: string): string {
  const hex = createHash('sha256').update(material).digest('hex').slice(0, 32).split('');
  hex[12] = '5'; hex[16] = '8';
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function prepareCreateTaskBatch(
  supabase: SupabaseClient,
  context: BrainRequestContext,
  raw: unknown,
): Promise<{ preview: true; action: string; message: string; fields: Array<{ label: string; value: string }>; canonicalArguments: { timezone: string; tasks: CanonicalBatchTask[] } } | { error: string }> {
  if (!['manager', 'owner', 'super_admin'].includes(context.actor.role)) return { error: 'This operation requires management access.' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Invalid task batch.' };
  const requested = (raw as Record<string, unknown>).tasks;
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > MAX_TASK_BATCH_SIZE) return { error: 'A task batch must contain between 1 and 25 tasks.' };
  const [{ data: company }, { data: employees, error: employeeError }, { data: locations, error: locationError }] = await Promise.all([
    supabase.from('companies').select('timezone').eq('id', context.tenant.companyId).single(),
    supabase.from('employees').select('id, first_name, last_name, status').eq('company_id', context.tenant.companyId),
    supabase.from('locations').select('id, name, status').eq('company_id', context.tenant.companyId),
  ]);
  const timezone = company && typeof company.timezone === 'string' ? company.timezone : null;
  if (!timezone) return { error: 'The company timezone is not configured.' };
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { return { error: 'The company timezone is invalid.' }; }
  if (employeeError || locationError || !Array.isArray(employees) || !Array.isArray(locations)) return { error: 'Task references could not be resolved.' };
  const canonical: CanonicalBatchTask[] = [];
  const duplicates = new Set<string>();
  try {
    for (const [index, value] of requested.entries()) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_BATCH_ITEM');
      const item = value as Record<string, unknown>;
      const forbidden = ['companyId','company_id','actorId','actor_id','employeeId','employee_id','assignedEmployeeId','assigned_employee_id','locationId','location_id','role','status','timezone'];
      if (forbidden.some((key) => Object.hasOwn(item, key))) throw new Error('UNTRUSTED_BATCH_FIELD');
      const title = typeof item.title === 'string' ? item.title.trim().replace(/\s+/g, ' ') : '';
      const description = typeof item.description === 'string' ? item.description.trim() : '';
      const employeeName = typeof item.assignedEmployeeName === 'string' ? normalizedName(item.assignedEmployeeName) : '';
      const locationName = typeof item.locationName === 'string' ? normalizedName(item.locationName) : '';
      const priority = typeof item.priority === 'string' ? item.priority.trim().toLowerCase() : '';
      const dueLocal = typeof item.dueLocal === 'string' ? item.dueLocal.trim() : '';
      if (!title || title.length > 300 || !description || description.length > 5000 || !employeeName || !locationName || !PRIORITIES.has(priority)) throw new Error('INVALID_BATCH_ITEM');
      const employeeMatches = employees.filter((employee) => normalizedName(`${employee.first_name ?? ''} ${employee.last_name ?? ''}`) === employeeName && employee.status === 'active');
      const locationMatches = locations.filter((location) => normalizedName(String(location.name ?? '')) === locationName && (location.status === undefined || location.status === null || location.status === 'active'));
      if (employeeMatches.length !== 1) throw new Error('EMPLOYEE_NOT_UNIQUE_ACTIVE');
      if (locationMatches.length !== 1) throw new Error('LOCATION_NOT_UNIQUE_ACTIVE');
      const due = localDateTimeToInstant(dueLocal, timezone);
      const duplicateKey = JSON.stringify([title.toLocaleLowerCase('en'), employeeMatches[0].id, locationMatches[0].id, due.dueAt]);
      if (duplicates.has(duplicateKey)) throw new Error('DUPLICATE_BATCH_ITEM');
      duplicates.add(duplicateKey);
      canonical.push({ item_index: index, title, description, assigned_employee_id: employeeMatches[0].id, assigned_employee_name: `${employeeMatches[0].first_name} ${employeeMatches[0].last_name}`.trim(), location_id: locationMatches[0].id, location_name: String(locationMatches[0].name), priority, status: 'pending', due_local: dueLocal.replace(' ', 'T'), due_at: due.dueAt, due_date: due.dueDate });
    }
  } catch { return { error: 'Every task must have valid, unique, active employee, location, priority, description, and local due time values.' }; }
  const fields: Array<{ label: string; value: string }> = [
    { label: 'Total tasks', value: String(canonical.length) }, { label: 'Company timezone', value: timezone },
    { label: 'Confirmation', value: 'One confirmation creates the complete batch atomically.' },
  ];
  for (const task of canonical) {
    const number = task.item_index + 1;
    fields.push(
      { label: `${number} · Title`, value: task.title }, { label: `${number} · Description`, value: task.description },
      { label: `${number} · Assigned employee`, value: task.assigned_employee_name }, { label: `${number} · Location`, value: task.location_name },
      { label: `${number} · Priority`, value: task.priority[0].toUpperCase() + task.priority.slice(1) },
      { label: `${number} · Due`, value: `${task.due_local.replace('T', ' ')} (${timezone})` }, { label: `${number} · Status`, value: 'Pending' },
    );
  }
  return { preview: true, action: 'Create task batch', message: `Please review all ${canonical.length} tasks. One confirmation creates the complete batch.`, fields, canonicalArguments: { timezone, tasks: canonical } };
}

export async function executeCreateTaskBatch(input: { context: BrainRequestContext; proposalId: string; payload: Readonly<Record<string, unknown>> }): Promise<{ success: true; createdCount: number }> {
  const tasks = input.payload.tasks;
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > MAX_TASK_BATCH_SIZE) throw new Error('INVALID_BATCH_PAYLOAD');
  const executionItems = tasks.map((task, index) => {
    const business = task as Record<string, unknown>;
    const seed = `${input.proposalId}:${index}:${JSON.stringify(business)}:${input.context.actor.actorId}:${input.context.tenant.companyId}:1`;
    const commandId = deterministicUuid(`${seed}:command`);
    return { ...business, task_id: deterministicUuid(`${seed}:task`), event_id: deterministicUuid(`${seed}:event`), command_id: commandId, correlation_id: input.context.actor.correlationId, idempotency_key: createHash('sha256').update(seed).digest('hex') };
  });
  const service = createSupabaseServer();
  const { data, error } = await service.rpc('create_task_batch_with_outbox_events', { p_actor_id: input.context.actor.actorId, p_profile_id: input.context.actor.profileId, p_tenant_id: input.context.tenant.companyId, p_proposal_id: input.proposalId, p_items: executionItems });
  const result = Array.isArray(data) ? data[0] : data;
  if (error || !result || Number(result.created_count) !== tasks.length) throw new Error('TASK_BATCH_INSERT_FAILED', { cause: error ?? undefined });
  return { success: true, createdCount: tasks.length };
}
