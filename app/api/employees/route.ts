import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { normalizeEmployeeMutationError } from '@/lib/employees/contracts';
import { createEmployee } from '@/lib/employees/service.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

function statusFor(code: string) {
  if (code === 'UNAUTHENTICATED') return 401;
  if (code === 'EMPLOYEE_FORBIDDEN' || code === 'ACCOUNT_NOT_PROVISIONED' || code === 'ACCOUNT_INACTIVE') return 403;
  if (code === 'EMPLOYEE_NOT_FOUND') return 404;
  if (code === 'EMPLOYEE_SAVE_UNAVAILABLE' || code === 'ACTOR_CONTEXT_UNAVAILABLE') return 503;
  return 400;
}

export async function POST(request: Request) {
  const authenticated = await createSupabaseServerAuth();
  let requestId: string | null = null;
  try {
    const actor = await resolveActorContext(authenticated);
    requestId = actor.correlationId;
    const body = await request.json().catch(() => null);
    const employee = await createEmployee(authenticated, actor, body);
    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    const code = error instanceof ActorContextError
      ? error.code
      : normalizeEmployeeMutationError(error);
    console.warn('[Employee mutation] rejected', { operation: 'create', requestId, code });
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  }
}
