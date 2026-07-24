import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { parseAgentMetadata } from '@/lib/brain-agent/contracts';
import { createAgentCredential, pairingCodeHash, requestAddressRateKey } from '@/lib/brain-agent/security.server';
import { admitAgentRequest } from '@/lib/brain-agent/rate-limit.server';

const headers = { 'Cache-Control': 'private, no-store' };
type PairingFailureReason =
  | 'not_found'
  | 'expired'
  | 'already_used'
  | 'gateway_mismatch'
  | 'company_mismatch'
  | 'validation_failure'
  | 'authentication_failure'
  | 'rate_limited'
  | 'server_failure';

type PairingStage =
  | 'server_configuration'
  | 'rate_identity'
  | 'rate_limit'
  | 'request_validation'
  | 'credential_generation'
  | 'consume_pairing_rpc'
  | 'failure_diagnosis';

type PairingInternalErrorCode =
  | 'PAIRING_SERVER_CONFIGURATION_MISSING'
  | 'PAIRING_SECURITY_CONFIGURATION_MISSING'
  | 'PAIRING_SECURITY_CONFIGURATION_INVALID'
  | 'PAIRING_TRUSTED_CLIENT_ADDRESS_UNAVAILABLE'
  | 'PAIRING_RATE_LIMIT_UNAVAILABLE'
  | 'PAIRING_RATE_LIMIT_REJECTED'
  | 'PAIRING_REQUEST_VALIDATION_FAILED'
  | 'PAIRING_CREDENTIAL_GENERATION_FAILED'
  | 'PAIRING_CONSUME_RPC_FAILED'
  | 'PAIRING_CONSUME_RPC_EMPTY'
  | 'PAIRING_FAILURE_DIAGNOSIS_FAILED'
  | 'PAIRING_UNCLASSIFIED_FAILURE';

const pairingErrorCode: Record<PairingFailureReason, string> = {
  not_found: 'PAIRING_CODE_NOT_FOUND',
  expired: 'PAIRING_CODE_EXPIRED',
  already_used: 'PAIRING_CODE_ALREADY_USED',
  gateway_mismatch: 'PAIRING_GATEWAY_MISMATCH',
  company_mismatch: 'PAIRING_COMPANY_MISMATCH',
  validation_failure: 'PAIRING_VALIDATION_FAILED',
  authentication_failure: 'PAIRING_AUTHENTICATION_FAILED',
  rate_limited: 'PAIRING_RATE_LIMITED',
  server_failure: 'PAIRING_UNAVAILABLE',
};

const pairingFailure = (reason: PairingFailureReason) => ({
  reason,
  notFound: reason === 'not_found',
  expired: reason === 'expired',
  alreadyUsed: reason === 'already_used',
  gatewayMismatch: reason === 'gateway_mismatch',
  companyMismatch: reason === 'company_mismatch',
  validationFailure: reason === 'validation_failure',
  authenticationFailure: reason === 'authentication_failure',
});

function pairingInternalErrorCode(stage: PairingStage, error?: unknown): PairingInternalErrorCode {
  const message = error instanceof Error ? error.message : '';
  if (stage === 'server_configuration' && message.includes('Missing SUPABASE_SERVICE_ROLE_KEY')) {
    return 'PAIRING_SERVER_CONFIGURATION_MISSING';
  }
  if (message === 'BRAIN_AGENT_SECURITY_CONFIGURATION_MISSING') {
    return 'PAIRING_SECURITY_CONFIGURATION_MISSING';
  }
  if (message === 'BRAIN_AGENT_SECURITY_CONFIGURATION_INVALID') {
    return 'PAIRING_SECURITY_CONFIGURATION_INVALID';
  }
  if (message === 'BRAIN_AGENT_TRUSTED_CLIENT_ADDRESS_UNAVAILABLE') {
    return 'PAIRING_TRUSTED_CLIENT_ADDRESS_UNAVAILABLE';
  }
  if (message === 'BRAIN_AGENT_RATE_LIMIT_UNAVAILABLE') {
    return 'PAIRING_RATE_LIMIT_UNAVAILABLE';
  }
  if (stage === 'credential_generation') return 'PAIRING_CREDENTIAL_GENERATION_FAILED';
  if (stage === 'failure_diagnosis') return 'PAIRING_FAILURE_DIAGNOSIS_FAILED';
  return 'PAIRING_UNCLASSIFIED_FAILURE';
}

function logPairingFailure(
  stage: PairingStage,
  requestId: string,
  internalErrorCode: PairingInternalErrorCode,
) {
  console.warn('[Brain Agent Pairing] Request rejected', { stage, requestId, internalErrorCode });
}

