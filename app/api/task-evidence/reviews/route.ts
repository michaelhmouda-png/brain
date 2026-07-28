import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { loadTaskDisplayLocalizations } from '@/lib/task-localization.server';

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
  const evidence = Array.isArray(data) ? data : [];
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('preferred_language')
    .eq('id', auth.profileId)
    .maybeSingle();
  if (profileError) {
    return NextResponse.json(
      { error: 'Evidence reviews are temporarily unavailable' },
      { status: 503, headers: HEADERS },
    );
  }
  const language = profile?.preferred_language === 'ar' ? 'ar' : 'en';
  const localizations = await loadTaskDisplayLocalizations({
    companyId: auth.companyId,
    language,
    tasks: evidence.flatMap((entry) =>
      typeof entry === 'object'
      && entry !== null
      && typeof entry.task_id === 'string'
      && typeof entry.task_title === 'string'
        ? [{
            id: entry.task_id,
            title: entry.task_title,
            description: typeof entry.task_description === 'string'
              ? entry.task_description
              : null,
          }]
        : []),
  });
  const enriched = await Promise.all(evidence.map(async (entry) => {
    if (
      typeof entry !== 'object'
      || entry === null
      || !('evidence_id' in entry)
      || typeof entry.evidence_id !== 'string'
    ) {
      return entry;
    }
    const { data: context, error: contextError } = await supabase.rpc(
      'get_task_evidence_submission_review_context',
      { p_evidence_id: entry.evidence_id },
    );
    if (contextError || typeof context !== 'object' || context === null) {
      return {
        ...entry,
        ...localizations.get(entry.task_id as string),
        submission_context: null,
      };
    }
    return {
      ...entry,
      ...localizations.get(entry.task_id as string),
      submission_context: context,
    };
  }));
  return NextResponse.json({ evidence: enriched }, { headers: HEADERS });
}
