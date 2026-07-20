import type { CommandHandler } from '../../kernel/commands/command-handler.ts';
import { COMMAND_SCHEMA_VERSION } from '../../kernel/commands/command-envelope.ts';
import type { DomainEventRecorder } from '../../kernel/events/domain-event-recorder.ts';
import type { CreateTaskCommand, CreateTaskCommandPayload } from './create-task-command.ts';
import { createTaskCreatedEvent } from '../events/task-created-event.ts';
import { logApprovedExecutionFailure } from '../../execution-diagnostics.server.ts';

export type CreateTaskCommandErrorCode =
  | 'UNSUPPORTED_COMMAND_TYPE'
  | 'UNSUPPORTED_COMMAND_VERSION'
  | 'COMMAND_CONTEXT_MISMATCH'
  | 'TASK_CREATION_FAILED'
  | 'EVENT_RECORDING_FAILED';

export class CreateTaskCommandError extends Error {
  readonly code: CreateTaskCommandErrorCode;

  constructor(code: CreateTaskCommandErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = 'CreateTaskCommandError';
    this.code = code;
  }
}

export interface CreateTaskRecordInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly proposalId: string;
  readonly correlationId: string;
  readonly payload: Readonly<CreateTaskCommandPayload>;
}

export interface CreateTaskRecordResult {
  readonly taskId: string;
  readonly title: string;
  readonly status: CreateTaskCommandPayload['status'];
  readonly priority: CreateTaskCommandPayload['priority'];
  readonly assignedEmployeeId: string | null;
  readonly assignedEmployeeName: string | null;
  readonly dueDate: string | null;
}

export interface CreateTaskCommandDependencies {
  createTaskRecord(input: CreateTaskRecordInput): Promise<CreateTaskRecordResult>;
}

export interface CreateTaskCommandResult {
  readonly taskId: string;
  readonly title: string;
  readonly status: CreateTaskCommandPayload['status'];
  readonly priority: CreateTaskCommandPayload['priority'];
  readonly assignedEmployeeId: string | null;
  readonly assignedEmployeeName: string | null;
  readonly dueDate: string | null;
}

function validateCommand(command: CreateTaskCommand): void {
  if (command.commandType !== 'task.create') {
    throw new CreateTaskCommandError('UNSUPPORTED_COMMAND_TYPE');
  }
  if (command.schemaVersion !== COMMAND_SCHEMA_VERSION) {
    throw new CreateTaskCommandError('UNSUPPORTED_COMMAND_VERSION');
  }
  if (
    command.actor.actorId !== command.actor.authUserId ||
    command.actor.companyId !== command.tenant.tenantId ||
    command.tenant.tenantId !== command.tenant.companyId
  ) {
    throw new CreateTaskCommandError('COMMAND_CONTEXT_MISMATCH');
  }
}

export function createTaskCommandHandler(
  dependencies: CreateTaskCommandDependencies,
  eventRecorder: DomainEventRecorder,
): CommandHandler<CreateTaskCommand, CreateTaskCommandResult> {
  return {
    async execute(command) {
      validateCommand(command);
      try {
        let result: CreateTaskRecordResult;
        try {
          result = await dependencies.createTaskRecord({
            tenantId: command.tenant.tenantId,
            actorId: command.actor.actorId,
            proposalId: command.causationId ?? 'missing',
            correlationId: command.correlationId,
            payload: command.payload,
          });
        } catch (error) {
          logApprovedExecutionFailure({
            proposalId: command.causationId ?? 'missing',
            correlationId: command.correlationId,
            action: 'create_task',
            stage: 'task_repository.create',
          }, error);
          throw error;
        }
        const safeResult = Object.freeze({
          taskId: result.taskId,
          title: result.title,
          status: result.status,
          priority: result.priority,
          assignedEmployeeId: result.assignedEmployeeId,
          assignedEmployeeName: result.assignedEmployeeName,
          dueDate: result.dueDate,
        });
        const event = createTaskCreatedEvent({ command, result: safeResult });
        try {
          await eventRecorder.record(event);
        } catch (error) {
          logApprovedExecutionFailure({
            proposalId: command.causationId ?? 'missing',
            correlationId: command.correlationId,
            action: 'create_task',
            stage: 'domain_event_recorder.record',
          }, error);
          throw new CreateTaskCommandError('EVENT_RECORDING_FAILED', { cause: error });
        }
        return safeResult;
      } catch (error) {
        if (error instanceof CreateTaskCommandError) throw error;
        throw new CreateTaskCommandError('TASK_CREATION_FAILED', { cause: error });
      }
    },
  };
}
