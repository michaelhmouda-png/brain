import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export const WORKER_NAMES = ['notifications', 'recurring_tasks', 'weekly_shifts', 'evidence'] as const;
export type WorkerName = typeof WORKER_NAMES[number];

export function safeWorkerFailureCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message.split(':')[0] : '';
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(candidate) ? candidate : 'WORKER_FAILED';
}

export async function recordWorkerRun(
  service: SupabaseClient,
  worker: WorkerName,
  startedAt: string,
  outcome: 'success' | 'failure',
  failureCode: string | null = null,
) {
  const { error } = await service.rpc('record_system_worker_run_v1', {
    p_worker_name: worker,
    p_started_at: startedAt,
    p_outcome: outcome,
    p_failure_code: failureCode?.slice(0, 80) ?? null,
  });
  if (error) console.warn('[Worker telemetry] unavailable', { worker, code: error.code ?? 'TELEMETRY_UNAVAILABLE' });
}

export async function runInstrumented<T>(
  service: SupabaseClient,
  worker: WorkerName,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date().toISOString();
  try {
    const result = await operation();
    await recordWorkerRun(service, worker, startedAt, 'success');
    return result;
  } catch (error) {
    const code = safeWorkerFailureCode(error);
    await recordWorkerRun(service, worker, startedAt, 'failure', code);
    throw error;
  }
}
