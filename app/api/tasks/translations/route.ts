import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { resolveTaskVisibilityScope } from '@/lib/task-visibility';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };

export async function POST(request: Request) {
  const supabase = await createSupabaseServerAuth();
  const auth = await authorizeCompanyApiRequestFromSupabase(supabase);
  if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status, headers: HEADERS });
  const { data: profile } = await supabase.from('profiles').select('preferred_language').eq('id', auth.profileId).maybeSingle();
  if (profile?.preferred_language !== 'ar') return NextResponse.json({ translations: {} }, { headers: HEADERS });
  const body: unknown = await request.json().catch(() => null);
  const taskIds = body && typeof body === 'object' && !Array.isArray(body) && 'taskIds' in body && Array.isArray((body as Record<string, unknown>).taskIds)
    ? (body as { taskIds: unknown[] }).taskIds : [];
  if (taskIds.length === 0 || taskIds.length > 50 || taskIds.some((id) => typeof id !== 'string' || !UUID.test(id))) return NextResponse.json({ error: 'Invalid task selection' }, { status: 400, headers: HEADERS });
  const visibility = resolveTaskVisibilityScope(auth);
  if (visibility.kind === 'missing_employee_link') return NextResponse.json({ error: 'Employee link required' }, { status: 409, headers: HEADERS });
  let query = supabase.from('tasks').select('id,title,description').eq('company_id', auth.companyId).in('id', taskIds as string[]);
  if (visibility.kind === 'assigned') query = query.eq('assigned_employee_id', visibility.employeeId);
  const { data: tasks, error } = await query;
  if (error) return NextResponse.json({ error: 'Translation unavailable' }, { status: 503, headers: HEADERS });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.responses.create({ model: 'gpt-5-mini', instructions: 'Translate only task title and description text into clear Arabic suitable for a Lebanese hospitality employee. Preserve names, IDs, numbers, quantities, dates, and operational values exactly. Return only JSON object keyed by task id, each value {"title":string,"description":string|null}.', input: JSON.stringify(tasks ?? []) });
  let translations: unknown;
  try { translations = JSON.parse(response.output_text); } catch { return NextResponse.json({ error: 'Translation unavailable' }, { status: 503, headers: HEADERS }); }
  return NextResponse.json({ translations }, { headers: HEADERS });
}
