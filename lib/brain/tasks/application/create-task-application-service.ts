import type { BrainRequestContext } from '../../kernel/request-context.ts';
import type { CommandHandler } from '../../kernel/commands/command-handler.ts';
import { createTaskCommand, type CreateTaskCommand } from '../commands/create-task-command.ts';
import type { CreateTaskCommandResult } from '../commands/create-task-command-handler.ts';

export interface CreateTaskApplicationInput {
  readonly context: BrainRequestContext;
  readonly payload: unknown;
  readonly proposalId: string;
}

export interface CreateTaskApplicationResult {
  readonly taskId: string;
  readonly title: string;
  readonly status: CreateTaskCommandResult['status'];
  readonly priority: CreateTaskCommandResult['priority'];
  readonly assignedEmployeeId: string | null;
  readonly assignedEmployeeName: string | null;
  readonly dueDate: string | null;
}

export interface CreateTaskApplicationService {
  execute(input: CreateTaskApplicationInput): Promise<CreateTaskApplicationResult>;
}

export interface CreateTaskApplicationDependencies {
  readonly handler: CommandHandler<CreateTaskCommand, CreateTaskCommandResult>;
}

export function createCreateTaskApplicationService(
  dependencies: CreateTaskApplicationDependencies,
): CreateTaskApplicationService {
  return {
    async execute(input) {
      const command = createTaskCommand({
        context: input.context,
        payload: input.payload,
        proposalId: input.proposalId,
      });
      const result = await dependencies.handler.execute(command);
      return Object.freeze({
        taskId: result.taskId,
        title: result.title,
        status: result.status,
        priority: result.priority,
        assignedEmployeeId: result.assignedEmployeeId,
        assignedEmployeeName: result.assignedEmployeeName,
        dueDate: result.dueDate,
      });
    },
  };
}
