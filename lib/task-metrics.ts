export const TASK_METRICS_SOURCE = 'public.tasks';
export const TASK_DEADLINE_RULE_VERSION = 'tasks-v1-due-at-else-local-date-end';
export const ACTIVE_TASK_STATUSES = ['pending', 'in_progress'] as const;

export type CanonicalTaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskMetricRow = {
  id: string;
  status: CanonicalTaskStatus;
  priority: string;
  due_date: string | null;
  due_at: string | null;
  assigned_employee_id?: string | null;
};
export type TaskMetrics = {
  total: number; active: number; pending: number; inProgress: number;
  completed: number; overdue: number; dueToday: number;
};

function companyDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function isTaskOverdue(row: TaskMetricRow, now: Date, timezone: string): boolean {
  if (!ACTIVE_TASK_STATUSES.includes(row.status as (typeof ACTIVE_TASK_STATUSES)[number])) return false;
  if (row.due_at) {
    const deadline = Date.parse(row.due_at);
    return Number.isFinite(deadline) && deadline < now.getTime();
  }
  return Boolean(row.due_date && row.due_date < companyDate(now, timezone));
}

export function calculateTaskMetrics(rows: readonly TaskMetricRow[], now: Date, timezone: string): TaskMetrics {
  const activeRows = rows.filter((row) =>
    ACTIVE_TASK_STATUSES.includes(row.status as (typeof ACTIVE_TASK_STATUSES)[number]));
  const today = companyDate(now, timezone);
  return {
    total: rows.length, active: activeRows.length,
    pending: rows.filter((row) => row.status === 'pending').length,
    inProgress: rows.filter((row) => row.status === 'in_progress').length,
    completed: rows.filter((row) => row.status === 'completed').length,
    overdue: activeRows.filter((row) => isTaskOverdue(row, now, timezone)).length,
    dueToday: activeRows.filter((row) => row.due_date === today).length,
  };
}
