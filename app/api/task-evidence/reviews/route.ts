import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };

export async function GET() {
  const supabase = await createSupabaseServerAuth();
  const auth = await authorizeCompanyApiRequestFromSupabase(supabase);
  if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status, headers: HEADERS });
  if (!['manager', 'owner', 'super_admin'].includes(auth.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: HEADERS });
  const { data, error } = await supabase.rpc('list_task_evidence_reviews');
  if (error) {
    console.error('[Task Evidence Review API] list failed', { stage: 'review.list', code: error.code, message: error.message });
    return NextResponse.json({ error: 'Evidence reviews are temporarily unavailable' }, { status: 503, headers: HEADERS });
  }
  return NextResponse.json({ evidence: data ?? [] }, { headers: HEADERS });
}
