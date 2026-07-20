export const COMPANY_API_ROLES = ['super_admin', 'owner', 'manager', 'employee'] as const;
export type CompanyApiRole = (typeof COMPANY_API_ROLES)[number];

export type CompanyApiProfile = {
  id?: unknown;
  company_id?: unknown;
  role?: unknown;
  status?: unknown;
};

export interface CompanyApiAuthorizationAccess {
  getAuthenticatedUserId(): Promise<string | null>;
  loadProfile(userId: string): Promise<{ profile: CompanyApiProfile | null; failed: boolean }>;
  companyExists(companyId: string): Promise<boolean>;
}

export type CompanyApiAuthorization =
  | {
      authorized: true;
      userId: string;
      profileId: string;
      companyId: string;
      role: CompanyApiRole;
    }
  | {
      authorized: false;
      status: 401 | 403;
      code: 'UNAUTHENTICATED' | 'ACCOUNT_NOT_PROVISIONED';
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCompanyApiRole(value: unknown): value is CompanyApiRole {
  return typeof value === 'string' && COMPANY_API_ROLES.some((role) => role === value);
}

/**
 * Resolves one explicit company scope from trusted authentication and profile data.
 * Super admins remain bound to their persisted profile company; request parameters
 * cannot select or widen tenant access. Future multi-company access must add a
 * trusted membership lookup rather than weakening this boundary.
 */
export async function authorizeCompanyApiRequest(
  access: CompanyApiAuthorizationAccess
): Promise<CompanyApiAuthorization> {
  let userId: string | null;
  try {
    userId = await access.getAuthenticatedUserId();
  } catch {
    return { authorized: false, status: 401, code: 'UNAUTHENTICATED' };
  }
  if (!userId) return { authorized: false, status: 401, code: 'UNAUTHENTICATED' };

  let loaded: { profile: CompanyApiProfile | null; failed: boolean };
  try {
    loaded = await access.loadProfile(userId);
  } catch {
    return { authorized: false, status: 403, code: 'ACCOUNT_NOT_PROVISIONED' };
  }

  const profile = loaded.profile;
  if (
    loaded.failed ||
    !profile ||
    profile.id !== userId ||
    profile.status !== 'active' ||
    !isCompanyApiRole(profile.role) ||
    typeof profile.company_id !== 'string' ||
    !UUID_PATTERN.test(profile.company_id)
  ) {
    return { authorized: false, status: 403, code: 'ACCOUNT_NOT_PROVISIONED' };
  }

  let companyExists = false;
  try {
    companyExists = await access.companyExists(profile.company_id);
  } catch {
    companyExists = false;
  }
  if (!companyExists) {
    return { authorized: false, status: 403, code: 'ACCOUNT_NOT_PROVISIONED' };
  }

  return {
    authorized: true,
    userId,
    profileId: profile.id,
    companyId: profile.company_id,
    role: profile.role,
  };
}
