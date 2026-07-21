import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { loadCompanyTasks } from '@/lib/task-list';
import { resolveTaskVisibilityScope } from '@/lib/task-visibility';

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

    return NextResponse.json(
      {
        data: tasks,
        total: tasks.length,
        scope: visibility.kind,
        diagnostic: tasks.length === 0 && visibility.kind === 'assigned' ? 'NO_ASSIGNED_TASKS' : null,
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
  if (!authorization.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: authorization.status, headers: NO_STORE_HEADERS });
  const body: unknown = await request.json().catch(() => null);
  const taskId = body && typeof body === 'object' && !Array.isArray(body) && 'taskId' in body ? (body as Record<string, unknown>).taskId : null;
  if (typeof taskId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) return NextResponse.json({ error: 'Invalid task' }, { status: 400, headers: NO_STORE_HEADERS });
  if (authorization.role !== 'employee') return NextResponse.json({ error: 'Use the management task workflow' }, { status: 403, headers: NO_STORE_HEADERS });
  const { error } = await supabase.rpc('complete_my_assigned_task', { p_task_id: taskId });
  if (error) return NextResponse.json({ error: 'Task cannot be completed', code: 'TASK_NOT_COMPLETABLE' }, { status: 403, headers: NO_STORE_HEADERS });
  return NextResponse.json({ taskId, status: 'completed' }, { headers: NO_STORE_HEADERS });
}
