export type DeploymentEnvironment = 'development' | 'test' | 'preview' | 'production';

export class EnvironmentConfigurationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'EnvironmentConfigurationError';
  }
}

const secretNames = [
  'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'NOTIFICATION_WORKER_SECRET',
  'TASK_EVIDENCE_WORKER_SECRET', 'BRAIN_AGENT_TOKEN_PEPPER',
  'BRAIN_AGENT_RATE_LIMIT_PEPPER',
] as const;

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) throw new EnvironmentConfigurationError(`CONFIGURATION_MISSING_${name}`);
  return value;
}

function httpsUrl(name: string, env: NodeJS.ProcessEnv): URL {
  let parsed: URL;
  try { parsed = new URL(required(name, env)); } catch {
    throw new EnvironmentConfigurationError(`CONFIGURATION_INVALID_${name}`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new EnvironmentConfigurationError(`CONFIGURATION_INVALID_${name}`);
  }
  return parsed;
}

export function deploymentEnvironment(env: NodeJS.ProcessEnv = process.env): DeploymentEnvironment {
  if (env.NODE_ENV === 'test') return 'test';
  if (env.NODE_ENV !== 'production') return 'development';
  const value = required('BRAIN_DEPLOYMENT_ENV', env);
  if (value !== 'preview' && value !== 'production') {
    throw new EnvironmentConfigurationError('CONFIGURATION_INVALID_BRAIN_DEPLOYMENT_ENV');
  }
  if (env.VERCEL_ENV && env.VERCEL_ENV !== value) {
    throw new EnvironmentConfigurationError('CONFIGURATION_ENVIRONMENT_MISMATCH');
  }
  return value;
}

/** Validates names and shapes only and never returns or logs secret values. */
export function validateServerEnvironment(env: NodeJS.ProcessEnv = process.env): DeploymentEnvironment {
  const target = deploymentEnvironment(env);
  if (target === 'development' || target === 'test') return target;

  const app = httpsUrl('NEXT_PUBLIC_APP_URL', env);
  const supabase = httpsUrl('NEXT_PUBLIC_SUPABASE_URL', env);
  if (app.pathname !== '/' || supabase.pathname !== '/' || !supabase.hostname.endsWith('.supabase.co')) {
    throw new EnvironmentConfigurationError('CONFIGURATION_INVALID_PUBLIC_URL');
  }
  if (required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', env).length < 20) {
    throw new EnvironmentConfigurationError('CONFIGURATION_INVALID_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  }
  for (const name of secretNames) {
    if (required(name, env).length < 32) throw new EnvironmentConfigurationError(`CONFIGURATION_INVALID_${name}`);
  }
  const uniqueWorkerSecrets = new Set([
    env.CRON_SECRET, env.NOTIFICATION_WORKER_SECRET, env.TASK_EVIDENCE_WORKER_SECRET,
  ]);
  if (uniqueWorkerSecrets.size !== 3) throw new EnvironmentConfigurationError('CONFIGURATION_WORKER_SECRETS_NOT_DISTINCT');
  required('OPENAI_API_KEY', env);
  required('OPENAI_VISION_MODEL', env);
  required('NEXT_PUBLIC_VAPID_PUBLIC_KEY', env);
  required('VAPID_PRIVATE_KEY', env);
  const subject = required('VAPID_SUBJECT', env);
  if (!/^(mailto:|https:)/.test(subject)) throw new EnvironmentConfigurationError('CONFIGURATION_INVALID_VAPID_SUBJECT');
  return target;
}
