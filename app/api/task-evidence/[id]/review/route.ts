import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { isUuid } from '@/lib/task-evidence';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid evidence identifier' }, { status: 400, headers: HEADERS });
  const supabase = await createSupabaseServerAuth();
  const auth = await authorizeCompanyApiRequestFromSupabase(supabase);
  if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status, headers: HEADERS });
  if (!['manager', 'owner', 'super_admin'].includes(auth.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: HEADERS });
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return NextResponse.json({ error: 'Invalid review' }, { status: 400, headers: HEADERS });
  const input = body as Record<string, unknown>;
  if ((input.decision !== 'approved' && input.decision !== 'rejected') || input.confirm !== true || (input.note !== undefined && typeof input.note !== 'string')) return NextResponse.json({ error: 'Explicit confirmation is required' }, { status: 400, headers: HEADERS });
  const { data, error } = await supabase.rpc('review_task_evidence', { p_evidence_id: id, p_decision: input.decision, p_note: input.note ?? '', p_confirm: true });
  if (error) return NextResponse.json({ error: 'Evidence could not be reviewed' }, { status: 409, headers: HEADERS });
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ evidence: row, message: 'Evidence reviewed; task status was not changed.' }, { headers: HEADERS });
}
