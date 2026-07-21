import type { ProposalAction } from '../action-proposals.ts';
import type { BrainRequestContext } from '../kernel/request-context.ts';
import type { CreateTaskApplicationService } from '../tasks/application/create-task-application-service.ts';
import { logApprovedExecutionFailure } from '../execution-diagnostics.server.ts';

export type LegacyApprovedAction = Exclude<ProposalAction, 'create_task' | 'create_task_batch'>;

export interface ExecuteApprovedActionInput {
  readonly context: BrainRequestContext;
  readonly action: ProposalAction;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly proposalId: string;
}

export interface ApprovedActionExecutionResult {
  readonly success: boolean;
  readonly createdCount?: number;
}

export interface ApprovedActionRegistry {
  execute(input: ExecuteApprovedActionInput): Promise<ApprovedActionExecutionResult>;
}

export type LegacyApprovedActionExecutor = (
  payload: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export interface ApprovedActionRegistryDependencies {
  readonly createTaskApplicationService: CreateTaskApplicationService | null;
  readonly executeCreateTaskBatch?: ((input: ExecuteApprovedActionInput) => Promise<{ success: true; createdCount: number }>) | null;
  readonly legacyExecutors: Readonly<Record<LegacyApprovedAction, LegacyApprovedActionExecutor>>;
}

export class ApprovedActionRegistryError extends Error {
  readonly code: 'UNSUPPORTED_APPROVED_ACTION' | 'APPROVED_ACTION_EXECUTION_FAILED';

  constructor(code: 'UNSUPPORTED_APPROVED_ACTION' | 'APPROVED_ACTION_EXECUTION_FAILED') {
    super(code);
    this.name = 'ApprovedActionRegistryError';
    this.code = code;
  }
}

function safeResult(result: unknown): ApprovedActionExecutionResult {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : null;
  return Object.freeze({
    success: record?.success === true,
    ...(typeof record?.createdCount === 'number' ? { createdCount: record.createdCount } : {}),
  });
}

export function createApprovedActionRegistry(
  dependencies: ApprovedActionRegistryDependencies,
): ApprovedActionRegistry {
  async function executeLegacy(
    action: LegacyApprovedAction,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<ApprovedActionExecutionResult> {
    const executor = dependencies.legacyExecutors[action];
    if (!executor) throw new ApprovedActionRegistryError('UNSUPPORTED_APPROVED_ACTION');
    return safeResult(await executor(Object.freeze({ ...payload, confirmed: true })));
  }

  return Object.freeze({
    async execute(input: ExecuteApprovedActionInput) {
      switch (input.action) {
        case 'create_task':
          if (!dependencies.createTaskApplicationService) {
            throw new ApprovedActionRegistryError('APPROVED_ACTION_EXECUTION_FAILED');
          }
          try {
            await dependencies.createTaskApplicationService.execute({
              context: input.context,
              payload: input.payload,
              proposalId: input.proposalId,
            });
          } catch (error) {
            logApprovedExecutionFailure({
              proposalId: input.proposalId,
              correlationId: input.context.actor.correlationId,
              action: input.action,
              stage: 'approved_action_registry.execute',
            }, error);
            throw error;
          }
          return Object.freeze({ success: true });
        case 'create_task_batch':
          if (!dependencies.executeCreateTaskBatch) throw new ApprovedActionRegistryError('APPROVED_ACTION_EXECUTION_FAILED');
          return safeResult(await dependencies.executeCreateTaskBatch(input));
        case 'create_employee': return executeLegacy(input.action, input.payload);
        case 'record_inventory_movement': return executeLegacy(input.action, input.payload);
        case 'create_shift': return executeLegacy(input.action, input.payload);
        case 'update_shift': return executeLegacy(input.action, input.payload);
        case 'delete_shift': return executeLegacy(input.action, input.payload);
        case 'create_maintenance_ticket': return executeLegacy(input.action, input.payload);
        case 'update_maintenance_ticket': return executeLegacy(input.action, input.payload);
        case 'delete_maintenance_ticket': return executeLegacy(input.action, input.payload);
        case 'complete_maintenance_ticket': return executeLegacy(input.action, input.payload);
        case 'create_announcement': return executeLegacy(input.action, input.payload);
        case 'update_announcement': return executeLegacy(input.action, input.payload);
        case 'delete_announcement': return executeLegacy(input.action, input.payload);
        case 'create_incident': return executeLegacy(input.action, input.payload);
        case 'update_incident': return executeLegacy(input.action, input.payload);
        case 'delete_incident': return executeLegacy(input.action, input.payload);
        default: throw new ApprovedActionRegistryError('UNSUPPORTED_APPROVED_ACTION');
      }
    },
  });
}