function pairingFailureResponse(
  requestId: string,
  reason: PairingFailureReason,
  status: number,
  retryAfter?: number,
) {
  const body = { error: pairingErrorCode[reason], requestId, pairingFailure: pairingFailure(reason) };
  return NextResponse.json(body, {
    status,
    headers: {
      ...headers,
      'X-Request-ID': requestId,
      ...(retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) }),
    },
  });
}

async function diagnosePairingFailure(
  service: ReturnType<typeof createSupabaseServer>,
  codeHash: string,
): Promise<PairingFailureReason> {
  const { data: pairing, error: pairingError } = await service
    .from('device_pairing_requests')
    .select('gateway_id,company_id,location_id,expires_at,used_at,revoked_at')
    .eq('code_hash', codeHash)
    .maybeSingle();
  if (pairingError) return 'server_failure';
  if (!pairing) return 'not_found';
  if (pairing.used_at) return 'already_used';
  if (new Date(pairing.expires_at).getTime() <= Date.now()) return 'expired';
  if (pairing.revoked_at) return 'authentication_failure';

  const { data: gateway, error: gatewayError } = await service
    .from('device_gateways')
    .select('id,company_id,location_id,status')
    .eq('id', pairing.gateway_id)
    .maybeSingle();
  if (gatewayError) return 'server_failure';
  if (!gateway || gateway.id !== pairing.gateway_id || gateway.location_id !== pairing.location_id) return 'gateway_mismatch';
  if (gateway.company_id !== pairing.company_id) return 'company_mismatch';
  if (gateway.status === 'disabled') return 'authentication_failure';

  const { data: credentials, error: credentialError } = await service
    .from('device_agent_credentials')
    .select('id')
    .eq('gateway_id', pairing.gateway_id)
    .is('revoked_at', null)
    .limit(1);
  if (credentialError) return 'server_failure';
  if (credentials?.length) return 'authentication_failure';
  return 'server_failure';
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  let stage: PairingStage = 'server_configuration';
  try {
    const service = createSupabaseServer();
    stage = 'rate_identity';
    const rateKey = requestAddressRateKey(request);
    stage = 'rate_limit';
    const rate = await admitAgentRequest(service, 'pairing', rateKey);
    if (!rate.admitted) {
      logPairingFailure(stage, requestId, 'PAIRING_RATE_LIMIT_REJECTED');
      return pairingFailureResponse(requestId, 'rate_limited', 429, rate.retryAfter);
    }
    stage = 'request_validation';
    const body: unknown = await request.json().catch(() => null);
    const metadata = parseAgentMetadata(body, true);
    const code = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).pairingCode : null;
    if (!metadata?.publicAgentId || typeof code !== 'string' || !/^[0-9a-f]{32}$/i.test(code)) {
      logPairingFailure(stage, requestId, 'PAIRING_REQUEST_VALIDATION_FAILED');
      return pairingFailureResponse(requestId, 'validation_failure', 400);
    }
    const codeHash = pairingCodeHash(code.toLowerCase());
    stage = 'credential_generation';
    const credential = createAgentCredential(metadata.publicAgentId);
    stage = 'consume_pairing_rpc';
    const { data, error } = await service.rpc('consume_device_pairing_request', { p_code_hash: codeHash, p_public_agent_id: metadata.publicAgentId, p_credential_hash: credential.hash, p_agent_version: metadata.agentVersion, p_platform: metadata.platform, p_os_version: metadata.osVersion, p_hostname_label: metadata.hostnameLabel, p_declared_capabilities: metadata.declaredCapabilities });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) {
      logPairingFailure(stage, requestId, error ? 'PAIRING_CONSUME_RPC_FAILED' : 'PAIRING_CONSUME_RPC_EMPTY');
      stage = 'failure_diagnosis';
      const reason = await diagnosePairingFailure(service, codeHash);
      const status = reason === 'expired' ? 410 : reason === 'already_used' || reason === 'gateway_mismatch' || reason === 'company_mismatch' ? 409 : reason === 'server_failure' ? 503 : 401;
      return pairingFailureResponse(requestId, reason, status);
    }
    return NextResponse.json(
      { data: { credential: credential.token, gatewayId: row.gateway_id, locationId: row.location_id, pollingIntervalSeconds: 60, approvedCapabilities: row.approved_capabilities } },
      { status: 201, headers: { ...headers, 'X-Request-ID': requestId } },
    );
  } catch (error) {
    logPairingFailure(stage, requestId, pairingInternalErrorCode(stage, error));
    return pairingFailureResponse(requestId, 'server_failure', 503);
  }
}
