import { NextResponse } from 'next/server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { isLanguage } from '@/lib/i18n';

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerAuth();
  const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
  if (!authorization.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: authorization.status, headers: HEADERS });
  const input: unknown = await request.json().catch(() => null);
  const language = input && typeof input === 'object' && !Array.isArray(input) && 'language' in input
    ? (input as Record<string, unknown>).language : null;
  if (!isLanguage(language)) return NextResponse.json({ error: 'Invalid language', code: 'INVALID_LANGUAGE' }, { status: 400, headers: HEADERS });
  const { data, error } = await supabase.rpc('update_my_preferred_language', { p_language: language });
  if (error || data !== language) return NextResponse.json({ error: 'Language update unavailable', code: 'LANGUAGE_UPDATE_FAILED' }, { status: 503, headers: HEADERS });
  return NextResponse.json({ language }, { headers: HEADERS });
}
