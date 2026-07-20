import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { isUuid, TASK_EVIDENCE_BUCKET } from '@/lib/task-evidence';

export const dynamic = 'force-dynamic';
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid evidence identifier' }, { status: 400, headers: NO_STORE_HEADERS });
  const supabase = await createSupabaseServerAuth();
  const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
  if (!authorization.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: authorization.status, headers: NO_STORE_HEADERS });
  const { data, error } = await supabase.rpc('get_task_evidence_access', { p_evidence_id: id });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || typeof row !== 'object' || row === null || !('storage_path' in row) || typeof row.storage_path !== 'string') {
    return NextResponse.json({ error: 'Evidence is not available' }, { status: 404, headers: NO_STORE_HEADERS });
  }
  const { data: signed, error: signingError } = await supabase.storage.from(TASK_EVIDENCE_BUCKET).createSignedUrl(row.storage_path, 300);
  if (signingError || !signed?.signedUrl) return NextResponse.json({ error: 'Evidence access is temporarily unavailable' }, { status: 503, headers: NO_STORE_HEADERS });
  return NextResponse.json({ signedUrl: signed.signedUrl, expiresIn: 300 }, { headers: NO_STORE_HEADERS });
}
