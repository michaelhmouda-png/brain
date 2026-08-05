import type { SupabaseServiceConfiguration } from './supabase-service-configuration';

export type SafeWorkerTelemetryDiagnostic = {
  code: string;
  stage: 'client_configuration' | 'rpc_request' | 'rpc_response';
  postgrestCode: string | null;
  httpStatus: number | null;
  credentialKind: SupabaseServiceConfiguration['credentialKind'];
  credentialRoleValid: boolean | null;
  projectBinding: SupabaseServiceConfiguration['projectBinding'] | 'confirmed' | 'rejected';
};

type RpcError = { code?: unknown } | null;
export type WorkerHealthRpcEnvelope = {
  data: unknown;
  error: RpcError;
  status?: unknown;
};

function safePostgrestCode(error: RpcError): string | null {
  const candidate = error && typeof error.code === 'string' ? error.code : '';
  return /^[A-Z0-9_]{1,32}$/.test(candidate) ? candidate : null;
}

function safeHttpStatus(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 599 ? Number(value) : null;
}

function diagnosticCode(postgrestCode: string | null, status: number | null): string {
  if (status === 0) return 'WORKER_TELEMETRY_TRANSPORT_FAILED';
  if (status === 401) return 'SUPABASE_SERVICE_CREDENTIAL_REJECTED';
  if (status === 403 || postgrestCode === '42501') return 'SUPABASE_SERVICE_ROLE_REQUIRED';
  if (status === 404 || postgrestCode === 'PGRST202') return 'WORKER_HEALTH_RPC_UNAVAILABLE';
  return 'WORKER_TELEMETRY_RPC_FAILED';
}

export function configurationDiagnostic(
  configuration: SupabaseServiceConfiguration,
): SafeWorkerTelemetryDiagnostic {
  return {
    code: configuration.code,
    stage: 'client_configuration',
    postgrestCode: null,
    httpStatus: null,
    credentialKind: configuration.credentialKind,
    credentialRoleValid: configuration.credentialRoleValid,
    projectBinding: configuration.projectBinding,
  };
}

export function rpcFailureDiagnostic(
  envelope: WorkerHealthRpcEnvelope,
  configuration: SupabaseServiceConfiguration,
): SafeWorkerTelemetryDiagnostic {
  const postgrestCode = safePostgrestCode(envelope.error);
  const httpStatus = safeHttpStatus(envelope.status);
  return {
    code: diagnosticCode(postgrestCode, httpStatus),
    stage: 'rpc_request',
    postgrestCode,
    httpStatus,
    credentialKind: configuration.credentialKind,
    credentialRoleValid: configuration.credentialRoleValid,
    projectBinding: httpStatus === 401 || httpStatus === 403
      ? 'rejected'
      : httpStatus !== null && httpStatus > 0
        ? 'confirmed'
        : configuration.projectBinding,
  };
}

export function responseFailureDiagnostic(
  envelope: WorkerHealthRpcEnvelope,
  configuration: SupabaseServiceConfiguration,
): SafeWorkerTelemetryDiagnostic {
  return {
    code: 'WORKER_HEALTH_RESPONSE_INVALID',
    stage: 'rpc_response',
    postgrestCode: null,
    httpStatus: safeHttpStatus(envelope.status),
    credentialKind: configuration.credentialKind,
    credentialRoleValid: configuration.credentialRoleValid,
    projectBinding: 'confirmed',
  };
}

export function normalizeWorkerHealthPayload(data: unknown): Record<string, unknown> | null {
  let candidate = data;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { return null; }
  }
  if (Array.isArray(candidate)) {
    if (candidate.length !== 1) return null;
    [candidate] = candidate;
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const value = candidate as Record<string, unknown>;
  if (!Array.isArray(value.workers)
    || !value.queues || typeof value.queues !== 'object' || Array.isArray(value.queues)
    || !value.materialization || typeof value.materialization !== 'object' || Array.isArray(value.materialization)
    || typeof value.observedAt !== 'string') return null;
  return value;
}
