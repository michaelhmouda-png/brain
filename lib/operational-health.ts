export type OperationalSeverity = 'critical' | 'high' | 'medium';
export type OperationalAlert = { code: string; severity: OperationalSeverity };
export type OperationalHealth = { status: 'ok' | 'degraded'; alerts: OperationalAlert[]; observedAt: string };

const WORKER_MAX_AGE_MINUTES: Record<string, number> = { notifications: 5, recurring_tasks: 15, weekly_shifts: 90, evidence: 5 };
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

export function classifyOperationalHealth(payload: Record<string, unknown>, now = Date.now()): OperationalHealth {
  const alerts: OperationalAlert[] = [];
  const workers = Array.isArray(payload.workers) ? payload.workers : [];
  for (const raw of workers) {
    if (!raw || typeof raw !== 'object') continue;
    const worker = raw as Record<string, unknown>;
    const name = typeof worker.name === 'string' ? worker.name : '';
    const maximumAge = WORKER_MAX_AGE_MINUTES[name];
    if (!maximumAge) continue;
    const succeededAt = timestamp(worker.lastSucceededAt);
    if (succeededAt === null || now - succeededAt > maximumAge * 60_000) alerts.push({ code: `WORKER_${name.toUpperCase()}_STALE`, severity: 'critical' });
    const failedAt = timestamp(worker.lastFailedAt);
    if (failedAt !== null && (succeededAt === null || failedAt > succeededAt)) alerts.push({ code: `WORKER_${name.toUpperCase()}_FAILED`, severity: 'critical' });
  }
  const queues = payload.queues && typeof payload.queues === 'object' && !Array.isArray(payload.queues) ? payload.queues as Record<string, unknown> : {};
  for (const [name, raw] of Object.entries(queues)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const queue = raw as Record<string, unknown>;
    if (count(queue.deadLetter) > 0) alerts.push({ code: `QUEUE_${name.toUpperCase()}_DEAD_LETTER`, severity: 'high' });
    const oldest = timestamp(queue.oldestPendingAt);
    if (oldest !== null && now - oldest > 15 * 60_000) alerts.push({ code: `QUEUE_${name.toUpperCase()}_STALE`, severity: 'high' });
  }
  const hasAgents = payload.agents && typeof payload.agents === 'object' && !Array.isArray(payload.agents);
  const agents = hasAgents ? payload.agents as Record<string, unknown> : {};
  if (!hasAgents) alerts.push({ code: 'OPERATIONAL_AGENT_SIGNAL_UNAVAILABLE', severity: 'critical' });
  if (count(agents.offline) > 0) alerts.push({ code: 'BRAIN_AGENTS_OFFLINE', severity: 'high' });
  const hasRecurring = payload.recurring && typeof payload.recurring === 'object' && !Array.isArray(payload.recurring);
  const recurring = hasRecurring ? payload.recurring as Record<string, unknown> : {};
  if (!hasRecurring) alerts.push({ code: 'OPERATIONAL_RECURRING_SIGNAL_UNAVAILABLE', severity: 'critical' });
  if (count(recurring.failedLast24Hours) > 0) alerts.push({ code: 'RECURRING_TASK_FAILURES', severity: 'high' });
  const unique = [...new Map(alerts.map((alert) => [alert.code, alert])).values()];
  return { status: unique.length ? 'degraded' : 'ok', alerts: unique, observedAt: typeof payload.observedAt === 'string' ? payload.observedAt : new Date(now).toISOString() };
}
