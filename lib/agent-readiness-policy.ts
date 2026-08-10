export type AgentReadinessPolicy = 'deferred' | 'required';

export function resolveAgentReadinessPolicy(
  value: string | undefined = process.env.BRAIN_AGENT_READINESS,
): AgentReadinessPolicy {
  return value?.trim() === 'required' ? 'required' : 'deferred';
}

export function applyAgentReadinessPolicy(
  payload: Record<string, unknown>,
  policy: AgentReadinessPolicy,
): Record<string, unknown> {
  const raw = payload.agents;
  const agents = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  return { ...payload, agents: { ...agents, readiness: policy, required: policy === 'required' } };
}
