import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  calculateTaskMetrics, TASK_DEADLINE_RULE_VERSION, TASK_METRICS_SOURCE,
  type TaskMetricRow, type TaskMetrics,
} from './task-metrics';
export { calculateTaskMetrics, isTaskOverdue } from './task-metrics';
export { TASK_DEADLINE_RULE_VERSION } from './task-metrics';
export type { TaskMetricRow, TaskMetrics } from './task-metrics';

export type TaskSnapshot = {
  rows: TaskMetricRow[];
  metrics: TaskMetrics;
  companyTimezone: string;
  evaluatedAt: string;
  source: typeof TASK_METRICS_SOURCE;
  deadlineRuleVersion: typeof TASK_DEADLINE_RULE_VERSION;
};

export type TaskSnapshotProvenance = {
  evaluatedAt: string;
  companyTimezone: string;
  taskRuleVersion: typeof TASK_DEADLINE_RULE_VERSION;
  activeCount: number;
  overdueCount: number;
};

export function buildTaskSnapshot(
  rows: TaskMetricRow[],
  companyTimezone: string,
  evaluatedAt = new Date(),
): TaskSnapshot {
  return {
    rows,
    metrics: calculateTaskMetrics(rows, evaluatedAt, companyTimezone),
    companyTimezone,
    evaluatedAt: evaluatedAt.toISOString(),
    source: TASK_METRICS_SOURCE,
    deadlineRuleVersion: TASK_DEADLINE_RULE_VERSION,
  };
}

export function taskSnapshotProvenance(snapshot: TaskSnapshot): TaskSnapshotProvenance {
  return {
    evaluatedAt: snapshot.evaluatedAt,
    companyTimezone: snapshot.companyTimezone,
    taskRuleVersion: snapshot.deadlineRuleVersion,
    activeCount: snapshot.metrics.active,
    overdueCount: snapshot.metrics.overdue,
  };
}

export async function loadTaskSnapshot(input: {
  supabase: SupabaseClient;
  companyId: string;
  assignedEmployeeId?: string | null;
  now?: Date;
}): Promise<TaskSnapshot> {
  const { supabase, companyId, assignedEmployeeId = null } = input;
  const [{ data: company, error: companyError }, taskResult] = await Promise.all([
    supabase.from('companies').select('timezone').eq('id', companyId).single(),
    (() => {
      let query = supabase.from('tasks')
        .select('id,status,priority,due_date,due_at,assigned_employee_id')
        .eq('company_id', companyId);
      if (assignedEmployeeId) query = query.eq('assigned_employee_id', assignedEmployeeId);
      return query;
    })(),
  ]);
  if (companyError || typeof company?.timezone !== 'string' || !company.timezone) {
    throw new Error('TASK_COMPANY_TIMEZONE_QUERY_FAILED');
  }
  if (taskResult.error || !Array.isArray(taskResult.data)) throw new Error('TASK_METRICS_QUERY_FAILED');

  const rows = taskResult.data as TaskMetricRow[];
  const evaluatedAt = input.now ?? new Date();
  const snapshot = buildTaskSnapshot(rows, company.timezone, evaluatedAt);
  if (process.env.NODE_ENV !== 'production') {
    console.info('[Task Metrics]', {
      companyId, activeCount: snapshot.metrics.active, overdueCount: snapshot.metrics.overdue,
      completedCount: snapshot.metrics.completed, source: snapshot.source,
      deadlineRuleVersion: snapshot.deadlineRuleVersion,
    });
  }
  return snapshot;
}
