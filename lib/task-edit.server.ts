import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyApiAuthorization } from './company-api-authorization';
import {
  canonicalizeTaskEditPatch,
  isTaskEditRole,
  type TaskEditRequest,
} from './task-edit';
import { loadCompanyTasks, type TaskListItem } from './task-list';
import { loadTaskDisplayLocalizations } from './task-localization.server';

export type TaskEditErrorCode =
  | 'TASK_EDIT_FORBIDDEN'
  | 'TASK_EDIT_NOT_FOUND'
  | 'TASK_EDIT_STALE'
  | 'TASK_EDIT_LIFECYCLE_CONFLICT'
  | 'TASK_EDIT_ASSIGNEE_INVALID'
  | 'TASK_EDIT_LOCATION_INVALID'
  | 'TASK_EDIT_COUNT_REQUIREMENT_LOCKED'
  | 'TASK_EDIT_INPUT_INVALID'
  | 'TASK_EDIT_UNAVAILABLE';

export class TaskEditServiceError extends Error {
  readonly code: TaskEditErrorCode;
  readonly status: 400 | 403 | 404 | 409 | 500;

  constructor(code: TaskEditErrorCode, status: TaskEditServiceError['status']) {
    super(code);
    this.name = 'TaskEditServiceError';
    this.code = code;
    this.status = status;
  }
}

function mapDatabaseError(error: { message?: string; code?: string } | null): TaskEditServiceError {
  const message = error?.message ?? '';
  if (message.includes('TASK_EDIT_ACTOR_FORBIDDEN')) {
    return new TaskEditServiceError('TASK_EDIT_FORBIDDEN', 403);
  }
  if (message.includes('TASK_EDIT_NOT_FOUND')) {
    return new TaskEditServiceError('TASK_EDIT_NOT_FOUND', 404);
  }
  if (message.includes('TASK_EDIT_STALE')) {
    return new TaskEditServiceError('TASK_EDIT_STALE', 409);
  }
  if (
    message.includes('TASK_COMPLETION_WORKFLOW_REQUIRED')
    || message.includes('TASK_TERMINAL_EDIT_FORBIDDEN')
    || message.includes('TASK_STATUS_TRANSITION_INVALID')
  ) {
    return new TaskEditServiceError('TASK_EDIT_LIFECYCLE_CONFLICT', 409);
  }
  if (message.includes('TASK_EDIT_ASSIGNEE_INVALID')) {
    return new TaskEditServiceError('TASK_EDIT_ASSIGNEE_INVALID', 400);
  }
  if (message.includes('TASK_EDIT_LOCATION_INVALID')) {
    return new TaskEditServiceError('TASK_EDIT_LOCATION_INVALID', 400);
  }
  if (message.includes('COUNT_REQUIREMENT_LOCKED_BY_EVIDENCE')) {
    return new TaskEditServiceError('TASK_EDIT_COUNT_REQUIREMENT_LOCKED', 409);
  }
  if (
    message.includes('TASK_EDIT_INPUT_INVALID')
    || message.includes('TASK_EDIT_TIMEZONE_INVALID')
    || message.includes('COUNT_REQUIREMENT_INVALID')
    || error?.code === '22P02'
    || error?.code === '22007'
    || error?.code === '22008'
    || error?.code === '22023'
  ) {
    return new TaskEditServiceError('TASK_EDIT_INPUT_INVALID', 400);
  }
  return new TaskEditServiceError('TASK_EDIT_UNAVAILABLE', 500);
}

