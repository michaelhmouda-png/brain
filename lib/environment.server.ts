export type DeploymentEnvironment = 'development' | 'test' | 'preview' | 'production' | 'unknown';

export type EnvironmentArea = 'core' | 'scheduler' | 'notifications' | 'evidence' | 'brain_agent';

export type EnvironmentConfigurationIssue = {
  code: string;
  variableNames: string[];
  area: EnvironmentArea;
};

export type EnvironmentValidationResult = {
  deploymentEnvironment: DeploymentEnvironment;
  valid: boolean;
  coreValid: boolean;
  issues: EnvironmentConfigurationIssue[];
};

export class EnvironmentConfigurationError extends Error {
  readonly code = 'CONFIGURATION_CORE_INVALID';
  readonly result: EnvironmentValidationResult;

  constructor(result: EnvironmentValidationResult) {
    super('CONFIGURATION_CORE_INVALID');
    this.result = result;
    this.name = 'EnvironmentConfigurationError';
  }

  toJSON() {
    return { code: this.code, ...this.result };
  }
}

type EnvironmentRule = {
  name: string;
  area: EnvironmentArea;
  validate?: (value: string) => boolean;
};

const secretShape = (value: string) => value.length >= 32;
const nonEmpty = (value: string) => value.length > 0;

function validHttpsBaseUrl(value: string, supabase = false): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      && (!supabase || parsed.hostname.endsWith('.supabase.co'));
  } catch {
    return false;
  }
}

const productionRules: EnvironmentRule[] = [
  { name: 'NEXT_PUBLIC_APP_URL', area: 'core', validate: (value) => validHttpsBaseUrl(value) },
  { name: 'NEXT_PUBLIC_SUPABASE_URL', area: 'core', validate: (value) => validHttpsBaseUrl(value, true) },
  { name: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', area: 'core', validate: (value) => value.length >= 20 },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', area: 'core', validate: secretShape },
  { name: 'CRON_SECRET', area: 'scheduler', validate: secretShape },
  { name: 'NOTIFICATION_WORKER_SECRET', area: 'notifications', validate: secretShape },
  { name: 'TASK_EVIDENCE_WORKER_SECRET', area: 'evidence', validate: secretShape },
  { name: 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', area: 'notifications', validate: nonEmpty },
  { name: 'VAPID_PRIVATE_KEY', area: 'notifications', validate: nonEmpty },
  { name: 'VAPID_SUBJECT', area: 'notifications', validate: (value) => /^(mailto:|https:)/.test(value) },
  { name: 'OPENAI_API_KEY', area: 'evidence', validate: nonEmpty },
  { name: 'OPENAI_VISION_MODEL', area: 'evidence', validate: nonEmpty },
  { name: 'BRAIN_AGENT_TOKEN_PEPPER', area: 'brain_agent', validate: secretShape },
  { name: 'BRAIN_AGENT_RATE_LIMIT_PEPPER', area: 'brain_agent', validate: secretShape },
];

function issue(code: string, variableNames: string[], area: EnvironmentArea): EnvironmentConfigurationIssue {
  return { code, variableNames, area };
}

/**
 * Inspects the complete deployed runtime contract in one pass. The returned
 * structure contains variable names and stable codes only, never values.
 */
export function inspectServerEnvironment(env: NodeJS.ProcessEnv = process.env): EnvironmentValidationResult {
  if (env.NODE_ENV === 'test') {
    return { deploymentEnvironment: 'test', valid: true, coreValid: true, issues: [] };
  }
  if (env.NODE_ENV !== 'production') {
    return { deploymentEnvironment: 'development', valid: true, coreValid: true, issues: [] };
  }

  const issues: EnvironmentConfigurationIssue[] = [];
  const deploymentValue = env.BRAIN_DEPLOYMENT_ENV?.trim();
  let deploymentEnvironment: DeploymentEnvironment = 'unknown';
  if (!deploymentValue) {
    issues.push(issue('CONFIGURATION_MISSING_BRAIN_DEPLOYMENT_ENV', ['BRAIN_DEPLOYMENT_ENV'], 'core'));
  } else if (deploymentValue === 'preview' || deploymentValue === 'production') {
    deploymentEnvironment = deploymentValue;
  } else {
    issues.push(issue('CONFIGURATION_INVALID_BRAIN_DEPLOYMENT_ENV', ['BRAIN_DEPLOYMENT_ENV'], 'core'));
  }

  const vercelEnvironment = env.VERCEL_ENV?.trim();
  if (vercelEnvironment && deploymentEnvironment !== 'unknown' && vercelEnvironment !== deploymentEnvironment) {
    issues.push(issue(
      'CONFIGURATION_ENVIRONMENT_MISMATCH',
      ['BRAIN_DEPLOYMENT_ENV', 'VERCEL_ENV'],
      'core',
    ));
  }

  for (const rule of productionRules) {
    const value = env[rule.name]?.trim();
    if (!value) {
      issues.push(issue(`CONFIGURATION_MISSING_${rule.name}`, [rule.name], rule.area));
    } else if (rule.validate && !rule.validate(value)) {
      issues.push(issue(`CONFIGURATION_INVALID_${rule.name}`, [rule.name], rule.area));
    }
  }

  const workerSecretNames = ['CRON_SECRET', 'NOTIFICATION_WORKER_SECRET', 'TASK_EVIDENCE_WORKER_SECRET'];
  const workerSecrets = workerSecretNames.map((name) => env[name]?.trim()).filter((value): value is string => Boolean(value));
  if (workerSecrets.length === workerSecretNames.length && new Set(workerSecrets).size !== workerSecretNames.length) {
    issues.push(issue('CONFIGURATION_WORKER_SECRETS_NOT_DISTINCT', workerSecretNames, 'scheduler'));
  }

  return {
    deploymentEnvironment,
    valid: issues.length === 0,
    coreValid: !issues.some((item) => item.area === 'core'),
    issues,
  };
}

/** Core failures stop boot; feature-specific failures remain visible to health diagnostics. */
export function validateServerEnvironment(env: NodeJS.ProcessEnv = process.env): EnvironmentValidationResult {
  const result = inspectServerEnvironment(env);
  if (!result.coreValid) throw new EnvironmentConfigurationError(result);
  return result;
}

export function safeEnvironmentDiagnostics(env: NodeJS.ProcessEnv = process.env) {
  const result = inspectServerEnvironment(env);
  return {
    deploymentEnvironment: result.deploymentEnvironment,
    valid: result.valid,
    coreValid: result.coreValid,
    issues: result.issues.map(({ code, variableNames, area }) => ({ code, variableNames: [...variableNames], area })),
  };
}

export function hasEnvironmentIssues(
  variableNames: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const selected = new Set(variableNames);
  const selectedRules = productionRules.filter((rule) => selected.has(rule.name));
  if (selectedRules.some((rule) => {
    const value = env[rule.name]?.trim();
    return !value || Boolean(rule.validate && !rule.validate(value));
  })) return true;

  const selectedWorkerSecrets = ['CRON_SECRET', 'NOTIFICATION_WORKER_SECRET', 'TASK_EVIDENCE_WORKER_SECRET']
    .filter((name) => selected.has(name));
  return selectedWorkerSecrets.some((name) => {
    const value = env[name]?.trim();
    return Boolean(value && ['CRON_SECRET', 'NOTIFICATION_WORKER_SECRET', 'TASK_EVIDENCE_WORKER_SECRET']
      .some((other) => other !== name && env[other]?.trim() === value));
  });
}
