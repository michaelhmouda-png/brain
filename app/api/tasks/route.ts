import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { loadCompanyTasks } from '@/lib/task-list';

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

    const tasks = await loadCompanyTasks({
      async listTasks(companyId) {
        return supabase
          .from('tasks')
          .select('id, title, description, priority, status, due_date, assigned_employee_id, created_at, updated_at')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false });
      },
      async listEmployees(companyId, employeeIds) {
        return supabase
          .from('employees')
          .select('id, first_name, last_name')
          .eq('company_id', companyId)
          .in('id', employeeIds);
      },
    }, authorization.companyId);

    return NextResponse.json(
      { data: tasks, total: tasks.length },
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
