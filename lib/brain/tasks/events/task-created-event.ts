import type { TaskPriority, TaskStatus } from '../../taskConstants.ts';
import type { CreateTaskCommand } from '../commands/create-task-command.ts';
import type { CreateTaskCommandResult } from '../commands/create-task-command-handler.ts';
import type { DomainEventDefinition, DomainEventEnvelope } from '../../kernel/events/domain-event-envelope.ts';
import { createDomainEventEnvelope } from '../../kernel/events/domain-event-envelope.ts';
import { DomainEventError } from '../../kernel/events/domain-event-errors.ts';

export interface TaskCreatedEventPayload {
  readonly taskId: string;
  readonly title: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly assignedEmployeeId: string | null;
  readonly dueDate: string | null;
}

export type TaskCreatedEvent = DomainEventEnvelope<'task.created', TaskCreatedEventPayload>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function canonicalizeTaskCreatedPayload(input: unknown): TaskCreatedEventPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainEventError('INVALID_EVENT_PAYLOAD');
  }
  const value = input as Record<string, unknown>;
  if (typeof value.taskId !== 'string' || !UUID_PATTERN.test(value.taskId)) {
    throw new DomainEventError('INVALID_EVENT_PAYLOAD');
  }
  if (typeof value.title !== 'string' || !value.title.trim()) {
    throw new DomainEventError('INVALID_EVENT_PAYLOAD');
  }
  if (!['low', 'medium', 'high', 'critical'].includes(String(value.priority))) {
    throw new DomainEventError('INVALID_EVENT_PAYLOAD');
  }
  if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(String(value.status))) {
    throw new DomainEventError('INVALID_EVENT_PAYLOAD');
  }
  if (value.assignedEmployeeId !== null &&
      (typeof value.assignedEmployeeId !== 'string' || !UUID_PATTERN.test(value.assignedEmployeeId))) {
    throw new DomainEventError('INVALID_EVENT_PAYLOAD');
  }
  if (value.dueDate !== null &&
      (typeof value.dueDate !== 'string' || !DATE_PATTERN.test(value.dueDate))) {
    throw new DomainEventError('INVALID_EVENT_PAYLOAD');
  }
  return {
    taskId: value.taskId,
    title: value.title.trim(),
    priority: value.priority as TaskPriority,
    status: value.status as TaskStatus,
    assignedEmployeeId: value.assignedEmployeeId as string | null,
    dueDate: value.dueDate as string | null,
  };
}

export const TASK_CREATED_EVENT: DomainEventDefinition<'task.created', TaskCreatedEventPayload> = {
  eventType: 'task.created',
  aggregateType: 'task',
  canonicalize: canonicalizeTaskCreatedPayload,
  aggregateId: payload => payload.taskId,
};

export function createTaskCreatedEvent(input: {
  readonly command: Readonly<CreateTaskCommand>;
  readonly result: Readonly<CreateTaskCommandResult>;
  readonly schemaVersion?: number;
  readonly occurredAt?: Date;
}): Readonly<TaskCreatedEvent> {
  return createDomainEventEnvelope({
    definition: TASK_CREATED_EVENT,
    command: input.command,
    schemaVersion: input.schemaVersion,
    occurredAt: input.occurredAt,
    payload: {
      taskId: input.result.taskId,
      title: input.result.title,
      priority: input.result.priority,
      status: input.result.status,
      assignedEmployeeId: input.result.assignedEmployeeId,
      dueDate: input.result.dueDate,
    },
  });
}
