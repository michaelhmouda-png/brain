import type { ActorContext } from './actor-context.ts';
import { ActorContextError } from './errors.ts';

export interface TenantScope {
  readonly tenantId: string;
  /** Compatibility alias for current domain code. Always equals tenantId. */
  readonly companyId: string;
  readonly scopeType: 'company';
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Derives the immutable company-level scope only from a trusted ActorContext. */
export function tenantScopeFromActor(actor: ActorContext): Readonly<TenantScope> {
  if (
    !actor ||
    actor.actorType !== 'human' ||
    actor.status !== 'active' ||
    actor.actorId !== actor.authUserId ||
    actor.profileId !== actor.authUserId ||
    typeof actor.companyId !== 'string' ||
    !UUID_PATTERN.test(actor.companyId)
  ) {
    throw new ActorContextError('INVALID_TENANT_SCOPE');
  }

  return Object.freeze({
    tenantId: actor.companyId,
    companyId: actor.companyId,
    scopeType: 'company' as const,
  });
}
