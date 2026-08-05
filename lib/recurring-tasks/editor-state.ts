import { parseRecurringTaskRule, type RecurringTaskRuleInput } from './contracts.ts';

export type PersistedRecurringRuleVersion = {
  version: number;
  recurrence: unknown;
  time_anchor: unknown;
  task_template: unknown;
  workforce: unknown;
  assignment_mode: unknown;
  reminder_offsets_minutes: unknown;
  start_date: unknown;
  end_date: unknown;
};

export type PersistedRecurringRule = {
  id: string;
  name: unknown;
  description: unknown;
  timezone: unknown;
  location_id: unknown;
  current_version: number;
  recurring_task_rule_versions: PersistedRecurringRuleVersion[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RECURRING_EDIT_HYDRATION_INVALID');
  return value as Record<string, unknown>;
}

export function persistedLocalTime(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(value)) {
    throw new Error('RECURRING_EDIT_HYDRATION_INVALID');
  }
  return value.slice(0, 5);
}

/** Hydrates only the persisted current version without converting its venue-local wall-clock value or using creation fallbacks. */
export function hydrateRecurringRuleEditor(rule: PersistedRecurringRule): RecurringTaskRuleInput {
  if (!Number.isInteger(rule.current_version) || rule.current_version < 1 || !Array.isArray(rule.recurring_task_rule_versions)) {
    throw new Error('RECURRING_EDIT_HYDRATION_INVALID');
  }
  const version = rule.recurring_task_rule_versions.find((candidate) => candidate.version === rule.current_version);
  if (!version) throw new Error('RECURRING_EDIT_HYDRATION_INVALID');
  const anchor = record(version.time_anchor);
  const kind = anchor.kind;
  const localTime = kind === 'fixed_time' ? persistedLocalTime(anchor.localTime) : null;
  try {
    return parseRecurringTaskRule({
      name: rule.name,
      description: rule.description,
      locationId: rule.location_id,
      timezone: rule.timezone,
      recurrence: version.recurrence,
      timeAnchor: { kind, localTime, offsetMinutes: anchor.offsetMinutes },
      startDate: version.start_date,
      endDate: version.end_date,
      taskTemplate: version.task_template,
      workforce: version.workforce,
      assignmentMode: version.assignment_mode,
      reminderOffsetsMinutes: version.reminder_offsets_minutes,
    });
  } catch {
    throw new Error('RECURRING_EDIT_HYDRATION_INVALID');
  }
}
