import 'server-only';

import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { ActorContext } from '@/lib/brain/kernel/actor-context';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { isUuid, type FirstCustomerPayload } from './contracts';

type Prepared = {
  requestId: string;
  status: 'prepared' | 'completed';
  invitedUsers?: Array<{ email?: unknown; userId?: unknown }>;
};

function safeRpcError(error: { message?: string } | null, fallback: string): Error {
  const candidate = error?.message?.match(/ONBOARDING_[A-Z0-9_]+/)?.[0];
  return new Error(candidate ?? fallback);
}

function normalizePrepared(value: unknown): Prepared | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!isUuid(item.requestId) || (item.status !== 'prepared' && item.status !== 'completed')) return null;
  return {
    requestId: item.requestId,
    status: item.status,
    invitedUsers: Array.isArray(item.invitedUsers) ? item.invitedUsers as Prepared['invitedUsers'] : [],
  };
}

async function invite(service: SupabaseClient, user: FirstCustomerPayload['users'][number]): Promise<User> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!baseUrl) throw new Error('ONBOARDING_CONFIGURATION_UNAVAILABLE');
  const result = await service.auth.admin.inviteUserByEmail(user.email, {
    redirectTo: new URL('/login', baseUrl).toString(),
    data: { full_name: `${user.firstName} ${user.lastName}` },
  });
  if (result.error || !result.data.user) throw new Error('ONBOARDING_INVITATION_FAILED');
  return result.data.user;
}

export async function provisionFirstCustomer(
  actor: ActorContext,
  idempotencyKey: string,
  payload: FirstCustomerPayload,
  service: SupabaseClient = createSupabaseServer(),
) {
  if (actor.role !== 'super_admin') throw new Error('ONBOARDING_FORBIDDEN');
  const preparedEnvelope = await service.rpc('prepare_first_customer_onboarding_v1', {
    p_actor_profile_id: actor.profileId,
    p_idempotency_key: idempotencyKey,
    p_payload: payload,
  });
  if (preparedEnvelope.error) throw safeRpcError(preparedEnvelope.error, 'ONBOARDING_PREPARE_FAILED');
  let prepared = normalizePrepared(preparedEnvelope.data);
  if (!prepared) throw new Error('ONBOARDING_RESPONSE_INVALID');
  if (prepared.status === 'completed') return { status: 'completed' as const, invitedUserCount: payload.users.length };

  const recorded = new Map<string, string>();
  for (const item of prepared.invitedUsers ?? []) {
    if (typeof item.email === 'string' && isUuid(item.userId)) recorded.set(item.email.toLowerCase(), item.userId);
  }
  for (const user of payload.users) {
    if (recorded.has(user.email)) continue;
    const invited = await invite(service, user);
    const recordedEnvelope = await service.rpc('record_first_customer_invitation_v1', {
      p_actor_profile_id: actor.profileId,
      p_request_id: prepared.requestId,
      p_email: user.email,
      p_auth_user_id: invited.id,
    });
    if (recordedEnvelope.error) throw safeRpcError(recordedEnvelope.error, 'ONBOARDING_INVITATION_RECORD_FAILED');
    prepared = normalizePrepared(recordedEnvelope.data);
    if (!prepared) throw new Error('ONBOARDING_RESPONSE_INVALID');
  }

  const completed = await service.rpc('complete_first_customer_onboarding_v1', {
    p_actor_profile_id: actor.profileId,
    p_request_id: prepared.requestId,
  });
  if (completed.error) throw safeRpcError(completed.error, 'ONBOARDING_COMPLETION_FAILED');
  const result = normalizePrepared(completed.data);
  if (!result || result.status !== 'completed') throw new Error('ONBOARDING_PERSISTENCE_NOT_VERIFIED');
  return { status: 'completed' as const, invitedUserCount: payload.users.length };
}
