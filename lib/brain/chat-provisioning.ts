export const BRAIN_CHAT_ROLES = [
  'super_admin',
  'owner',
  'manager',
  'employee',
] as const;

export type BrainChatRole = (typeof BRAIN_CHAT_ROLES)[number];

export interface BrainChatProfile {
  id: string;
  full_name: string | null;
  role: BrainChatRole;
  status: 'active';
  company_id: string;
  employee_id: string | null;
}

interface ProfileRecord {
  id?: unknown;
  full_name?: unknown;
  role?: unknown;
  status?: unknown;
  company_id?: unknown;
  employee_id?: unknown;
}

export interface BrainChatProvisioningAccess {
  loadProfile(userId: string): Promise<{
    profile: ProfileRecord | null;
    failed: boolean;
  }>;
  companyExists(companyId: string): Promise<boolean>;
}

export type BrainChatProvisioningResult =
  | { authorized: true; profile: BrainChatProfile }
  | { authorized: false; code: 'ACCOUNT_NOT_PROVISIONED' };

export function createAccountNotProvisionedResponse(): Response {
  return Response.json(
    {
      error: 'This account is not fully provisioned. Contact your administrator.',
      code: 'ACCOUNT_NOT_PROVISIONED',
    },
    { status: 403 }
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isBrainChatRole(value: unknown): value is BrainChatRole {
  return typeof value === 'string' && BRAIN_CHAT_ROLES.some((role) => role === value);
}

/**
 * Resolves the trusted tenant boundary for Brain chat.
 *
 * This deliberately has no repair or provisioning behavior. A normal request
 * may validate persisted access, but it must never create a profile, assign a
 * tenant, or choose a fallback company.
 */
export async function resolveBrainChatProvisioning(
  userId: string,
  access: BrainChatProvisioningAccess
): Promise<BrainChatProvisioningResult> {
  const loaded = await access.loadProfile(userId);
  const profile = loaded.profile;
  const employeeId = profile?.employee_id === null || profile?.employee_id === undefined
    ? null
    : typeof profile.employee_id === 'string' && UUID_PATTERN.test(profile.employee_id)
      ? profile.employee_id
      : undefined;

  if (
    loaded.failed ||
    !profile ||
    profile.id !== userId ||
    profile.status !== 'active' ||
    !isBrainChatRole(profile.role) ||
    employeeId === undefined ||
    typeof profile.company_id !== 'string' ||
    !UUID_PATTERN.test(profile.company_id)
  ) {
    return { authorized: false, code: 'ACCOUNT_NOT_PROVISIONED' };
  }

  if (!(await access.companyExists(profile.company_id))) {
    return { authorized: false, code: 'ACCOUNT_NOT_PROVISIONED' };
  }

  return {
    authorized: true,
    profile: {
      id: profile.id,
      full_name: typeof profile.full_name === 'string' ? profile.full_name : null,
      role: profile.role,
      status: profile.status,
      company_id: profile.company_id,
      employee_id: employeeId,
    },
  };
}
