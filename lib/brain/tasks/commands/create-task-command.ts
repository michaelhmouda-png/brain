import {
  canonicalPriority,
  canonicalStatus,
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
} from '../../taskConstants.ts';
import { mapPriorityToDatabase } from '../../priorityMapper.ts';
import type { CommandDefinition, CommandEnvelope } from '../../kernel/commands/command-envelope.ts';
import { createCommandEnvelope } from '../../kernel/commands/command-envelope.ts';
import { CommandError } from '../../kernel/commands/command-errors.ts';
import type { BrainRequestContext } from '../../kernel/request-context.ts';

export interface CreateTaskCommandPayload {
  readonly title: string;
  readonly description: string | null;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly assignedEmployeeId: string | null;
  readonly assignedEmployeeName: string | null;
  readonly urgency: string | null;
  readonly dueDate: string | null;
}

export type CreateTaskCommand = CommandEnvelope<'task.create', CreateTaskCommandPayload>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RELATIVE_DATE_PATTERN = /^(today|tomorrow)$/i;
const FORBIDDEN_FIELDS = ['companyId','company_id','tenantId','tenant_id','actorId','actor_id','profileId','profile_id','role','confirmed','authorization','isAuthorized'];

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new CommandError('INVALID_COMMAND_PAYLOAD');
  return value.trim() || null;
}

export function canonicalizeCreateTaskPayload(input: unknown): CreateTaskCommandPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommandError('INVALID_COMMAND_PAYLOAD');
  const raw = input as Record<string, unknown>;
  if (FORBIDDEN_FIELDS.some(field => Object.hasOwn(raw, field))) throw new CommandError('INVALID_COMMAND_PAYLOAD');

  const title = optionalString(raw.title);
  if (!title) throw new CommandError('INVALID_COMMAND_PAYLOAD');
  const description = optionalString(raw.description);
  const assignedEmployeeName = optionalString(raw.assigned_employee_name ?? raw.assignedEmployeeName);
  const assignedEmployeeId = optionalString(raw.assigned_employee_id ?? raw.assignedEmployeeId);
  if (assignedEmployeeId && !UUID_PATTERN.test(assignedEmployeeId)) throw new CommandError('INVALID_COMMAND_PAYLOAD');
  const urgency = optionalString(raw.urgency);
  const dueDateInput = optionalString(raw.due_date ?? raw.dueDate);
  if (dueDateInput && !DATE_PATTERN.test(dueDateInput) && !RELATIVE_DATE_PATTERN.test(dueDateInput)) {
    throw new CommandError('INVALID_COMMAND_PAYLOAD');
  }
  const priorityInput = optionalString(raw.priority);
  const statusInput = optionalString(raw.status);
  const priority = priorityInput === null
    ? (urgency ? mapPriorityToDatabase(urgency).dbValue : TASK_PRIORITY.MEDIUM)
    : canonicalPriority(priorityInput);
  const status = statusInput === null ? TASK_STATUS.PENDING : canonicalStatus(statusInput);
  if (!priority || !status) throw new CommandError('INVALID_COMMAND_PAYLOAD');

  return {
    title,
    description,
    priority,
    status,
    assignedEmployeeId,
    assignedEmployeeName,
    urgency,
    dueDate: dueDateInput && RELATIVE_DATE_PATTERN.test(dueDateInput) ? dueDateInput.toLowerCase() : dueDateInput,
  };
}

export const CREATE_TASK_COMMAND: CommandDefinition<'task.create', CreateTaskCommandPayload> = {
  commandType: 'task.create',
  canonicalize: canonicalizeCreateTaskPayload,
};

export function createTaskCommand(input: {
  readonly payload: unknown;
  readonly context: BrainRequestContext;
  readonly proposalId: string;
  readonly schemaVersion?: number;
  readonly now?: Date;
}): Readonly<CreateTaskCommand> {
  return createCommandEnvelope({
    definition: CREATE_TASK_COMMAND,
    payload: input.payload,
    context: input.context,
    causationId: input.proposalId,
    schemaVersion: input.schemaVersion,
    now: input.now,
  });
}
