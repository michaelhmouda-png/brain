import type { ProposalAction } from '../action-proposals.ts';
import type { BrainRequestContext } from '../kernel/request-context.ts';
import type { CreateTaskApplicationService } from '../tasks/application/create-task-application-service.ts';

export type LegacyApprovedAction = Exclude<ProposalAction, 'create_task'>;

export interface ExecuteApprovedActionInput {
  readonly context: BrainRequestContext;
  readonly action: ProposalAction;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly proposalId: string;
}

export interface ApprovedActionExecutionResult {
  readonly success: boolean;
}

export interface ApprovedActionRegistry {
  execute(input: ExecuteApprovedActionInput): Promise<ApprovedActionExecutionResult>;
}

export type LegacyApprovedActionExecutor = (
  payload: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export interface ApprovedActionRegistryDependencies {
  readonly createTaskApplicationService: CreateTaskApplicationService | null;
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
  return Object.freeze({
    success: Boolean(result && typeof result === 'object' &&
      (result as Record<string, unknown>).success === true),
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
          await dependencies.createTaskApplicationService.execute({
            context: input.context,
            payload: input.payload,
            proposalId: input.proposalId,
          });
          return Object.freeze({ success: true });
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
