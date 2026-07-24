import { randomUUID } from 'node:crypto';
import os from 'node:os';
import {
  parseClaimedDeviceCommands,
  type AgentCommandCompletion,
} from '../../lib/brain-agent/command-contracts.ts';
import { AGENT_VERSION, CAPABILITIES } from './constants.ts';
import { clearState, loadNvrCredential, loadState, protectCredential, saveState, unprotectCredential, type AgentState } from './storage.ts';

export { AGENT_VERSION, CAPABILITIES };
const DEVELOPMENT_PORTS = new Set(['3000', '3100']);
const PUBLIC_AGENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type PairingFailureFlags = {
  reason: string;
  notFound: boolean;
  expired: boolean;
  alreadyUsed: boolean;
  gatewayMismatch: boolean;
  companyMismatch: boolean;
  validationFailure: boolean;
  authenticationFailure: boolean;
};

export class PairingApiError extends Error {
  readonly httpStatus: number;
  readonly safeCode: string;
  readonly requestId: string | null;
  readonly failure: PairingFailureFlags | null;
  readonly responseBody: unknown;

  constructor(
    httpStatus: number,
    safeCode: string,
    requestId: string | null,
    failure: PairingFailureFlags | null,
    responseBody: unknown,
  ) {
    super(safeCode);
    this.name = 'PairingApiError';
    this.httpStatus = httpStatus;
    this.safeCode = safeCode;
    this.requestId = requestId;
    this.failure = failure;
    this.responseBody = responseBody;
  }
}

export function backoffDelay(attempt: number, random = Math.random) { const base = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6)); return Math.round(base * (0.75 + random() * 0.5)); }
const metadata = (state?: AgentState) => ({
  agentVersion: AGENT_VERSION,
  platform: process.platform,
  osVersion: os.release(),
  hostnameLabel: os.hostname().slice(0, 63).replace(/[^A-Za-z0-9._-]/g, '-'),
  declaredCapabilities: [...CAPABILITIES],
  credentialedNvrIds: Object.keys(state?.nvrCredentials ?? {})
    .filter((value) => PUBLIC_AGENT_ID.test(value))
    .map((value) => value.toLowerCase())
    .sort()
    .slice(0, 256),
});

export function validateBrainCloudOrigin(value: string, allowInsecureLocalhost = process.env.BRAIN_AGENT_ALLOW_INSECURE_LOCALHOST === 'true'): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('BRAIN_CLOUD_ORIGIN_NOT_ALLOWED'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('BRAIN_CLOUD_ORIGIN_NOT_ALLOWED');
  if (url.protocol === 'https:' && url.hostname === 'www.hospibrain.com' && url.port === '' && url.origin === 'https://www.hospibrain.com') return url.origin;
  if (allowInsecureLocalhost && url.protocol === 'http:' && url.hostname === 'localhost' && DEVELOPMENT_PORTS.has(url.port)) return url.origin;
  throw new Error('BRAIN_CLOUD_ORIGIN_NOT_ALLOWED');
}

export function resolvePublicAgentId(storedPublicAgentId?: string): string {
  return storedPublicAgentId && PUBLIC_AGENT_ID.test(storedPublicAgentId)
    ? storedPublicAgentId.toLowerCase()
    : randomUUID();
}

export async function pairAgent(baseUrl: string, pairingCode: string, requestedPublicAgentId?: string) {
  const origin = validateBrainCloudOrigin(baseUrl);
  const url = new URL('/api/agent/pair', origin);
  const prior = await loadState();
  const publicAgentId = resolvePublicAgentId(requestedPublicAgentId ?? prior?.publicAgentId);
  await saveState({ publicAgentId, baseUrl: origin, nvrCredentials: prior?.nvrCredentials });
  const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairingCode, publicAgentId, ...metadata() }) });
  const responseText = await response.text();
  const payload = (() => { try { return JSON.parse(responseText) as Record<string, unknown>; } catch { return null; } })();
  if (!response.ok) {
    const failure = payload?.pairingFailure && typeof payload.pairingFailure === 'object' && !Array.isArray(payload.pairingFailure)
      ? payload.pairingFailure as PairingFailureFlags
      : null;
    const safeCode = typeof payload?.error === 'string' ? payload.error : 'PAIRING_RESPONSE_INVALID';
    const requestId = response.headers.get('x-request-id') ?? (typeof payload?.requestId === 'string' ? payload.requestId : null);
    throw new PairingApiError(response.status, safeCode, requestId, failure, payload ?? { error: 'PAIRING_RESPONSE_NOT_JSON' });
  }
  const data = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data as Record<string, unknown> : null;
  if (typeof data?.credential !== 'string' || typeof data.gatewayId !== 'string' || typeof data.locationId !== 'string') throw new Error('PAIRING_RESPONSE_INVALID');
  await saveState({ publicAgentId, baseUrl: origin, encryptedCredential: protectCredential(data.credential), gatewayId: data.gatewayId, locationId: data.locationId, nvrCredentials: prior?.nvrCredentials });
  return { gatewayId: data.gatewayId, locationId: data.locationId };
}

