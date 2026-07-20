import type { ActorContext } from './actor-context.ts';
import type { TenantScope } from './tenant-scope.ts';

/** Narrow server-only execution context for the current Brain request. */
export interface BrainRequestContext {
  readonly actor: ActorContext;
  readonly tenant: Readonly<TenantScope>;
}
