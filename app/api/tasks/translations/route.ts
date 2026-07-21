import { NextResponse } from 'next/server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { resolveTaskVisibilityScope } from '@/lib/task-visibility';
import {
  TaskTranslationError,
  translateAuthorizedTaskRecords,
} from '@/lib/brain/employee-task-presentation.server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };
type FailureStage = 'openai.initialize' | 'openai.request' | 'openai.extract' | 'openai.validate' | 'openai.convert';

function safeDiagnostic(stage: FailureStage, category: string, requestedTaskCount: number, returnedTranslationCount: number, languageIsArabic: boolean) {
  console.error('[Task Translations] request failed', {
    stage,
    category,
    requestedTaskCount,
    returnedTranslationCount,
    languageIsArabic,
  });
}

function unavailable(code: string) {
  return NextResponse.json({ error: 'Translation temporarily unavailable', code }, { status: 503, headers: HEADERS });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerAuth();
  const auth = await authorizeCompanyApiRequestFromSupabase(supabase);
  if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized', code: 'TASK_TRANSLATION_UNAUTHORIZED' }, { status: auth.status, headers: HEADERS });

  const { data: profile, error: profileError } = await supabase.from('profiles').select('preferred_language').eq('id', auth.profileId).maybeSingle();
  if (profileError) return unavailable('TASK_TRANSLATION_PROFILE_UNAVAILABLE');
  const languageIsArabic = profile?.preferred_language === 'ar';
  if (!languageIsArabic) return NextResponse.json({ translations: {} }, { headers: HEADERS });

  const body: unknown = await request.json().catch(() => null);
  const taskIds = body && typeof body === 'object' && !Array.isArray(body) && 'taskIds' in body && Array.isArray((body as Record<string, unknown>).taskIds)
    ? (body as { taskIds: unknown[] }).taskIds : [];
  if (taskIds.length === 0 || taskIds.length > 50 || taskIds.some((id) => typeof id !== 'string' || !UUID.test(id)) || new Set(taskIds).size !== taskIds.length) {
    return NextResponse.json({ error: 'Invalid task selection', code: 'TASK_TRANSLATION_INVALID_REQUEST' }, { status: 400, headers: HEADERS });
  }

  const requestedTaskIds = taskIds as string[];
  const visibility = resolveTaskVisibilityScope(auth);
  if (visibility.kind === 'missing_employee_link') return NextResponse.json({ error: 'Employee link required', code: 'TASK_TRANSLATION_EMPLOYEE_LINK_REQUIRED' }, { status: 409, headers: HEADERS });
  let query = supabase.from('tasks').select('id,title,description').eq('company_id', auth.companyId).in('id', requestedTaskIds);
  if (visibility.kind === 'assigned') query = query.eq('assigned_employee_id', visibility.employeeId);
  const { data: tasks, error } = await query;
  if (error || !Array.isArray(tasks)) return unavailable('TASK_TRANSLATION_QUERY_UNAVAILABLE');

  const authorizedTaskIds = new Set(tasks.map((task) => task.id));
  if (authorizedTaskIds.size !== requestedTaskIds.length || requestedTaskIds.some((id) => !authorizedTaskIds.has(id))) {
    return NextResponse.json({ error: 'Task selection is not authorized', code: 'TASK_TRANSLATION_SCOPE_DENIED' }, { status: 403, headers: HEADERS });
  }

  const requestedTaskCount = requestedTaskIds.length;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    safeDiagnostic('openai.initialize', 'configuration_unavailable', requestedTaskCount, 0, languageIsArabic);
    return unavailable('TASK_TRANSLATION_CONFIGURATION_UNAVAILABLE');
  }

  let translated: Map<string, { title: string; description: string | null }>;
  try {
    translated = await translateAuthorizedTaskRecords(tasks.map((task) => ({
      id: task.id,
      originalTitle: task.title,
      originalDescription: task.description,
    })), 'ar', { apiKey });
  } catch (error) {
    const stage = error instanceof TaskTranslationError ? error.stage : 'request';
    const diagnosticStage: FailureStage = `openai.${stage}`;
    safeDiagnostic(diagnosticStage, stage === 'initialize' ? 'client_initialization_failed' :
      stage === 'request' ? 'responses_api_failed' : 'structured_output_invalid', requestedTaskCount,
    error instanceof TaskTranslationError ? error.returnedTranslationCount : 0, languageIsArabic);
    return unavailable(stage === 'initialize' || stage === 'request'
      ? 'TASK_TRANSLATION_SERVICE_UNAVAILABLE'
      : 'TASK_TRANSLATION_MALFORMED_RESPONSE');
  }

  try {
    const translations = Object.fromEntries(translated);
    return NextResponse.json({ translations }, { headers: HEADERS });
  } catch {
    safeDiagnostic('openai.convert', 'response_conversion_failed', requestedTaskCount, translated.size, languageIsArabic);
    return unavailable('TASK_TRANSLATION_MALFORMED_RESPONSE');
  }
}
