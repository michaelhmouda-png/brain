export const RECURRING_RULE_STATUSES = ['active', 'paused', 'ended'] as const;
export const RECURRENCE_KINDS = ['daily', 'selected_weekdays', 'except_weekdays', 'weekly'] as const;
export const TIME_ANCHORS = ['fixed_time', 'location_opening', 'location_closing'] as const;
export const ASSIGNMENT_MODES = [
  'every_matching_employee_on_shift',
  'one_matching_employee_on_shift',
  'specific_employee_if_on_shift',
] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export type RecurringRuleStatus = (typeof RECURRING_RULE_STATUSES)[number];
export type RecurrenceKind = (typeof RECURRENCE_KINDS)[number];
export type TimeAnchor = (typeof TIME_ANCHORS)[number];
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

export interface RecurringTaskRuleInput {
  name: string;
  description: string | null;
  locationId: string | null;
  timezone: string;
  recurrence: { kind: RecurrenceKind; weekdays: number[] };
  timeAnchor: { kind: TimeAnchor; localTime: string | null; offsetMinutes: number };
  startDate: string;
  endDate: string | null;
  taskTemplate: {
    title: string;
    description: string | null;
    priority: (typeof TASK_PRIORITIES)[number];
    evidenceRequired: boolean;
    countRequirement: {
      countRequired: true;
      countLabel: string;
      unit: string;
      damagedQuantityRequested: boolean;
      allowDecimals: boolean;
      instructions: string | null;
    } | null;
  };
  workforce: {
    departmentId: string | null;
    employeeRole: string | null;
    shiftOverlapRequired: true;
    specificEmployeeId: string | null;
  };
  assignmentMode: AssignmentMode;
  reminderOffsetsMinutes: number[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const UNIT = /^[a-z][a-z0-9_-]{0,31}$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RECURRING_RULE_INVALID');
  return value as Record<string, unknown>;
}

function exact(value: unknown, keys: readonly string[]) {
  const result = record(value);
  if (Object.keys(result).some((key) => !keys.includes(key))) throw new Error('RECURRING_RULE_INVALID');
  return result;
}

function text(value: unknown, max: number, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error('RECURRING_RULE_INVALID');
    return null;
  }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error('RECURRING_RULE_INVALID');
  return value.trim();
}

function uuid(value: unknown, required = false) {
  const result = text(value, 36, required);
  if (result !== null && !UUID.test(result)) throw new Error('RECURRING_RULE_INVALID');
  return result;
}

function member<T extends readonly string[]>(values: T, value: unknown): T[number] {
  if (typeof value !== 'string' || !values.includes(value as T[number])) throw new Error('RECURRING_RULE_INVALID');
  return value as T[number];
}

export function canManageRecurringTasks(role: string) {
  return role === 'manager' || role === 'owner' || role === 'super_admin';
}

