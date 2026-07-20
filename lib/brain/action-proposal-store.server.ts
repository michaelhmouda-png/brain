import 'server-only';

import { createSupabaseServer } from '@/lib/supabaseServer';
import type { ProposalRecord, ProposalStore } from './action-proposals';

function dbRow(record: ProposalRecord) {
  return {
    id: record.id, actor_id: record.actorId, profile_id: record.profileId, tenant_id: record.tenantId,
    canonical_action: record.canonicalAction, canonical_payload: record.canonicalPayload,
    payload_hash: record.payloadHash, schema_version: record.schemaVersion, risk: record.risk,
    required_role: record.requiredRole, safe_preview: record.preview, status: record.status,
    correlation_id: record.correlationId, idempotency_key: record.idempotencyKey,
    created_at: record.createdAt, expires_at: record.expiresAt,
  };
}

function proposal(row: Record<string, unknown>): ProposalRecord {
  return {
    id: row.id as string, actorId: row.actor_id as string, profileId: row.profile_id as string, tenantId: row.tenant_id as string,
    canonicalAction: row.canonical_action as ProposalRecord['canonicalAction'], canonicalPayload: row.canonical_payload as Record<string, unknown>,
    payloadHash: row.payload_hash as string, schemaVersion: row.schema_version as number, risk: row.risk as ProposalRecord['risk'],
    requiredRole: row.required_role as string | null, preview: row.safe_preview as ProposalRecord['preview'], status: row.status as ProposalRecord['status'],
    correlationId: row.correlation_id as string, idempotencyKey: row.idempotency_key as string,
    createdAt: row.created_at as string, expiresAt: row.expires_at as string, executedAt: row.executed_at as string | null,
    safeResult: row.safe_result as string | null,
  };
}

function assertNoError(
  error: { message?: string; code?: string; details?: string; hint?: string } | null,
  operation: string,
) {
  if (!error) return;
  const failure = new Error(error.message || 'PROPOSAL_STORE_UNAVAILABLE', { cause: error });
  Object.assign(failure, {
    code: error.code,
    details: error.details,
    hint: error.hint,
    operation,
  });
  throw failure;
}

export function createServerActionProposalStore(): ProposalStore {
  const db = createSupabaseServer();
  return {
    async insert(record) {
      const { error } = await db.from('brain_action_proposals').insert(dbRow(record));
      assertNoError(error, 'proposal.persistence.insert');
    },
    async reject(id, identity) {
      const { data, error } = await db.rpc('reject_brain_action_proposal', {
        p_id: id, p_actor_id: identity.actorId, p_profile_id: identity.profileId, p_tenant_id: identity.tenantId,
      });
      assertNoError(error, 'proposal.persistence.reject');
      return (data as 'rejected' | 'not_found' | 'invalid_status') ?? 'not_found';
    },
    async claim(id, identity, now) {
      const { data, error } = await db.rpc('claim_brain_action_proposal', {
        p_id: id, p_actor_id: identity.actorId, p_profile_id: identity.profileId, p_tenant_id: identity.tenantId, p_now: now,
      });
      assertNoError(error, 'proposal.persistence.claim');
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return { outcome: 'not_found' };
      if (row.outcome === 'claimed') return { outcome: 'claimed', proposal: proposal(row.proposal) };
      if (row.outcome === 'executed') return { outcome: 'executed', safeResult: row.safe_result ?? null };
      return { outcome: row.outcome as 'not_found' | 'expired' | 'invalid_status' };
    },
    async markExecuted(id, payloadHash, safeResult) {
      const { data, error } = await db.rpc('complete_brain_action_proposal', { p_id: id, p_payload_hash: payloadHash, p_safe_result: safeResult });
      assertNoError(error, 'proposal.persistence.complete');
      if (data !== true) throw new Error('PROPOSAL_TRANSITION_FAILED');
    },
    async markFailed(id, payloadHash, safeErrorCode) {
      const { data, error } = await db.rpc('fail_brain_action_proposal', { p_id: id, p_payload_hash: payloadHash, p_error_code: safeErrorCode });
      assertNoError(error, 'proposal.persistence.fail');
      if (data !== true) throw new Error('PROPOSAL_TRANSITION_FAILED');
    },
  };
}
