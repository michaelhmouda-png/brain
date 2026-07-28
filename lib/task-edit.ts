import {
  isValidTaskPriority,
  isValidTaskStatus,
  type TaskPriority,
  type TaskStatus,
} from './brain/taskConstants.ts';
import { localDateTimeToInstant } from './brain/tasks/batch/task-batch-time.ts';
import {
  isTaskEvidenceCountUnit,
  type TaskEvidenceCountRequirement,
} from './task-evidence-submission.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

export const TASK_EDIT_ROLES = ['manager', 'owner', 'super_admin'] as const;
export type TaskEditRole = (typeof TASK_EDIT_ROLES)[number];

export type TaskEditPatch = {
  title?: string;
  description?: string | null;
  assignedEmployeeId?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueDate?: string | null;
  dueTime?: string | null;
  locationId?: string | null;
  countRequirement?: Omit<TaskEvidenceCountRequirement, 'version'> | null;
};

export type TaskEditRequest = {
  taskId: string;
  expectedUpdatedAt: string;
  patch: TaskEditPatch;
};

export type CanonicalTaskPatch = {
  title?: string;
  description?: string | null;
  assigned_employee_id?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  due_date?: string | null;
  due_at?: string | null;
  location_id?: string | null;
};

export type TaskEditOption = {
  id: string;
  name: string;
};

export type TaskEditOptions = {
  employees: TaskEditOption[];
  locations: TaskEditOption[];
};

export class TaskEditInputError extends Error {
  readonly code = 'TASK_EDIT_INPUT_INVALID';
  readonly field: keyof TaskEditPatch | 'taskId' | 'expectedUpdatedAt' | 'patch';

