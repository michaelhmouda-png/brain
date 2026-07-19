import { createHash, randomUUID } from 'crypto';

import type { ActorContext } from '../actor-context.ts';
import type { BrainRequestContext } from '../request-context.ts';
import type { TenantScope } from '../tenant-scope.ts';
import { CommandError } from './command-errors.ts';

export const COMMAND_SCHEMA_VERSION = 1;

export interface CommandEnvelope<TType extends string, TPayload> {
  readonly commandId: string;
  readonly commandType: TType;
  readonly schemaVersion: number;
  readonly payload: Readonly<TPayload>;
  readonly actor: ActorContext;
  readonly tenant: Readonly<TenantScope>;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
}

export interface CommandDefinition<TType extends string, TPayload> {
  readonly commandType: TType;
  canonicalize(input: unknown): TPayload;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateContext(context: BrainRequestContext): void {
  if (
    !context ||
    context.actor.status !== 'active' ||
    context.actor.actorType !== 'human' ||
    context.actor.actorId !== context.actor.authUserId ||
    context.tenant.scopeType !== 'company' ||
    context.tenant.tenantId !== context.tenant.companyId ||
    context.tenant.tenantId !== context.actor.companyId
  ) {
    throw new CommandError('COMMAND_CONTEXT_MISMATCH');
  }
}

export function createCommandEnvelope<TType extends string, TPayload>(input: {
  readonly definition: CommandDefinition<TType, TPayload>;
  readonly payload: unknown;
  readonly context: BrainRequestContext;
  readonly causationId?: string | null;
  readonly schemaVersion?: number;
  readonly now?: Date;
}): Readonly<CommandEnvelope<TType, TPayload>> {
  validateContext(input.context);
  const schemaVersion = input.schemaVersion ?? COMMAND_SCHEMA_VERSION;
  if (schemaVersion !== COMMAND_SCHEMA_VERSION) throw new CommandError('UNSUPPORTED_COMMAND_VERSION');
  const causationId = input.causationId ?? null;
  if (causationId !== null && !UUID_PATTERN.test(causationId)) throw new CommandError('INVALID_COMMAND');

  let payload: TPayload;
  try {
    payload = input.definition.canonicalize(input.payload);
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError('INVALID_COMMAND_PAYLOAD');
  }

  const frozenPayload = Object.freeze(payload as object) as Readonly<TPayload>;
  const idempotencyMaterial = {
    commandType: input.definition.commandType,
    payload: frozenPayload,
    actorId: input.context.actor.actorId,
    tenantId: input.context.tenant.tenantId,
    schemaVersion,
    causationId,
  };
  const idempotencyKey = createHash('sha256').update(stable(idempotencyMaterial)).digest('hex');

  return Object.freeze({
    commandId: randomUUID(),
    commandType: input.definition.commandType,
    schemaVersion,
    payload: frozenPayload,
    actor: input.context.actor,
    tenant: input.context.tenant,
    correlationId: input.context.actor.correlationId,
    causationId,
    idempotencyKey,
    issuedAt: (input.now ?? new Date()).toISOString(),
  });
}
