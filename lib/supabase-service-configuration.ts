export type SupabaseServiceCredentialKind = 'secret_key' | 'legacy_jwt' | 'unknown';
export type SupabaseProjectBinding = 'matched' | 'mismatched' | 'request_required' | 'unavailable';

export type SupabaseServiceConfiguration = {
  usable: boolean;
  code: string;
  credentialKind: SupabaseServiceCredentialKind;
  credentialRoleValid: boolean | null;
  projectBinding: SupabaseProjectBinding;
};

function decodeJwtPayload(value: string): Record<string, unknown> | null {
  const part = value.split('.')[1];
  if (!part) return null;
  try {
    const decoded = Buffer.from(part, 'base64url').toString('utf8');
    const payload: unknown = JSON.parse(decoded);
    return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Returns only classifications and booleans; no URL, project ref, key, or claim value is returned. */
export function inspectSupabaseServiceConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseServiceConfiguration {
  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  let projectRef = '';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) throw new Error('invalid');
    projectRef = parsed.hostname.slice(0, -'.supabase.co'.length);
  } catch {
    return {
      usable: false,
      code: 'SUPABASE_SERVICE_URL_INVALID',
      credentialKind: 'unknown',
      credentialRoleValid: null,
      projectBinding: 'unavailable',
    };
  }

  if (/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)) {
    return {
      usable: true,
      code: 'SUPABASE_SERVICE_CONFIGURATION_VALID',
      credentialKind: 'secret_key',
      credentialRoleValid: true,
      projectBinding: 'request_required',
    };
  }

  if (key.split('.').length === 3) {
    const payload = decodeJwtPayload(key);
    const roleValid = payload?.role === 'service_role';
    const claimedRef = typeof payload?.ref === 'string' ? payload.ref : null;
    const projectBinding = claimedRef === null ? 'request_required' : claimedRef === projectRef ? 'matched' : 'mismatched';
    return {
      usable: roleValid && projectBinding !== 'mismatched',
      code: !roleValid
        ? 'SUPABASE_SERVICE_CREDENTIAL_ROLE_INVALID'
        : projectBinding === 'mismatched'
          ? 'SUPABASE_SERVICE_PROJECT_MISMATCH'
          : 'SUPABASE_SERVICE_CONFIGURATION_VALID',
      credentialKind: 'legacy_jwt',
      credentialRoleValid: roleValid,
      projectBinding,
    };
  }

  return {
    usable: false,
    code: 'SUPABASE_SERVICE_CREDENTIAL_INVALID',
    credentialKind: 'unknown',
    credentialRoleValid: null,
    projectBinding: 'unavailable',
  };
}