async function loadUpdatedTaskProjection(
  authenticated: SupabaseClient,
  authorization: Extract<CompanyApiAuthorization, { authorized: true }>,
  taskId: string,
  companyTimezone: string,
): Promise<TaskListItem> {
  const tasks = await loadCompanyTasks({
    async listTasks(companyId) {
      return authenticated
        .from('tasks')
        .select(
          'id, title, description, priority, status, due_date, due_at, assigned_employee_id, location:locations(id,name), created_at, updated_at',
        )
        .eq('company_id', companyId)
        .eq('id', taskId)
        .limit(1);
    },
    async listEmployees(companyId, employeeIds) {
      return authenticated
        .from('employees')
        .select('id, first_name, last_name')
        .eq('company_id', companyId)
        .in('id', employeeIds);
    },
  }, authorization.companyId, null, companyTimezone);
  if (tasks.length !== 1) throw new TaskEditServiceError('TASK_EDIT_UNAVAILABLE', 500);

  const { data: languageProfile, error: languageError } = await authenticated
    .from('profiles')
    .select('preferred_language')
    .eq('id', authorization.profileId)
    .maybeSingle();
  if (languageError) throw new TaskEditServiceError('TASK_EDIT_UNAVAILABLE', 500);
  const language = languageProfile?.preferred_language === 'ar' ? 'ar' : 'en';
  const localizations = await loadTaskDisplayLocalizations({
    companyId: authorization.companyId,
    language,
    tasks: [{ id: tasks[0].id, title: tasks[0].title, description: tasks[0].description }],
  });
  const { data: requirementRows, error: requirementError } = await authenticated.rpc(
    'list_my_task_evidence_count_requirements',
  );
  if (requirementError) throw new TaskEditServiceError('TASK_EDIT_UNAVAILABLE', 500);
  const requirementRow = Array.isArray(requirementRows)
    ? requirementRows.find((row) =>
        typeof row === 'object'
        && row !== null
        && row.task_id === taskId)
    : null;
  return {
    ...tasks[0],
    ...localizations.get(tasks[0].id),
    countRequirement: requirementRow
      && typeof requirementRow === 'object'
      && 'requirement' in requirementRow
      && typeof requirementRow.requirement === 'object'
      ? requirementRow.requirement as TaskListItem['countRequirement']
      : null,
  };
}

export async function updateManagementTask(
  authenticated: SupabaseClient,
  serviceRole: SupabaseClient,
  authorization: Extract<CompanyApiAuthorization, { authorized: true }>,
  input: TaskEditRequest,
): Promise<{ task: TaskListItem; outcome: 'updated' | 'unchanged' }> {
  if (!isTaskEditRole(authorization.role)) {
    throw new TaskEditServiceError('TASK_EDIT_FORBIDDEN', 403);
  }

  const [{ data: currentTask, error: taskError }, { data: company, error: companyError }] =
    await Promise.all([
      authenticated
        .from('tasks')
        .select('id, due_date, due_at')
        .eq('id', input.taskId)
        .eq('company_id', authorization.companyId)
        .maybeSingle(),
      authenticated
        .from('companies')
        .select('timezone')
        .eq('id', authorization.companyId)
        .maybeSingle(),
    ]);

  if (taskError) throw new TaskEditServiceError('TASK_EDIT_UNAVAILABLE', 500);
  if (!currentTask) throw new TaskEditServiceError('TASK_EDIT_NOT_FOUND', 404);
  if (companyError) throw new TaskEditServiceError('TASK_EDIT_UNAVAILABLE', 500);
  const companyTimezone = typeof company?.timezone === 'string' ? company.timezone : '';
  try {
    new Intl.DateTimeFormat('en', { timeZone: companyTimezone }).format();
  } catch {
    throw new TaskEditServiceError('TASK_EDIT_INPUT_INVALID', 400);
  }

  const updatesCountRequirement = Object.hasOwn(input.patch, 'countRequirement');
  const { countRequirement: requestedCountRequirement, ...taskPatch } = input.patch;
  const canonicalTaskPatch = canonicalizeTaskEditPatch(
    taskPatch,
    {
      dueDate: typeof currentTask.due_date === 'string' ? currentTask.due_date : null,
      dueAt: typeof currentTask.due_at === 'string' ? currentTask.due_at : null,
    },
    companyTimezone,
  );
  const { data, error } = await serviceRole.rpc(
    'update_management_task_with_count_requirement',
    {
      p_actor_profile_id: authorization.profileId,
      p_company_id: authorization.companyId,
      p_task_id: input.taskId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_patch: canonicalTaskPatch,
      p_count_requirement: requestedCountRequirement ?? null,
      p_update_count_requirement: updatesCountRequirement,
    },
  );
  if (error) throw mapDatabaseError(error);
  const result = Array.isArray(data) ? data[0] : data;
  if (
    !result
    || typeof result !== 'object'
    || !('update_outcome' in result)
    || (result.update_outcome !== 'updated' && result.update_outcome !== 'unchanged')
  ) {
    throw new TaskEditServiceError('TASK_EDIT_UNAVAILABLE', 500);
  }

  return {
    task: await loadUpdatedTaskProjection(
      authenticated,
      authorization,
      input.taskId,
      companyTimezone,
    ),
    outcome: result.update_outcome,
  };
}
