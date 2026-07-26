import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { isUuid } from '@/lib/reservations/contracts';
import { canManageReservations } from '@/lib/reservations/service.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; if (!isUuid(id)) return NextResponse.json({ error: 'RESERVATION_INPUT_INVALID' }, { status: 400, headers: HEADERS });
    const client = await createSupabaseServerAuth(); const actor = await resolveActorContext(client);
    if (!canManageReservations(actor.role)) return NextResponse.json({ error: 'RESERVATION_FORBIDDEN' }, { status: 403, headers: HEADERS });
    const { data, error } = await client.from('reservations').select('*,guest:reservation_guests(id,first_name,last_name,phone_e164,preferred_language,marketing_consent),history:reservation_status_history(id,previous_status,new_status,reason,changed_at)').eq('id', id).eq('company_id', actor.companyId).maybeSingle();
    if (error) return NextResponse.json({ error: 'RESERVATION_UNAVAILABLE' }, { status: 503, headers: HEADERS });
    if (!data) return NextResponse.json({ error: 'RESERVATION_NOT_FOUND' }, { status: 404, headers: HEADERS });
    return NextResponse.json({ data }, { headers: HEADERS });
  } catch { return NextResponse.json({ error: 'RESERVATION_UNAVAILABLE' }, { status: 503, headers: HEADERS }); }
}
