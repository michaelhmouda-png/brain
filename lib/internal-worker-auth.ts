import { timingSafeEqual } from 'node:crypto';

export type ManualWorkerSecretName = 'NOTIFICATION_WORKER_SECRET' | 'TASK_EVIDENCE_WORKER_SECRET';

function bearer(request: Request): string {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
}

function matches(candidate: string, expected: string | undefined): boolean {
  if (!expected || !candidate || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

function configuredSecret(name: 'CRON_SECRET' | ManualWorkerSecretName, env: NodeJS.ProcessEnv): string | null {
  const value = env[name]?.trim();
  if (!value || value.length < 32) return null;
  const otherNames = ['CRON_SECRET', 'NOTIFICATION_WORKER_SECRET', 'TASK_EVIDENCE_WORKER_SECRET']
    .filter((candidate) => candidate !== name);
  if (otherNames.some((candidate) => env[candidate]?.trim() === value)) return null;
  return value;
}

export function isWorkerAuthenticationConfigured(
  name: 'CRON_SECRET' | ManualWorkerSecretName,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return configuredSecret(name, env) !== null;
}

export function authorizeCronRequest(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  return request.method === 'GET' && matches(bearer(request), configuredSecret('CRON_SECRET', env) ?? undefined);
}

export function authorizeNamedManualWorkerRequest(
  request: Request,
  name: ManualWorkerSecretName,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return request.method === 'POST' && matches(bearer(request), configuredSecret(name, env) ?? undefined);
}
