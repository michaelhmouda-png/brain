import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

import { resolveDate } from '../../dateResolver.ts';
import type {
  CreateTaskCommandDependencies,
  CreateTaskRecordInput,
  CreateTaskRecordResult,
} from '../commands/create-task-command-handler.ts';
import { logApprovedExecutionFailure } from '../../execution-diagnostics.server.ts';
import { createSupabaseServer } from '../../../supabaseServer.ts';
import { createTaskCreatedEvent } from '../events/task-created-event.ts';

async function resolveAssignee(
  supabase: SupabaseClient,
  input: CreateTaskRecordInput,
): Promise<{ id: string | null; name: string | null }> {
  const { assignedEmployeeId, assignedEmployeeName } = input.payload;
  if (assignedEmployeeName) {
    const [firstName, ...lastParts] = assignedEmployeeName.split(/\s+/);
    let query = supabase
      .from('employees')
      .select('id, first_name, last_name, status')
      .eq('company_id', input.tenantId)
      .ilike('first_name', `%${firstName}%`);
    if (lastParts.length) query = query.ilike('last_name', `%${lastParts.join(' ')}%`);
    const { data, error } = await query.limit(10);
    if (error || !data || data.length !== 1) throw new Error('ASSIGNEE_RESOLUTION_FAILED');
    return { id: data[0].id, name: `${data[0].first_name} ${data[0].last_name}` };
  }
  if (!assignedEmployeeId) return { id: null, name: null };
  const { data, error } = await supabase
    .from('employees')
    .select('id, first_name, last_name')
    .eq('id', assignedEmployeeId)
    .eq('company_id', input.tenantId)
    .single();
  if (error || !data) throw new Error('ASSIGNEE_RESOLUTION_FAILED');
  return { id: data.id, name: `${data.first_name} ${data.last_name}` };
}

async function createTaskRecord(
  supabase: SupabaseClient,
  serviceSupabase: SupabaseClient,
  input: CreateTaskRecordInput,
): Promise<CreateTaskRecordResult> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user || authData.user.id !== input.actorId) throw new Error('AUTHENTICATION_FAILED');
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.access_token) throw new Error('AUTHENTICATION_FAILED');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, company_id, role, status')
    .eq('id', input.actorId)
    .single();
  if (profileError || !profile || profile.company_id !== input.tenantId || profile.status !== 'active') {
    throw new Error('AUTHORIZATION_FAILED');
  }

  const assignee = await resolveAssignee(supabase, input);
  const dueDateResult = input.payload.dueDate ? resolveDate(input.payload.dueDate) : null;
  if (dueDateResult?.error) throw new Error('INVALID_DUE_DATE');

  const taskId = randomUUID();
  const preparedResult: CreateTaskRecordResult = {
    taskId,
    title: input.payload.title,
    status: input.payload.status,
    priority: input.payload.priority,
    assignedEmployeeId: assignee.id,
    assignedEmployeeName: assignee.name,
    dueDate: dueDateResult?.date ?? null,
  };
  const event = createTaskCreatedEvent({ command: input.command, result: preparedResult });
  const { data, error } = await serviceSupabase.rpc('create_task_with_outbox_event', {
    p_task_id: taskId,
    p_actor_id: input.actorId,
    p_profile_id: input.command.actor.profileId,
    p_tenant_id: input.tenantId,
    p_title: preparedResult.title,
    p_description: input.payload.description,
    p_priority: preparedResult.priority,
    p_status: preparedResult.status,
    p_assigned_employee_id: preparedResult.assignedEmployeeId,
    p_due_date: preparedResult.dueDate,
    p_event_id: event.eventId,
    p_event_type: event.eventType,
    p_event_schema_version: event.schemaVersion,
    p_aggregate_type: event.aggregateType,
    p_aggregate_id: event.aggregateId,
    p_command_id: event.commandId,
    p_correlation_id: event.correlationId,
    p_event_causation_id: event.causationId,
    p_proposal_id: input.proposalId,
    p_idempotency_key: input.command.idempotencyKey,
    p_event_payload: event.payload,
    p_occurred_at: event.occurredAt,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || row.outbox_event_id !== event.eventId || row.task_id !== taskId) {
    const failure = new Error('TASK_INSERT_FAILED', { cause: error ?? undefined });
    if (error) Object.assign(failure, {
      code: error.code,
      details: error.details,
      hint: error.hint,
      operation: 'task.persistence.atomic_outbox_insert',
    });
    logApprovedExecutionFailure({
      proposalId: input.proposalId,
      correlationId: input.correlationId,
      action: 'create_task',
      stage: 'task.persistence.insert',
    }, failure);
    throw failure;
  }

  return {
    taskId: row.task_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    assignedEmployeeId: row.assigned_employee_id ?? null,
    assignedEmployeeName: assignee.name,
    dueDate: row.due_date ?? null,
    outboxEvent: event,
  };
}

export function createSupabaseTaskRecordDependencies(
  supabase: SupabaseClient,
): CreateTaskCommandDependencies {
  const serviceSupabase = createSupabaseServer();
  return {
    createTaskRecord: input => createTaskRecord(supabase, serviceSupabase, input),
  };
}
