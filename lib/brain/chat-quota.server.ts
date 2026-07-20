import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export type BrainChatQuota = {
  limit: number;
  remaining: number;
  resetAt: string | null;
};

export type BrainChatQuotaAdmission = BrainChatQuota & { admitted: boolean };

function row(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
}

function quotaFromRow(value: unknown): BrainChatQuota | null {
  const candidate = row(value);
  if (!candidate || candidate.quota_limit !== 100 ||
      typeof candidate.remaining !== 'number' ||
      !Number.isInteger(candidate.remaining) ||
      candidate.remaining < 0 || candidate.remaining > 100 ||
      !(candidate.reset_at === null || typeof candidate.reset_at === 'string')) return null;
  return {
    limit: 100,
    remaining: candidate.remaining,
    resetAt: candidate.reset_at,
  };
}

export async function admitBrainChatRequest(supabase: SupabaseClient): Promise<BrainChatQuotaAdmission> {
  const { data, error } = await supabase.rpc('admit_brain_chat_request');
  const quota = quotaFromRow(data);
  const candidate = row(data);
  if (error || !quota || typeof candidate?.admitted !== 'boolean') throw new Error('BRAIN_CHAT_QUOTA_UNAVAILABLE');
  return { ...quota, admitted: candidate.admitted };
}

export async function getBrainChatQuotaStatus(supabase: SupabaseClient): Promise<BrainChatQuota> {
  const { data, error } = await supabase.rpc('get_brain_chat_quota_status');
  const quota = quotaFromRow(data);
  if (error || !quota) throw new Error('BRAIN_CHAT_QUOTA_UNAVAILABLE');
  return quota;
}
