'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, RefreshCw, UserRound } from 'lucide-react';
import { ClientApiError, fetchJsonCollection, isRecord, logRouteDiagnostic, stringField } from '@/lib/client-api';
import type { TaskListItem } from '@/lib/task-list';

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

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; authorization: boolean } | null>(null);

  const loadTasks = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    const controller = signal ? null : new AbortController();
    try {
      const values = await fetchJsonCollection('Tasks', '/api/tasks', signal ?? controller!.signal);
      const parsed = values.map(taskFromPayload);
      if (parsed.some((task) => task === null)) throw new Error('INVALID_TASK_RESPONSE');
      setTasks(parsed as TaskListItem[]);
    } catch (loadError) {
      if (signal?.aborted || controller?.signal.aborted) return;
      logRouteDiagnostic('Tasks', loadError);
      const status = loadError instanceof ClientApiError ? loadError.diagnostic.status : undefined;
      setError({
        authorization: status === 401 || status === 403,
        message: status === 401
          ? 'Your session has expired. Please sign in again.'
          : status === 403
            ? 'Your account is not authorized for a company workspace.'
            : 'Tasks could not be loaded. Check your connection and try again.',
      });
    } finally {
      if (!signal?.aborted && !controller?.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadTasks(controller.signal));
    return () => controller.abort();
  }, [loadTasks]);

  return (
    <div className="space-y-6 rounded-[28px] border border-white/10 bg-white/5 p-4 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:space-y-8 sm:rounded-[36px] sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-cyan-300">Tasks</p>
          <h1 className="mt-3 text-3xl font-black text-white sm:text-4xl">Operational workflow</h1>
          <p className="mt-3 max-w-2xl text-slate-300">Live company tasks, including work created and approved through Brain.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadTasks()}
          disabled={loading}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading && tasks.length === 0 && (
        <div aria-label="Loading tasks" className="space-y-3" role="status">
          {[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl bg-white/5" />)}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-5" role="alert">
          <div className="flex gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" /><div>
            <p className="font-semibold text-red-100">{error.authorization ? 'Access unavailable' : 'Unable to load tasks'}</p>
            <p className="mt-1 text-sm text-red-100/80">{error.message}</p>
          </div></div>
          {!error.authorization && <button type="button" onClick={() => void loadTasks()} className="mt-4 min-h-11 rounded-xl bg-red-100 px-4 text-sm font-semibold text-red-950">Try again</button>}
        </div>
      )}

      {!loading && !error && tasks.length === 0 && (
        <div className="rounded-3xl border border-dashed border-white/15 bg-slate-950/50 p-8 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-cyan-300" />
          <p className="mt-4 text-lg font-semibold text-white">No tasks yet</p>
          <p className="mt-2 text-sm text-slate-400">Tasks created for this company will appear here immediately.</p>
        </div>
      )}

      {!error && tasks.length > 0 && <div className="grid gap-3 xl:grid-cols-2">
        {tasks.map((task) => (
          <article key={task.id} className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><h2 className="break-words text-lg font-bold text-white">{task.title}</h2>
                {task.description && <p className="mt-2 break-words text-sm text-slate-300">{task.description}</p>}
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${priorityStyle[task.priority]}`}>{task.priority}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-400">
              <span className="capitalize text-slate-200">{task.status.replace('_', ' ')}</span>
              <span className="inline-flex items-center gap-1.5"><UserRound className="h-4 w-4" />{task.assignedEmployee ? `${task.assignedEmployee.firstName} ${task.assignedEmployee.lastName ?? ''}`.trim() : 'Unassigned'}</span>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{task.dueDate ? new Date(task.dueDate).toLocaleString() : 'No due date'}</span>
            </div>
          </article>
        ))}
      </div>}
    </div>
  );
}
