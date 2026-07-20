import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  authorizeCompanyApiRequest,
  type CompanyApiAuthorization,
} from './company-api-authorization';

export async function authorizeCompanyApiRequestFromSupabase(
  supabase: SupabaseClient
): Promise<CompanyApiAuthorization> {
  return authorizeCompanyApiRequest({
    async getAuthenticatedUserId() {
      const { data: { user }, error } = await supabase.auth.getUser();
      return error ? null : user?.id ?? null;
    },
    async loadProfile(userId) {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, company_id, role, status, employee_id')
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
}
