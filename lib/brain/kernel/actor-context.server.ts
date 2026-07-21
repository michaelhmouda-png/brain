import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveHumanActorContext, type ActorContext } from './actor-context';
import { ActorContextError } from './errors';

/** Authenticates and resolves the trusted human actor for one server request. */
export async function resolveActorContext(supabase: SupabaseClient): Promise<ActorContext> {
  try {
    return await resolveHumanActorContext({
        async getAuthenticatedUserId() {
          const { data: { user }, error } = await supabase.auth.getUser();
          return error ? null : user?.id ?? null;
        },
        async loadProfile(userId) {
          const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, role, status, company_id, employee_id, preferred_language')
            .eq('id', userId)
            .maybeSingle();
          return { profile: data, failed: Boolean(error) };
        },
        async companyExists(companyId) {
          const { data, error } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .maybeSingle();
          return !error && data?.id === companyId;
        },
    });
  } catch (error) {
    if (error instanceof ActorContextError) throw error;
    throw new ActorContextError('ACTOR_CONTEXT_UNAVAILABLE');
  }
}
