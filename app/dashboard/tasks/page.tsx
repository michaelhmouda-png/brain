'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, RefreshCw, UserRound } from 'lucide-react';
import { ClientApiError, fetchJsonCollection, isRecord, logRouteDiagnostic, stringField } from '@/lib/client-api';
import type { TaskListItem } from '@/lib/task-list';
import { useLocale } from '@/components/LocaleProvider';

function taskFromPayload(value: unknown): TaskListItem | null {
  if (!isRecord(value) || !isRecord(value.assignedEmployee) && value.assignedEmployee !== null) return null;
  const priority = stringField(value, 'priority');
  const status = stringField(value, 'status');
  if (!['critical', 'high', 'medium', 'low'].includes(priority) ||
      !['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) return null;
  const assigned = isRecord(value.assignedEmployee) ? value.assignedEmployee : null;
  return {
    id: stringField(value, 'id'),
    title: stringField(value, 'title'),
    description: typeof value.description === 'string' ? value.description : null,
    priority: priority as TaskListItem['priority'],
    status: status as TaskListItem['status'],
    dueDate: typeof value.dueDate === 'string' ? value.dueDate : null,
    assignedEmployee: assigned ? {
      id: stringField(assigned, 'id'),
      firstName: stringField(assigned, 'firstName'),
      lastName: typeof assigned.lastName === 'string' ? assigned.lastName : null,
    } : null,
    createdAt: stringField(value, 'createdAt'),
    updatedAt: stringField(value, 'updatedAt'),
  };
}

const priorityStyle: Record<TaskListItem['priority'], string> = {
  critical: 'border-red-400/30 bg-red-500/10 text-red-200',
  high: 'border-orange-400/30 bg-orange-500/10 text-orange-200',
  medium: 'border-yellow-400/30 bg-yellow-500/10 text-yellow-100',
  low: 'border-blue-400/30 bg-blue-500/10 text-blue-200',
};

type TaskTranslation = { title: string; description: string | null };
type TranslationFailure = 'unauthorized' | 'invalid' | 'service' | 'malformed';

const translationMessages: Record<TranslationFailure, string> = {
  unauthorized: 'تعذّر الوصول إلى ترجمة هذه المهام. حدّث الصفحة أو سجّل الدخول مجددًا.',
  invalid: 'تعذّر إرسال المهام للترجمة. حدّث قائمة المهام وحاول مجددًا.',
  service: 'خدمة الترجمة غير متاحة مؤقتًا. يمكنك متابعة المهمة الأصلية والمحاولة مجددًا.',
  malformed: 'تعذّر التحقق من الترجمة العربية. يمكنك متابعة المهمة الأصلية والمحاولة مجددًا.',
};

function translationsFromPayload(value: unknown, expectedIds: Set<string>): Record<string, TaskTranslation> | null {
  if (!isRecord(value) || !isRecord(value.translations)) return null;
  const entries = Object.entries(value.translations);
  if (entries.length !== expectedIds.size) return null;
  const result: Record<string, TaskTranslation> = {};
  for (const [taskId, translation] of entries) {
    if (!expectedIds.has(taskId) || !isRecord(translation)) return null;
    const title = translation.title;
    const description = translation.description;
    if (typeof title !== 'string' || title.trim().length === 0 || (description !== null && typeof description !== 'string')) return null;
    result[taskId] = { title: title.trim(), description };
  }
  return Object.keys(result).length === expectedIds.size ? result : null;
}

export default function TasksPage() {
  const { language, role, messages: t } = useLocale();
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; authorization: boolean } | null>(null);
  const [translations, setTranslations] = useState<Record<string, TaskTranslation>>({});
  const [translationFailure, setTranslationFailure] = useState<TranslationFailure | null>(null);
  const [translationsLoading, setTranslationsLoading] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const completeTask = async (taskId: string) => {
    setCompletingId(taskId); setError(null);
    try {
      const response = await fetch('/api/tasks', { method: 'PATCH', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId }) });
      if (!response.ok) throw new Error(t.tasks.failed);
      setTasks((current) => role === 'employee'
        ? current.filter((task) => task.id !== taskId)
        : current.map((task) => task.id === taskId ? { ...task, status: 'completed' } : task));
    } catch (completeError) { setError({ authorization: false, message: completeError instanceof Error ? completeError.message : t.tasks.failed }); }
    finally { setCompletingId(null); }
  };

  const loadTranslations = useCallback(async (visibleTasks: TaskListItem[], signal?: AbortSignal) => {
    if (language !== 'ar' || visibleTasks.length === 0) {
      setTranslations({});
      setTranslationFailure(null);
      return;
    }
    setTranslationsLoading(true);
    setTranslationFailure(null);
    const taskIds = visibleTasks.map((task) => task.id);
    try {
      const response = await fetch('/api/tasks/translations', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds }), signal,
      });
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.includes('application/json')) {
        setTranslations({});
        setTranslationFailure('malformed');
        return;
      }
      const payload: unknown = await response.json();
      if (!response.ok) {
        setTranslations({});
        setTranslationFailure(response.status === 401 || response.status === 403
          ? 'unauthorized'
          : response.status === 400 || response.status === 409
            ? 'invalid'
            : response.status === 500 || response.status === 503
              ? 'service'
              : 'malformed');
        return;
      }
      const validated = translationsFromPayload(payload, new Set(taskIds));
      if (!validated) {
        setTranslations({});
        setTranslationFailure('malformed');
        return;
      }
      setTranslations(validated);
    } catch (translationError) {
      if (signal?.aborted) return;
      setTranslations({});
      setTranslationFailure(translationError instanceof TypeError ? 'service' : 'malformed');
    } finally {
      if (!signal?.aborted) setTranslationsLoading(false);
    }
  }, [language]);

  const loadTasks = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    const controller = signal ? null : new AbortController();
    try {
      const values = await fetchJsonCollection('Tasks', '/api/tasks', signal ?? controller!.signal);
      const parsed = values.map(taskFromPayload);
      if (parsed.some((task) => task === null)) throw new Error('INVALID_TASK_RESPONSE');
      const visibleTasks = role === 'employee'
        ? (parsed as TaskListItem[]).filter((task) => task.status === 'pending' || task.status === 'in_progress')
        : parsed as TaskListItem[];
      setTasks(visibleTasks);
      await loadTranslations(visibleTasks, signal ?? controller!.signal);
    } catch (loadError) {
      if (signal?.aborted || controller?.signal.aborted) return;
      logRouteDiagnostic('Tasks', loadError);
      const status = loadError instanceof ClientApiError ? loadError.diagnostic.status : undefined;
      setError({
        authorization: status === 401 || status === 403,
        message: status === 401
          ? t.tasks.session
          : status === 403
            ? t.tasks.unauthorized
            : status === 409
              ? t.tasks.unlinked
            : t.tasks.failed,
      });
    } finally {
      if (!signal?.aborted && !controller?.signal.aborted) setLoading(false);
    }
  }, [loadTranslations, role, t]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadTasks(controller.signal));
    return () => controller.abort();
  }, [loadTasks]);

  return (
    <div className="space-y-6 rounded-[28px] border border-white/10 bg-white/5 p-4 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:space-y-8 sm:rounded-[36px] sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-cyan-300">{t.tasks.eyebrow}</p>
          <h1 className="mt-3 text-3xl font-black text-white sm:text-4xl">{t.tasks.title}</h1>
          <p className="mt-3 max-w-2xl text-slate-300">{t.tasks.description}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadTasks()}
          disabled={loading}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t.tasks.refresh}
        </button>
      </div>

      {loading && tasks.length === 0 && (
        <div aria-label={t.tasks.loading} className="space-y-3" role="status">
          {[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl bg-white/5" />)}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-5" role="alert">
          <div className="flex gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" /><div>
            <p className="font-semibold text-red-100">{error.authorization ? t.tasks.access : t.tasks.unable}</p>
            <p className="mt-1 text-sm text-red-100/80">{error.message}</p>
          </div></div>
          {!error.authorization && <button type="button" onClick={() => void loadTasks()} className="mt-4 min-h-11 rounded-xl bg-red-100 px-4 text-sm font-semibold text-red-950">{t.tasks.retry}</button>}
        </div>
      )}

      {!loading && !error && tasks.length === 0 && (
        <div className="rounded-3xl border border-dashed border-white/15 bg-slate-950/50 p-8 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-cyan-300" />
          <p className="mt-4 text-lg font-semibold text-white">{t.tasks.emptyTitle}</p>
          <p className="mt-2 text-sm text-slate-400">{t.tasks.empty}</p>
        </div>
      )}

      {language === 'ar' && tasks.length > 0 && translationFailure && (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4" role="alert">
          <p className="text-sm text-amber-100">{translationMessages[translationFailure]}</p>
          <button type="button" disabled={translationsLoading} onClick={() => void loadTranslations(tasks)} className="mt-3 min-h-11 rounded-xl bg-amber-100 px-4 text-sm font-semibold text-amber-950 disabled:opacity-60">
            {translationsLoading ? 'جارٍ طلب الترجمة...' : 'إعادة محاولة الترجمة'}
          </button>
        </div>
      )}

      {!error && tasks.length > 0 && <div className="grid gap-3 xl:grid-cols-2">
        {tasks.map((task) => (
          <article key={task.id} className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><h2 className="break-words text-lg font-bold text-white">{language === 'ar' && translations[task.id] ? translations[task.id].title : task.title}</h2>
                {language === 'ar' && <p className="mt-1 text-xs font-semibold text-cyan-300">{t.tasks.arabicTranslation}</p>}
                {language === 'ar' && translationsLoading && !translations[task.id] && <p className="mt-2 text-sm text-slate-400">جارٍ إعداد الترجمة العربية...</p>}
                {language === 'ar' && translations[task.id]?.description && <p className="mt-2 break-words text-sm text-slate-300">{translations[task.id].description}</p>}
                <div className={language === 'ar' ? 'mt-3 border-t border-white/10 pt-3' : ''} dir="auto">
                  {language === 'ar' && <p className="mb-1 text-xs font-semibold text-slate-500">{t.tasks.original}</p>}
                  {language !== 'ar' && task.description ? <p className="mt-2 break-words text-sm text-slate-300">{task.description}</p> : language === 'ar' ? <><p className="break-words text-sm font-medium text-slate-200">{task.title}</p>{task.description && <p className="mt-1 break-words text-sm text-slate-400">{task.description}</p>}</> : null}
                </div>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${priorityStyle[task.priority]}`}>{t.priority[task.priority]}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-400">
              <span className="text-slate-200">{t.status[task.status]}</span>
              <span className="inline-flex items-center gap-1.5"><UserRound className="h-4 w-4" />{task.assignedEmployee ? `${task.assignedEmployee.firstName} ${task.assignedEmployee.lastName ?? ''}`.trim() : t.tasks.unassigned}</span>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{task.dueDate ? new Intl.DateTimeFormat(language === 'ar' ? 'ar-LB' : 'en', { dateStyle: 'medium' }).format(new Date(task.dueDate)) : t.tasks.noDue}</span>
            </div>
            {role === 'employee' && task.status !== 'completed' && task.status !== 'cancelled' && <button type="button" disabled={completingId === task.id} onClick={() => void completeTask(task.id)} className="mt-4 min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-60">{completingId === task.id ? t.tasks.completing : t.tasks.complete}</button>}
          </article>
        ))}
      </div>}
    </div>
  );
}