  constructor(field: TaskEditInputError['field']) {
    super('TASK_EDIT_INPUT_INVALID');
    this.name = 'TaskEditInputError';
    this.field = field;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTaskEditRole(value: string): value is TaskEditRole {
  return TASK_EDIT_ROLES.some((role) => role === value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

function parseNullableUuid(value: unknown, field: keyof TaskEditPatch): string | null {
  if (value === null) return null;
  if (!isUuid(value)) throw new TaskEditInputError(field);
  return value;
}

function parseNullableText(
  value: unknown,
  field: keyof TaskEditPatch,
  maximum: number,
): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TaskEditInputError(field);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum) throw new TaskEditInputError(field);
  return trimmed;
}

export function parseTaskEditRequest(value: unknown): TaskEditRequest {
  if (!isRecord(value)) throw new TaskEditInputError('patch');
  const allowedRequestKeys = new Set(['taskId', 'expectedUpdatedAt', 'patch']);
  if (Object.keys(value).some((key) => !allowedRequestKeys.has(key))) {
    throw new TaskEditInputError('patch');
  }
  if (!isUuid(value.taskId)) throw new TaskEditInputError('taskId');
  if (
    typeof value.expectedUpdatedAt !== 'string'
    || !RFC3339_PATTERN.test(value.expectedUpdatedAt)
    || !Number.isFinite(Date.parse(value.expectedUpdatedAt))
  ) {
    throw new TaskEditInputError('expectedUpdatedAt');
  }
  if (!isRecord(value.patch)) throw new TaskEditInputError('patch');

  const allowedPatchKeys = new Set([
    'title',
    'description',
    'assignedEmployeeId',
    'priority',
    'status',
    'dueDate',
    'dueTime',
    'locationId',
    'countRequirement',
  ]);
  const keys = Object.keys(value.patch);
  if (keys.length === 0 || keys.some((key) => !allowedPatchKeys.has(key))) {
    throw new TaskEditInputError('patch');
  }

  const patch: TaskEditPatch = {};
  if (Object.hasOwn(value.patch, 'title')) {
    if (typeof value.patch.title !== 'string') throw new TaskEditInputError('title');
    const title = value.patch.title.trim();
    if (!title || title.length > 300) throw new TaskEditInputError('title');
    patch.title = title;
  }
  if (Object.hasOwn(value.patch, 'description')) {
    patch.description = parseNullableText(value.patch.description, 'description', 5000);
  }
  if (Object.hasOwn(value.patch, 'assignedEmployeeId')) {
    patch.assignedEmployeeId = parseNullableUuid(
      value.patch.assignedEmployeeId,
      'assignedEmployeeId',
    );
  }
  if (Object.hasOwn(value.patch, 'priority')) {
    if (!isValidTaskPriority(value.patch.priority)) throw new TaskEditInputError('priority');
    patch.priority = value.patch.priority;
  }
  if (Object.hasOwn(value.patch, 'status')) {
    if (!isValidTaskStatus(value.patch.status)) throw new TaskEditInputError('status');
    patch.status = value.patch.status;
  }
  if (Object.hasOwn(value.patch, 'dueDate')) {
    if (value.patch.dueDate !== null && !isCalendarDate(value.patch.dueDate)) {
      throw new TaskEditInputError('dueDate');
    }
    patch.dueDate = value.patch.dueDate;
  }
  if (Object.hasOwn(value.patch, 'dueTime')) {
    if (value.patch.dueTime !== null && !isClockTime(value.patch.dueTime)) {
      throw new TaskEditInputError('dueTime');
    }
    patch.dueTime = value.patch.dueTime;
  }
  if (patch.dueDate === null && typeof patch.dueTime === 'string') {
    throw new TaskEditInputError('dueTime');
  }
  if (Object.hasOwn(value.patch, 'locationId')) {
    patch.locationId = parseNullableUuid(value.patch.locationId, 'locationId');
  }
  if (Object.hasOwn(value.patch, 'countRequirement')) {
    if (value.patch.countRequirement === null) {
      patch.countRequirement = null;
    } else {
      const requirement = isRecord(value.patch.countRequirement)
        ? value.patch.countRequirement
        : null;
      const allowed = new Set([
        'countRequired',
        'countLabel',
        'unit',
        'damagedQuantityRequested',
        'allowDecimals',
        'instructions',
      ]);
      if (
        !requirement
        || Object.keys(requirement).some((key) => !allowed.has(key))
        || requirement.countRequired !== true
        || typeof requirement.countLabel !== 'string'
        || !requirement.countLabel.trim()
        || requirement.countLabel.trim().length > 120
        || !isTaskEvidenceCountUnit(requirement.unit)
        || typeof requirement.damagedQuantityRequested !== 'boolean'
        || typeof requirement.allowDecimals !== 'boolean'
        || !(
          requirement.instructions === null
          || (
            typeof requirement.instructions === 'string'
            && requirement.instructions.trim().length <= 1000
          )
        )
      ) {
        throw new TaskEditInputError('countRequirement');
      }
      patch.countRequirement = {
        countRequired: true,
        countLabel: requirement.countLabel.trim(),
        unit: requirement.unit,
        damagedQuantityRequested: requirement.damagedQuantityRequested,
        allowDecimals: requirement.allowDecimals,
        instructions: typeof requirement.instructions === 'string'
          ? requirement.instructions.trim() || null
          : null,
      };
    }
  }

  return {
    taskId: value.taskId,
    expectedUpdatedAt: value.expectedUpdatedAt,
    patch,
  };
}

function dateTimeParts(instant: string, timeZone: string): { date: string; time: string } {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new TaskEditInputError('dueTime');
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
  } catch {
    throw new TaskEditInputError('dueTime');
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  const localDate = `${part('year')}-${part('month')}-${part('day')}`;
  const localTime = `${part('hour')}:${part('minute')}`;
  if (!isCalendarDate(localDate) || !isClockTime(localTime)) {
    throw new TaskEditInputError('dueTime');
  }
  return { date: localDate, time: localTime };
}

export function taskDeadlineFormValues(
  dueDate: string | null,
  dueAt: string | null,
  timeZone: string,
): { dueDate: string; dueTime: string } {
  if (!dueAt) return { dueDate: dueDate ?? '', dueTime: '' };
  const local = dateTimeParts(dueAt, timeZone);
  return { dueDate: local.date, dueTime: local.time };
}

export function resolveTaskDeadlinePatch(
  patch: TaskEditPatch,
  current: { dueDate: string | null; dueAt: string | null },
  timeZone: string,
): Pick<CanonicalTaskPatch, 'due_date' | 'due_at'> {
  const hasDate = Object.hasOwn(patch, 'dueDate');
  const hasTime = Object.hasOwn(patch, 'dueTime');
  if (!hasDate && !hasTime) return {};

  if (hasDate && patch.dueDate === null) {
    if (typeof patch.dueTime === 'string') throw new TaskEditInputError('dueTime');
    return { due_date: null, due_at: null };
  }

  const existingLocal = current.dueAt
    ? dateTimeParts(current.dueAt, timeZone)
    : { date: current.dueDate ?? '', time: '' };
  const dueDate = hasDate ? patch.dueDate : existingLocal.date || null;
  const dueTime = hasTime ? patch.dueTime : existingLocal.time || null;

  if (!dueDate) {
    if (dueTime) throw new TaskEditInputError('dueDate');
    return { due_date: null, due_at: null };
  }
  if (!isCalendarDate(dueDate)) throw new TaskEditInputError('dueDate');
  if (!dueTime) return { due_date: dueDate, due_at: null };

  try {
    const due = localDateTimeToInstant(`${dueDate}T${dueTime}`, timeZone);
    return { due_date: due.dueDate, due_at: due.dueAt };
  } catch {
    throw new TaskEditInputError('dueTime');
  }
}

export function canonicalizeTaskEditPatch(
  patch: TaskEditPatch,
  current: { dueDate: string | null; dueAt: string | null },
  timeZone: string,
): CanonicalTaskPatch {
  const canonical: CanonicalTaskPatch = {};
  if (Object.hasOwn(patch, 'title')) canonical.title = patch.title;
  if (Object.hasOwn(patch, 'description')) canonical.description = patch.description;
  if (Object.hasOwn(patch, 'assignedEmployeeId')) {
    canonical.assigned_employee_id = patch.assignedEmployeeId;
  }
  if (Object.hasOwn(patch, 'priority')) canonical.priority = patch.priority;
  if (Object.hasOwn(patch, 'status')) canonical.status = patch.status;
  if (Object.hasOwn(patch, 'locationId')) canonical.location_id = patch.locationId;
  return {
    ...canonical,
    ...resolveTaskDeadlinePatch(patch, current, timeZone),
  };
}
