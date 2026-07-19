import { randomUUID } from 'crypto';

import type { ActorContext } from '../actor-context.ts';
import type { CommandEnvelope } from '../commands/command-envelope.ts';
import type { TenantScope } from '../tenant-scope.ts';
import { DomainEventError } from './domain-event-errors.ts';

export const DOMAIN_EVENT_SCHEMA_VERSION = 1;

export interface DomainEventEnvelope<TType extends string, TPayload> {
  readonly eventId: string;
  readonly eventType: TType;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Readonly<TPayload>;
  readonly actor: ActorContext;
  readonly tenant: Readonly<TenantScope>;
  readonly correlationId: string;
  readonly causationId: string;
  readonly commandId: string;
  readonly occurredAt: string;
}

export interface DomainEventDefinition<TType extends string, TPayload> {
  readonly eventType: TType;
  readonly aggregateType: string;
  canonicalize(input: unknown): TPayload;
  aggregateId(payload: Readonly<TPayload>): string;
}

export function createDomainEventEnvelope<TType extends string, TPayload>(input: {
  readonly definition: DomainEventDefinition<TType, TPayload>;
  readonly payload: unknown;
  readonly command: CommandEnvelope<string, unknown>;
  readonly schemaVersion?: number;
  readonly occurredAt?: Date;
}): Readonly<DomainEventEnvelope<TType, TPayload>> {
  if (input.definition.eventType !== 'task.created') {
    throw new DomainEventError('UNSUPPORTED_EVENT_TYPE');
  }
  const { command } = input;
  if (!command?.commandId || !command.correlationId || !command.causationId) {
    throw new DomainEventError('INVALID_EVENT');
  }
  if (
    command.actor.actorId !== command.actor.authUserId ||
    command.actor.companyId !== command.tenant.tenantId ||
    command.tenant.tenantId !== command.tenant.companyId ||
    command.correlationId !== command.actor.correlationId
  ) {
    throw new DomainEventError('EVENT_CONTEXT_MISMATCH');
  }
  const schemaVersion = input.schemaVersion ?? DOMAIN_EVENT_SCHEMA_VERSION;
  if (schemaVersion !== DOMAIN_EVENT_SCHEMA_VERSION) {
    throw new DomainEventError('UNSUPPORTED_EVENT_VERSION');
  }

  let payload: TPayload;
  try {
    payload = input.definition.canonicalize(input.payload);
  } catch (error) {
    if (error instanceof DomainEventError) throw error;
    throw new DomainEventError('INVALID_EVENT_PAYLOAD');
  }
  const frozenPayload = Object.freeze(payload as object) as Readonly<TPayload>;
  const aggregateId = input.definition.aggregateId(frozenPayload);
  if (!aggregateId) throw new DomainEventError('INVALID_EVENT_PAYLOAD');

  return Object.freeze({
    eventId: randomUUID(),
    eventType: input.definition.eventType,
    schemaVersion,
    aggregateType: input.definition.aggregateType,
    aggregateId,
    payload: frozenPayload,
    actor: command.actor,
    tenant: command.tenant,
    correlationId: command.correlationId,
    causationId: command.commandId,
    commandId: command.commandId,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
  });
}
