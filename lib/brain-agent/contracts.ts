export const BRAIN_AGENT_CAPABILITY = 'brain.heartbeat.v1' as const;
export type AgentContext = { publicAgentId: string; gatewayId: string; companyId: string; locationId: string; approvedCapabilities: Array<{ code: string; version: number }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const CAPABILITY = /^[a-z][a-z0-9_.-]{2,79}$/;

type AgentMetadata = {
  publicAgentId?: string;
  agentVersion: string;
  platform: string;
  osVersion: string | null;
  hostnameLabel: string | null;
  declaredCapabilities: string[];
  credentialedNvrIds: string[];
};

export function parseAgentMetadata(value: unknown, requirePublicId: boolean): AgentMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const publicAgentId = typeof body.publicAgentId === 'string' && UUID.test(body.publicAgentId) ? body.publicAgentId : undefined;
  const text = (candidate: unknown, max: number) => typeof candidate === 'string' && candidate.trim().length > 0 && candidate.trim().length <= max ? candidate.trim() : null;
  const agentVersion = text(body.agentVersion, 80);
  const platform = text(body.platform, 40);
  const osVersion = body.osVersion == null || body.osVersion === '' ? null : text(body.osVersion, 80);
  const hostnameLabel = body.hostnameLabel == null || body.hostnameLabel === '' ? null : typeof body.hostnameLabel === 'string' && LABEL.test(body.hostnameLabel) ? body.hostnameLabel : undefined;
  const declared = Array.isArray(body.declaredCapabilities) && body.declaredCapabilities.length <= 16 && body.declaredCapabilities.every((item) => typeof item === 'string' && CAPABILITY.test(item))
    ? [...new Set(body.declaredCapabilities as string[])] : null;
  const credentialedNvrIds = body.credentialedNvrIds === undefined
    ? []
    : Array.isArray(body.credentialedNvrIds)
      && body.credentialedNvrIds.length <= 256
      && body.credentialedNvrIds.every((item) => typeof item === 'string' && UUID.test(item))
      ? [...new Set(body.credentialedNvrIds as string[])].map((item) => item.toLowerCase()).sort()
      : null;
  if ((requirePublicId && !publicAgentId) || !agentVersion || !platform || osVersion === undefined || hostnameLabel === undefined || !declared || !credentialedNvrIds) return null;
  return { publicAgentId, agentVersion, platform, osVersion, hostnameLabel, declaredCapabilities: declared, credentialedNvrIds };
}

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
