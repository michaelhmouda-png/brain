import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { canManageEmployees, normalizeEmployeeMutationError } from '@/lib/employees/contracts';
import { updateEmployee } from '@/lib/employees/service.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

function statusFor(code: string) {
  if (code === 'UNAUTHENTICATED') return 401;
  if (code === 'EMPLOYEE_FORBIDDEN' || code === 'ACCOUNT_NOT_PROVISIONED' || code === 'ACCOUNT_INACTIVE') return 403;
  if (code === 'EMPLOYEE_NOT_FOUND') return 404;
  if (code === 'EMPLOYEE_SAVE_UNAVAILABLE' || code === 'ACTOR_CONTEXT_UNAVAILABLE') return 503;
  return 400;
}

function failure(operation: 'update' | 'delete', requestId: string | null, error: unknown) {
  const code = error instanceof ActorContextError
    ? error.code
    : normalizeEmployeeMutationError(error);
  console.warn('[Employee mutation] rejected', { operation, requestId, code });
  return NextResponse.json({ error: code }, { status: statusFor(code) });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authenticated = await createSupabaseServerAuth();
  let requestId: string | null = null;
  try {
    const actor = await resolveActorContext(authenticated);
    requestId = actor.correlationId;
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const employee = await updateEmployee(authenticated, actor, id, body);
    return NextResponse.json(employee, { status: 200 });
  } catch (error) {
    return failure('update', requestId, error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authenticated = await createSupabaseServerAuth();
  let requestId: string | null = null;
  try {
    const actor = await resolveActorContext(authenticated);
    requestId = actor.correlationId;
    if (!canManageEmployees(actor.role)) throw new Error('EMPLOYEE_FORBIDDEN');
    const { id } = await params;
    const { data, error } = await authenticated.from('employees')
      .delete()
      .eq('id', id)
      .eq('company_id', actor.companyId)
      .select('id')
      .maybeSingle();
    if (error) throw new Error('EMPLOYEE_SAVE_UNAVAILABLE');
    if (!data) throw new Error('EMPLOYEE_NOT_FOUND');
    return NextResponse.json({ message: 'Employee deleted.' }, { status: 200 });
  } catch (error) {
    return failure('delete', requestId, error);
  }
}
