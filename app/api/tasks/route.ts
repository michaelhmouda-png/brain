import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';
import { loadCompanyTasks } from '@/lib/task-list';
import { resolveTaskVisibilityScope } from '@/lib/task-visibility';
import { loadTaskDisplayLocalizations } from '@/lib/task-localization.server';
import { buildTaskSnapshot, taskSnapshotProvenance } from '@/lib/task-metrics.server';
import {
  isTaskEditRole,
  parseTaskEditRequest,
  TaskEditInputError,
  type TaskEditOptions,
} from '@/lib/task-edit';
import { TaskEditServiceError, updateManagementTask } from '@/lib/task-edit.server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization',
};

export async function GET() {
  try {
    const supabase = await createSupabaseServerAuth();
    const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
    if (!authorization.authorized) {
      return NextResponse.json(
        {
          error: authorization.status === 401 ? 'Unauthorized' : 'Account is not provisioned',
          code: authorization.code,
        },
        { status: authorization.status, headers: NO_STORE_HEADERS },
      );
    }

    const visibility = resolveTaskVisibilityScope(authorization);
    if (visibility.kind === 'missing_employee_link') {
      console.warn('[Tasks API] Task visibility denied', {
        stage: 'task_visibility.resolve',
        outcome: 'missing_employee_link',
        persistedRole: authorization.role,
      });
      return NextResponse.json(
        { error: 'Your account is not linked to an employee record', code: 'TASK_EMPLOYEE_LINK_MISSING' },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    const { data: company, error: companyError } = await supabase
      .from('companies').select('timezone').eq('id', authorization.companyId).single();
    if (companyError) throw new Error('TASK_COMPANY_TIMEZONE_QUERY_FAILED');
    const companyTimezone = typeof company?.timezone === 'string' ? company.timezone : null;
    const tasks = await loadCompanyTasks({
      async listTasks(companyId, assignedEmployeeId) {
        let query = supabase
          .from('tasks')
          .select('id, title, description, priority, status, due_date, due_at, assigned_employee_id, location:locations(id,name), created_at, updated_at')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false });
        if (assignedEmployeeId) query = query.eq('assigned_employee_id', assignedEmployeeId);
        if (visibility.kind === 'assigned') query = query.in('status', ['pending', 'in_progress']);
        return query;
      },
      async listEmployees(companyId, employeeIds) {
        return supabase
          .from('employees')
          .select('id, first_name, last_name')
          .eq('company_id', companyId)
          .in('id', employeeIds);
      },
    }, authorization.companyId, visibility.kind === 'assigned' ? visibility.employeeId : null, companyTimezone);

    const { data: languageProfile, error: languageError } = await supabase
      .from('profiles').select('preferred_language').eq('id', authorization.profileId).maybeSingle();
    if (languageError) throw new Error('TASK_LANGUAGE_QUERY_FAILED');
    const language = languageProfile?.preferred_language === 'ar' ? 'ar' : 'en';
    const localizations = await loadTaskDisplayLocalizations({
      companyId: authorization.companyId,
      language,
      tasks: tasks.map((task) => ({ id: task.id, title: task.title, description: task.description })),
    });
    const localizedTasks = tasks.map((task) => ({ ...task, ...localizations.get(task.id) }));

    let editOptions: TaskEditOptions | null = null;
    if (isTaskEditRole(authorization.role)) {
      const [{ data: employees, error: employeeError }, { data: locations, error: locationError }] =
        await Promise.all([
          supabase
            .from('employees')
            .select('id, first_name, last_name')
            .eq('company_id', authorization.companyId)
            .eq('status', 'active')
            .order('first_name', { ascending: true })
            .order('last_name', { ascending: true }),
          supabase
            .from('locations')
            .select('id, name')
            .eq('company_id', authorization.companyId)
            .eq('status', 'active')
            .order('name', { ascending: true }),
        ]);
      if (employeeError || locationError || !Array.isArray(employees) || !Array.isArray(locations)) {
        throw new Error('TASK_EDIT_OPTIONS_QUERY_FAILED');
      }
      editOptions = {
        employees: employees.map((employee) => ({
          id: String(employee.id),
          name: `${String(employee.first_name ?? '')} ${String(employee.last_name ?? '')}`.trim(),
        })),
        locations: locations.map((location) => ({
          id: String(location.id),
          name: String(location.name ?? ''),
        })),
      };
    }

    if (visibility.kind === 'assigned' && tasks.length === 0) {
      const { data: visibleAssignedHistory, error: visibleAssignedHistoryError } = await supabase
        .from('tasks')
        .select('id')
        .eq('company_id', authorization.companyId)
        .eq('assigned_employee_id', visibility.employeeId)
        .limit(1);
      if (visibleAssignedHistoryError) throw new Error('TASK_VISIBILITY_HISTORY_PROBE_FAILED');
      if ((visibleAssignedHistory?.length ?? 0) > 0) {
        return NextResponse.json(
          { data: [], total: 0, scope: visibility.kind, diagnostic: 'NO_ACTIVE_ASSIGNED_TASKS' },
          { headers: NO_STORE_HEADERS },
        );
      }
      const { data: diagnosticData, error: diagnosticError } = await supabase.rpc('get_my_task_visibility_diagnostic');
      const diagnostic = Array.isArray(diagnosticData) ? diagnosticData[0] : diagnosticData;
      const rawAssignedCount = diagnostic && typeof diagnostic === 'object' && 'assigned_task_count' in diagnostic
        ? diagnostic.assigned_task_count : null;
      const assignedCount = typeof rawAssignedCount === 'number'
        ? rawAssignedCount
        : typeof rawAssignedCount === 'string' ? Number(rawAssignedCount) : null;
      if (diagnosticError || assignedCount === null || !Number.isFinite(assignedCount)) {
        console.error('[Tasks API] Task visibility diagnostic failed', {
          stage: 'task_visibility.diagnostic',
          outcome: 'query_failure',
          persistedRole: authorization.role,
          errorCode: diagnosticError?.code ?? null,
        });
        return NextResponse.json(
          { error: 'Assigned tasks are temporarily unavailable', code: 'TASK_VISIBILITY_DIAGNOSTIC_FAILED' },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }
      if (assignedCount > 0) {
        console.error('[Tasks API] Task visibility failed', {
          stage: 'task_visibility.rls', outcome: 'blocked_by_rls', persistedRole: authorization.role,
          linkedEmployee: true, assignedTaskCount: assignedCount,
        });
        return NextResponse.json(
          { error: 'Assigned tasks are temporarily unavailable', code: 'TASK_VISIBILITY_BLOCKED_BY_RLS' },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }
      console.info('[Tasks API] Task visibility empty', {
        stage: 'task_visibility.query', outcome: 'zero_assigned_tasks', persistedRole: authorization.role,
        linkedEmployee: true,
      });
    }

    const taskSnapshot = buildTaskSnapshot(
      localizedTasks.map((task) => ({
        id: task.id, status: task.status, priority: task.priority,
        due_date: task.dueDate, due_at: task.dueAt,
        assigned_employee_id: task.assignedEmployee?.id ?? null,
      })),
      companyTimezone ?? 'UTC',
    );

    return NextResponse.json(
      {
        data: localizedTasks,
        total: localizedTasks.length,
        metrics: taskSnapshot.metrics,
        task_snapshot: taskSnapshotProvenance(taskSnapshot),
        editOptions,
        scope: visibility.kind,
        diagnostic: localizedTasks.length === 0 && visibility.kind === 'assigned' ? 'NO_ASSIGNED_TASKS' : null,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('[Tasks API] GET failed', {
      stage: 'task_list.read',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'unknown_error',
    });
    return NextResponse.json(
      { error: 'Tasks are temporarily unavailable', code: 'TASK_LIST_FAILED' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerAuth();
  const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
  if (!authorization.authorized) {
    return NextResponse.json(
      {
        error: authorization.status === 401 ? 'Unauthorized' : 'Account is not provisioned',
        code: authorization.code,
      },
      { status: authorization.status, headers: NO_STORE_HEADERS },
    );
  }
  const body: unknown = await request.json().catch(() => null);
  if (authorization.role === 'employee') {
    if (
      body
      && typeof body === 'object'
      && !Array.isArray(body)
      && ('patch' in body || 'expectedUpdatedAt' in body)
    ) {
      return NextResponse.json(
        { error: 'TASK_EDIT_FORBIDDEN', code: 'TASK_EDIT_FORBIDDEN' },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    const taskId = body && typeof body === 'object' && !Array.isArray(body) && 'taskId' in body
      ? (body as Record<string, unknown>).taskId
      : null;
    if (
      typeof taskId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)
    ) {
      return NextResponse.json(
        { error: 'Invalid task', code: 'TASK_INPUT_INVALID' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const { error } = await supabase.rpc('complete_my_assigned_task', { p_task_id: taskId });
    if (error) {
      return NextResponse.json(
        { error: 'Task cannot be completed', code: 'TASK_NOT_COMPLETABLE' },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json({ taskId, status: 'completed' }, { headers: NO_STORE_HEADERS });
  }

  try {
    const input = parseTaskEditRequest(body);
    const result = await updateManagementTask(
      supabase,
      createSupabaseServer(),
      authorization,
      input,
    );
    return NextResponse.json(
      { data: result.task, outcome: result.outcome },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof TaskEditInputError) {
      return NextResponse.json(
        { error: error.code, code: error.code, field: error.field },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (error instanceof TaskEditServiceError) {
      return NextResponse.json(
        { error: error.code, code: error.code },
        { status: error.status, headers: NO_STORE_HEADERS },
      );
    }
    console.error('[Tasks API] PATCH failed', {
      stage: 'task_edit.execute',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: 'TASK_EDIT_UNEXPECTED',
    });
    return NextResponse.json(
      { error: 'TASK_EDIT_UNAVAILABLE', code: 'TASK_EDIT_UNAVAILABLE' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
