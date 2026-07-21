import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { isUuid } from '@/lib/task-evidence';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid evidence identifier' }, { status: 400, headers: HEADERS });
  const supabase = await createSupabaseServerAuth();
  const auth = await authorizeCompanyApiRequestFromSupabase(supabase);
  if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status, headers: HEADERS });
  const { data, error } = await supabase.rpc('enqueue_task_evidence_verification', { p_evidence_id: id });
  if (error) return NextResponse.json({ error: 'Evidence could not be queued for analysis' }, { status: 409, headers: HEADERS });
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ evidence: row }, { headers: HEADERS });
}
