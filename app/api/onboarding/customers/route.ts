import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import { isUuid, parseFirstCustomerPayload } from '@/lib/onboarding/contracts';
import { provisionFirstCustomer } from '@/lib/onboarding/customer-provisioning.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };

export async function POST(request: Request) {
  try {
    const idempotencyKey = request.headers.get('idempotency-key');
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const payload = parseFirstCustomerPayload(body?.payload);
    if (!isUuid(idempotencyKey) || body?.confirmed !== true || !payload) {
      return NextResponse.json({ error: 'ONBOARDING_INPUT_INVALID' }, { status: 400, headers: HEADERS });
    }
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    const result = await provisionFirstCustomer(actor, idempotencyKey, payload);
    return NextResponse.json({ data: result }, { status: 201, headers: HEADERS });
  } catch (error) {
    const code = error instanceof ActorContextError ? error.code
      : error instanceof Error && /^ONBOARDING_[A-Z0-9_]+$/.test(error.message) ? error.message
        : 'ONBOARDING_UNAVAILABLE';
    const status = code === 'UNAUTHENTICATED' ? 401 : code === 'ONBOARDING_FORBIDDEN' || code === 'ACCOUNT_INACTIVE' ? 403 : 503;
    return NextResponse.json({ error: code }, { status, headers: HEADERS });
  }
}
