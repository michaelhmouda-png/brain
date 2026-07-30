import { NextResponse } from 'next/server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import {
  createRecurringRule,
  configureLocationOperatingHours,
  listRecurringOutcomes,
  listRecurringRules,
  normalizeRecurringTaskError,
  previewRecurringRule,
} from '@/lib/recurring-tasks/service.server';
import { canManageRecurringTasks } from '@/lib/recurring-tasks/contracts';
import { createSupabaseServer, createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };
const fail = (code: string, status: number) => NextResponse.json({ error: code }, { status, headers: HEADERS });

function responseError(error: unknown) {
  if (error instanceof ActorContextError) return fail(error.code, error.code === 'UNAUTHENTICATED' ? 401 : 403);
  const code = normalizeRecurringTaskError(error);
  return fail(code, code === 'RECURRING_FORBIDDEN' ? 403 : code === 'RECURRING_UNAVAILABLE' ? 503 : 400);
}

export async function GET(request: Request) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageRecurringTasks(actor.role)) return fail('RECURRING_FORBIDDEN', 403);
    const ruleId = new URL(request.url).searchParams.get('ruleId') ?? undefined;
    const [rules, outcomes, locations, departments, employees, operatingHours] = await Promise.all([
      listRecurringRules(authenticated, actor),
      listRecurringOutcomes(authenticated, actor, ruleId),
      authenticated.from('locations').select('id,name,timezone').eq('company_id', actor.companyId).eq('status', 'active').order('name'),
      authenticated.from('departments').select('id,name,location_id').eq('company_id', actor.companyId).eq('status', 'active').order('name'),
      authenticated.from('employees').select('id,first_name,last_name,location_id,department_id,role').eq('company_id', actor.companyId).eq('status', 'active').order('first_name'),
      authenticated.from('location_operating_hours').select('location_id,weekday,is_closed,opens_at,closes_at').eq('company_id', actor.companyId).order('weekday'),
    ]);
    if (locations.error || departments.error || employees.error || operatingHours.error) throw new Error('RECURRING_UNAVAILABLE');
    return NextResponse.json({ data: {
      rules, outcomes, locations: locations.data ?? [], departments: departments.data ?? [], employees: employees.data ?? [],
      operatingHours: operatingHours.data ?? [], evaluatedAt: new Date().toISOString(),
    } }, { headers: HEADERS });
  } catch (error) { return responseError(error); }
}

export async function POST(request: Request) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageRecurringTasks(actor.role)) return fail('RECURRING_FORBIDDEN', 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('RECURRING_RULE_INVALID', 400);
    if ((body as Record<string, unknown>).preview === true) {
      return NextResponse.json({ data: await previewRecurringRule(
        createSupabaseServer(), actor, (body as Record<string, unknown>).rule,
      ) }, { headers: HEADERS });
    }
    return NextResponse.json({ data: await createRecurringRule(createSupabaseServer(), actor, body) }, {
      status: 201, headers: HEADERS,
    });
  } catch (error) { return responseError(error); }
}

export async function PUT(request: Request) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!canManageRecurringTasks(actor.role)) return fail('RECURRING_FORBIDDEN', 403);
    return NextResponse.json({ data: await configureLocationOperatingHours(
      createSupabaseServer(), actor, await request.json().catch(() => null),
    ) }, { headers: HEADERS });
  } catch (error) { return responseError(error); }
}