export async function heartbeat(state: AgentState) {
  if (!state.encryptedCredential || state.needsRepair) throw new Error('REPAIR_REQUIRED');
  const origin = validateBrainCloudOrigin(state.baseUrl);
  const persisted = await loadState();
  const effectiveState = {
    ...state,
    nvrCredentials: persisted?.nvrCredentials ?? state.nvrCredentials,
  };
  const response = await fetch(new URL('/api/agent/heartbeat', origin), { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${unprotectCredential(state.encryptedCredential)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(metadata(effectiveState)) });
  if (response.status === 401) { await saveState({ ...state, encryptedCredential: undefined, needsRepair: true }); throw new Error('REPAIR_REQUIRED'); }
  if (!response.ok) throw new Error('HEARTBEAT_FAILED');
  const payload = await response.json().catch(() => null) as { data?: { gatewayId?: string; locationId?: string; pollingIntervalSeconds?: number } } | null;
  if (!payload?.data?.gatewayId || !payload.data.locationId) throw new Error('HEARTBEAT_FAILED');
  const next = { ...effectiveState, baseUrl: origin, gatewayId: payload.data.gatewayId, locationId: payload.data.locationId, lastHeartbeatAt: new Date().toISOString() };
  await saveState(next); return { state: next, interval: Math.max(30, payload.data.pollingIntervalSeconds ?? 60) };
}

function agentAuthorization(state: AgentState): string {
  if (!state.encryptedCredential || state.needsRepair) throw new Error('REPAIR_REQUIRED');
  return `Bearer ${unprotectCredential(state.encryptedCredential)}`;
}

async function completeCommand(origin: string, authorization: string, completion: AgentCommandCompletion) {
  const response = await fetch(new URL('/api/agent/commands/complete', origin), {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(completion),
  });
  if (response.status === 401) throw new Error('REPAIR_REQUIRED');
  if (!response.ok) throw new Error('COMMAND_COMPLETION_FAILED');
}

async function uploadSnapshot(
  origin: string,
  authorization: string,
  command: { commandId: string; leaseToken: string },
  snapshot: {
    bytes: Uint8Array;
    contentType: 'image/jpeg';
    channelId: string;
    width: number;
    height: number;
  },
): Promise<{ artifactId: string }> {
  const uploadBody = new Uint8Array(snapshot.bytes).buffer;
  const response = await fetch(new URL('/api/agent/commands/snapshot', origin), {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: authorization,
      'Content-Type': snapshot.contentType,
      'Content-Length': String(snapshot.bytes.byteLength),
      'X-Command-Id': command.commandId,
      'X-Lease-Token': command.leaseToken,
      'X-Channel-Id': snapshot.channelId,
      'X-Image-Width': String(snapshot.width),
      'X-Image-Height': String(snapshot.height),
    },
    body: uploadBody,
  });
  if (response.status === 401) throw new Error('REPAIR_REQUIRED');
  if (!response.ok) throw new Error('SNAPSHOT_UPLOAD_FAILED');
  const payload = await response.json().catch(() => null) as { data?: { artifactId?: unknown } } | null;
  const artifactId = payload?.data?.artifactId;
  if (typeof artifactId !== 'string' || !/^[0-9a-f-]{36}$/i.test(artifactId)) throw new Error('SNAPSHOT_UPLOAD_FAILED');
  return { artifactId };
}

export async function pollDeviceCommands(state: AgentState): Promise<number> {
  const origin = validateBrainCloudOrigin(state.baseUrl);
  const authorization = agentAuthorization(state);
  const response = await fetch(new URL('/api/agent/commands/claim', origin), {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 1 }),
  });
  if (response.status === 401) {
    await saveState({ ...state, encryptedCredential: undefined, needsRepair: true });
    throw new Error('REPAIR_REQUIRED');
  }
  if (!response.ok) throw new Error('COMMAND_POLL_FAILED');
  const payload = await response.json().catch(() => null) as { data?: { commands?: unknown; pollingIntervalSeconds?: unknown } } | null;
  const commands = parseClaimedDeviceCommands(payload?.data?.commands);
  if (!commands) throw new Error('COMMAND_POLL_FAILED');
  if (commands.length > 0) {
    const { executeDeviceCommand } = await import('./commands.ts');
    const command = commands[0];
    const credential = command.nvrConnectionId
      && ['nvr_capability_probe', 'nvr_health_diagnostics', 'channel_discovery', 'snapshot_request'].includes(command.commandType)
      ? await loadNvrCredential(command.nvrConnectionId)
      : null;
    const completion = await executeDeviceCommand(command, {
      credential,
      uploadSnapshot: (snapshot) => uploadSnapshot(origin, authorization, command, snapshot),
    });
    try {
      await completeCommand(origin, authorization, completion);
    } catch (error) {
      if (error instanceof Error && error.message === 'REPAIR_REQUIRED') {
        await saveState({ ...state, encryptedCredential: undefined, needsRepair: true });
      }
      throw error;
    }
  }
  const interval = payload?.data?.pollingIntervalSeconds;
  return typeof interval === 'number' && Number.isInteger(interval) && interval >= 2 && interval <= 60 ? interval : 5;
}

export async function startAgent() {
  let state = await loadState();
  if (!state?.encryptedCredential || state.needsRepair) throw new Error('REPAIR_REQUIRED');
  let failures = 0;
  let nextHeartbeatAt = 0;
  let heartbeatIntervalMs = 60_000;
  for (;;) {
    try {
      if (Date.now() >= nextHeartbeatAt) {
        const result = await heartbeat(state);
        state = result.state;
        heartbeatIntervalMs = result.interval * 1000;
        nextHeartbeatAt = Date.now() + heartbeatIntervalMs;
      }
      const pollingIntervalSeconds = await pollDeviceCommands(state);
      failures = 0;
      await new Promise((resolve) => setTimeout(resolve, pollingIntervalSeconds * 1000));
    } catch (error) {
      if (error instanceof Error && error.message === 'REPAIR_REQUIRED') throw error;
      nextHeartbeatAt = Math.min(nextHeartbeatAt, Date.now() + heartbeatIntervalMs);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay(failures++)));
    }
  }
}
export { loadState, clearState };
