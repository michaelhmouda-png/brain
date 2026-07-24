import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { clearState, loadState, protectCredential, saveState, unprotectCredential, type AgentState } from './storage.ts';

export const AGENT_VERSION = '0.1.0';
export const CAPABILITIES = ['brain.heartbeat.v1'] as const;
const DEVELOPMENT_PORTS = new Set(['3000', '3100']);

export function backoffDelay(attempt: number, random = Math.random) { const base = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6)); return Math.round(base * (0.75 + random() * 0.5)); }
const metadata = () => ({ agentVersion: AGENT_VERSION, platform: process.platform, osVersion: os.release(), hostnameLabel: os.hostname().slice(0, 63).replace(/[^A-Za-z0-9._-]/g, '-'), declaredCapabilities: [...CAPABILITIES] });

export function validateBrainCloudOrigin(value: string, allowInsecureLocalhost = process.env.BRAIN_AGENT_ALLOW_INSECURE_LOCALHOST === 'true'): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('BRAIN_CLOUD_ORIGIN_NOT_ALLOWED'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('BRAIN_CLOUD_ORIGIN_NOT_ALLOWED');
  if (url.protocol === 'https:' && url.hostname === 'www.hospibrain.com' && url.port === '' && url.origin === 'https://www.hospibrain.com') return url.origin;
  if (allowInsecureLocalhost && url.protocol === 'http:' && url.hostname === 'localhost' && DEVELOPMENT_PORTS.has(url.port)) return url.origin;
  throw new Error('BRAIN_CLOUD_ORIGIN_NOT_ALLOWED');
}

export async function pairAgent(baseUrl: string, pairingCode: string, requestedPublicAgentId?: string) {
  const origin = validateBrainCloudOrigin(baseUrl);
  const url = new URL('/api/agent/pair', origin);
  const prior = await loadState(); const publicAgentId = requestedPublicAgentId ?? prior?.publicAgentId ?? randomUUID();
  await saveState({ publicAgentId, baseUrl: origin });
  const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairingCode, publicAgentId, ...metadata() }) });
  const payload = await response.json().catch(() => null) as { data?: { credential?: string; gatewayId?: string; locationId?: string } } | null;
  if (!response.ok || !payload?.data?.credential || !payload.data.gatewayId || !payload.data.locationId) throw new Error('PAIRING_FAILED');
  await saveState({ publicAgentId, baseUrl: origin, encryptedCredential: protectCredential(payload.data.credential), gatewayId: payload.data.gatewayId, locationId: payload.data.locationId });
  return { gatewayId: payload.data.gatewayId, locationId: payload.data.locationId };
}

export async function heartbeat(state: AgentState) {
  if (!state.encryptedCredential || state.needsRepair) throw new Error('REPAIR_REQUIRED');
  const origin = validateBrainCloudOrigin(state.baseUrl);
  const response = await fetch(new URL('/api/agent/heartbeat', origin), { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${unprotectCredential(state.encryptedCredential)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(metadata()) });
  if (response.status === 401) { await saveState({ ...state, encryptedCredential: undefined, needsRepair: true }); throw new Error('REPAIR_REQUIRED'); }
  if (!response.ok) throw new Error('HEARTBEAT_FAILED');
  const payload = await response.json().catch(() => null) as { data?: { gatewayId?: string; locationId?: string; pollingIntervalSeconds?: number } } | null;
  if (!payload?.data?.gatewayId || !payload.data.locationId) throw new Error('HEARTBEAT_FAILED');
  const next = { ...state, baseUrl: origin, gatewayId: payload.data.gatewayId, locationId: payload.data.locationId, lastHeartbeatAt: new Date().toISOString() };
  await saveState(next); return { state: next, interval: Math.max(30, payload.data.pollingIntervalSeconds ?? 60) };
}

export async function startAgent() { let state = await loadState(); if (!state?.encryptedCredential || state.needsRepair) throw new Error('REPAIR_REQUIRED'); let failures = 0; for (;;) { try { const result = await heartbeat(state); state = result.state; failures = 0; await new Promise(r => setTimeout(r, result.interval * 1000)); } catch (error) { if (error instanceof Error && error.message === 'REPAIR_REQUIRED') throw error; await new Promise(r => setTimeout(r, backoffDelay(failures++))); } } }
export { loadState, clearState };