export function parseRecurringTaskRule(value: unknown): RecurringTaskRuleInput {
  const row = exact(value, [
    'name', 'description', 'locationId', 'timezone', 'recurrence', 'timeAnchor',
    'startDate', 'endDate', 'taskTemplate', 'workforce', 'assignmentMode',
    'reminderOffsetsMinutes',
  ]);
  const recurrence = exact(row.recurrence, ['kind', 'weekdays']);
  const kind = member(RECURRENCE_KINDS, recurrence.kind);
  if (!Array.isArray(recurrence.weekdays)
      || recurrence.weekdays.some((day) => !Number.isInteger(day) || !WEEKDAYS.includes(day as never))) {
    throw new Error('RECURRING_RULE_INVALID');
  }
  const weekdays = [...new Set(recurrence.weekdays as number[])].sort();
  if ((kind === 'selected_weekdays' || kind === 'except_weekdays' || kind === 'weekly') && weekdays.length === 0
      || kind === 'weekly' && weekdays.length !== 1
      || kind === 'daily' && weekdays.length !== 0) throw new Error('RECURRING_RULE_INVALID');

  const anchor = exact(row.timeAnchor, ['kind', 'localTime', 'offsetMinutes']);
  const anchorKind = member(TIME_ANCHORS, anchor.kind);
  const localTime = text(anchor.localTime, 5);
  if (anchorKind === 'fixed_time' ? !localTime || !TIME.test(localTime) : localTime !== null) {
    throw new Error('RECURRING_RULE_INVALID');
  }
  if (!Number.isInteger(anchor.offsetMinutes) || Number(anchor.offsetMinutes) < -720 || Number(anchor.offsetMinutes) > 720) {
    throw new Error('RECURRING_RULE_INVALID');
  }

  const template = exact(row.taskTemplate, ['title', 'description', 'priority', 'evidenceRequired', 'countRequirement']);
  if (typeof template.evidenceRequired !== 'boolean') throw new Error('RECURRING_RULE_INVALID');
  let countRequirement: RecurringTaskRuleInput['taskTemplate']['countRequirement'] = null;
  if (template.countRequirement !== null && template.countRequirement !== undefined) {
    const count = exact(template.countRequirement, [
      'countRequired', 'countLabel', 'unit', 'damagedQuantityRequested', 'allowDecimals', 'instructions',
    ]);
    if (count.countRequired !== true || typeof count.damagedQuantityRequested !== 'boolean'
        || typeof count.allowDecimals !== 'boolean') throw new Error('RECURRING_RULE_INVALID');
    const unit = text(count.unit, 32, true)!;
    if (!UNIT.test(unit)) throw new Error('RECURRING_RULE_INVALID');
    countRequirement = {
      countRequired: true,
      countLabel: text(count.countLabel, 120, true)!,
      unit,
      damagedQuantityRequested: count.damagedQuantityRequested,
      allowDecimals: count.allowDecimals,
      instructions: text(count.instructions, 1000),
    };
  }

  const workforce = exact(row.workforce, [
    'departmentId', 'employeeRole', 'shiftOverlapRequired', 'specificEmployeeId',
  ]);
  if (workforce.shiftOverlapRequired !== true) throw new Error('RECURRING_RULE_INVALID');
  const assignmentMode = member(ASSIGNMENT_MODES, row.assignmentMode);
  const specificEmployeeId = uuid(workforce.specificEmployeeId);
  if ((assignmentMode === 'specific_employee_if_on_shift') !== Boolean(specificEmployeeId)) {
    throw new Error('RECURRING_RULE_INVALID');
  }
  if (!Array.isArray(row.reminderOffsetsMinutes) || row.reminderOffsetsMinutes.length > 8
      || row.reminderOffsetsMinutes.some((offset) => !Number.isInteger(offset) || offset < 0 || offset > 1440)) {
    throw new Error('RECURRING_RULE_INVALID');
  }
  const reminderOffsetsMinutes = [...new Set(row.reminderOffsetsMinutes as number[])].sort((a, b) => b - a);
  const timezone = text(row.timezone, 80, true)!;
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw new Error('RECURRING_TIMEZONE_INVALID'); }
  const startDate = text(row.startDate, 10, true)!;
  const endDate = text(row.endDate, 10);
  if (!DATE.test(startDate) || endDate !== null && (!DATE.test(endDate) || endDate < startDate)) {
    throw new Error('RECURRING_RULE_INVALID');
  }
  return {
    name: text(row.name, 160, true)!,
    description: text(row.description, 1000),
    locationId: uuid(row.locationId),
    timezone,
    recurrence: { kind, weekdays },
    timeAnchor: { kind: anchorKind, localTime, offsetMinutes: Number(anchor.offsetMinutes) },
    startDate,
    endDate,
    taskTemplate: {
      title: text(template.title, 200, true)!,
      description: text(template.description, 2000),
      priority: member(TASK_PRIORITIES, template.priority),
      evidenceRequired: template.evidenceRequired,
      countRequirement,
    },
    workforce: {
      departmentId: uuid(workforce.departmentId),
      employeeRole: text(workforce.employeeRole, 80),
      shiftOverlapRequired: true,
      specificEmployeeId,
    },
    assignmentMode,
    reminderOffsetsMinutes,
  };
}

export function recurrenceMatchesDay(kind: RecurrenceKind, weekdays: readonly number[], weekday: number) {
  if (!WEEKDAYS.includes(weekday as never)) return false;
  if (kind === 'daily') return true;
  if (kind === 'except_weekdays') return !weekdays.includes(weekday);
  return weekdays.includes(weekday);
}

export function deterministicRotationIndex(previousMaterializedOccurrences: number, eligibleCount: number) {
  if (!Number.isInteger(previousMaterializedOccurrences) || previousMaterializedOccurrences < 0
      || !Number.isInteger(eligibleCount) || eligibleCount < 1) throw new Error('RECURRING_ROTATION_INVALID');
  return previousMaterializedOccurrences % eligibleCount;
}

