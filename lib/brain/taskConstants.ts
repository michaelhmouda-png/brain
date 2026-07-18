/**
 * Task Constants — Canonical Values
 *
 * Centralized source of truth for task priority and status enum values.
 * All handlers MUST use these constants to ensure database CHECK constraints are satisfied.
 *
 * Database schema (tasks_schema.sql) enforces:
 * - priority CHECK: IN ('critical', 'high', 'medium', 'low')
 * - status CHECK: IN ('pending', 'in_progress', 'completed', 'cancelled')
 *
 * Values MUST be lowercase. UI display uses separate displayPriority() / displayStatus().
 */

/**
 * Canonical priority values (lowercase, for database storage)
 */
export const TASK_PRIORITY = {
  CRITICAL: 'critical' as const,
  HIGH: 'high' as const,
  MEDIUM: 'medium' as const,
  LOW: 'low' as const,
} as const;

export type TaskPriority = typeof TASK_PRIORITY[keyof typeof TASK_PRIORITY];

export const TASK_PRIORITY_ARRAY = Object.values(TASK_PRIORITY);

/**
 * Canonical status values (lowercase, for database storage)
 */
export const TASK_STATUS = {
  PENDING: 'pending' as const,
  IN_PROGRESS: 'in_progress' as const,
  COMPLETED: 'completed' as const,
  CANCELLED: 'cancelled' as const,
} as const;

export type TaskStatus = typeof TASK_STATUS[keyof typeof TASK_STATUS];

export const TASK_STATUS_ARRAY = Object.values(TASK_STATUS);

/**
 * Display names (capitalized, for UI presentation)
 */
export const TASK_PRIORITY_DISPLAY = {
  [TASK_PRIORITY.CRITICAL]: 'Critical',
  [TASK_PRIORITY.HIGH]: 'High',
  [TASK_PRIORITY.MEDIUM]: 'Medium',
  [TASK_PRIORITY.LOW]: 'Low',
} as const;

export const TASK_STATUS_DISPLAY = {
  [TASK_STATUS.PENDING]: 'Pending',
  [TASK_STATUS.IN_PROGRESS]: 'In Progress',
  [TASK_STATUS.COMPLETED]: 'Completed',
  [TASK_STATUS.CANCELLED]: 'Cancelled',
} as const;

/**
 * Validate that a priority value is canonical (lowercase database value)
 */
export function isValidTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && TASK_PRIORITY_ARRAY.includes(value as TaskPriority);
}

/**
 * Validate that a status value is canonical (lowercase database value)
 */
export function isValidTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && TASK_STATUS_ARRAY.includes(value as TaskStatus);
}

/**
 * Convert any case to canonical priority (lowercase)
 * Input: "High" or "high" or "HIGH"
 * Output: "high"
 */
export function canonicalPriority(input: string | undefined): TaskPriority | undefined {
  if (!input || typeof input !== 'string') return undefined;

  const lower = input.toLowerCase().trim();

  if (lower === 'critical') return TASK_PRIORITY.CRITICAL;
  if (lower === 'high') return TASK_PRIORITY.HIGH;
  if (lower === 'medium') return TASK_PRIORITY.MEDIUM;
  if (lower === 'low') return TASK_PRIORITY.LOW;

  return undefined;
}

/**
 * Convert any case to canonical status (lowercase)
 * Input: "In Progress" or "in_progress" or "IN PROGRESS"
 * Output: "in_progress"
 */
export function canonicalStatus(input: string | undefined): TaskStatus | undefined {
  if (!input || typeof input !== 'string') return undefined;

  const normalized = input.toLowerCase().trim().replace(/\s+/g, '_');

  if (normalized === 'pending') return TASK_STATUS.PENDING;
  if (normalized === 'in_progress') return TASK_STATUS.IN_PROGRESS;
  if (normalized === 'completed') return TASK_STATUS.COMPLETED;
  if (normalized === 'cancelled') return TASK_STATUS.CANCELLED;

  return undefined;
}

/**
 * Display a canonical priority value (lowercase → capitalized)
 */
export function displayTaskPriority(value: TaskPriority): string {
  return TASK_PRIORITY_DISPLAY[value] || 'Medium';
}

/**
 * Display a canonical status value (lowercase → capitalized)
 */
export function displayTaskStatus(value: TaskStatus): string {
  return TASK_STATUS_DISPLAY[value] || 'Pending';
}
