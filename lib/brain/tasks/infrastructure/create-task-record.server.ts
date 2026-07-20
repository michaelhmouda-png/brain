import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveDate } from '../../dateResolver.ts';
import type {
  CreateTaskCommandDependencies,
  CreateTaskRecordInput,
  CreateTaskRecordResult,
} from '../commands/create-task-command-handler.ts';
import { logApprovedExecutionFailure } from '../../execution-diagnostics.server.ts';

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

  const record: Record<string, unknown> = {
    company_id: input.tenantId,
    title: input.payload.title,
    priority: input.payload.priority,
    status: input.payload.status,
    created_by: input.actorId,
  };
  if (input.payload.description) record.description = input.payload.description;
  if (assignee.id) record.assigned_employee_id = assignee.id;
  if (dueDateResult?.date) record.due_date = dueDateResult.date;

  const { data, error } = await supabase
    .from('tasks')
    .insert(record)
    .select('id, title, priority, status, assigned_employee_id, due_date')
    .single();
  if (error || !data) {
    const failure = new Error('TASK_INSERT_FAILED', { cause: error ?? undefined });
    if (error) Object.assign(failure, {
      code: error.code,
      details: error.details,
      hint: error.hint,
      operation: 'task.persistence.insert',
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
    taskId: data.id,
    title: data.title,
    status: data.status,
    priority: data.priority,
    assignedEmployeeId: data.assigned_employee_id ?? null,
    assignedEmployeeName: assignee.name,
    dueDate: data.due_date ?? null,
  };
}

export function createSupabaseTaskRecordDependencies(
  supabase: SupabaseClient,
): CreateTaskCommandDependencies {
  return {
    createTaskRecord: input => createTaskRecord(supabase, input),
  };
}
