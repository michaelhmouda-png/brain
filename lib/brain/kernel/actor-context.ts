import { randomUUID } from 'crypto';

import {
  resolveBrainChatProvisioning,
  type BrainChatProvisioningAccess,
  type BrainChatRole,
} from '../chat-provisioning.ts';
import { ActorContextError } from './errors.ts';

export const ACTOR_TYPES = ['human', 'system', 'ai_agent', 'integration', 'device'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
export type ActorRole = BrainChatRole;

export interface ActorContext {
  actorId: string;
  authUserId: string;
  profileId: string;
  companyId: string;
  role: ActorRole;
  status: 'active';
  actorType: 'human';
  correlationId: string;
  displayName: string | null;
}

export interface HumanActorResolutionInput {
  authUserId: string;
  access: BrainChatProvisioningAccess;
  createCorrelationId?: () => string;
}

export interface ActorContextAccess extends BrainChatProvisioningAccess {
  getAuthenticatedUserId(): Promise<string | null>;
}

export async function resolveHumanActorContext(
  access: ActorContextAccess,
  createCorrelationId?: () => string
): Promise<ActorContext> {
  let authUserId: string | null;
  try {
    authUserId = await access.getAuthenticatedUserId();
  } catch {
    throw new ActorContextError('ACTOR_CONTEXT_UNAVAILABLE');
  }
  if (!authUserId) throw new ActorContextError('UNAUTHENTICATED');
  return resolveProvisionedHumanActor({ authUserId, access, createCorrelationId });
}

/**
 * Builds a human ActorContext on the existing Stage 0B provisioning boundary.
 * No request, browser, model, proposal, URL, or header values are accepted.
 */
export async function resolveProvisionedHumanActor(input: HumanActorResolutionInput): Promise<ActorContext> {
  const provisioning = await resolveBrainChatProvisioning(input.authUserId, input.access);
  if (!provisioning.authorized) throw new ActorContextError('ACCOUNT_NOT_PROVISIONED');

  const profile = provisioning.profile;
  const correlationId = (input.createCorrelationId ?? randomUUID)();
  if (!correlationId) throw new ActorContextError('INVALID_ACTOR_CONTEXT');

  return {
    actorId: input.authUserId,
    authUserId: input.authUserId,
    profileId: profile.id,
    companyId: profile.company_id,
    role: profile.role,
    status: profile.status,
    actorType: 'human',
    correlationId,
    displayName: profile.full_name,
  };
}
