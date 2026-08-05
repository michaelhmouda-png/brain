import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  EnvironmentConfigurationError,
  hasEnvironmentIssues,
  inspectServerEnvironment,
  safeEnvironmentDiagnostics,
  validateServerEnvironment,
} from '../lib/environment.server.ts';
import {
  authorizeCronRequest,
  authorizeNamedManualWorkerRequest,
  isWorkerAuthenticationConfigured,
} from '../lib/internal-worker-auth.ts';
import { inspectSupabaseServiceConfiguration } from '../lib/supabase-service-configuration.ts';
import {
  normalizeWorkerHealthPayload,
  rpcFailureDiagnostic,
} from '../lib/worker-health-diagnostics.ts';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const validEnvironment = {
  NODE_ENV: 'production', BRAIN_DEPLOYMENT_ENV: 'preview', VERCEL_ENV: 'preview',
  NEXT_PUBLIC_APP_URL: 'https://preview.example.com', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-placeholder-00000000',
  SUPABASE_SERVICE_ROLE_KEY: 'service-placeholder-0000000000000', CRON_SECRET: 'cron-placeholder-00000000000000000',
  NOTIFICATION_WORKER_SECRET: 'notification-placeholder-0000000000', TASK_EVIDENCE_WORKER_SECRET: 'evidence-placeholder-00000000000000',
  BRAIN_AGENT_TOKEN_PEPPER: 'agent-token-placeholder-0000000000', BRAIN_AGENT_RATE_LIMIT_PEPPER: 'agent-rate-placeholder-00000000000',
  OPENAI_API_KEY: 'provider-placeholder', OPENAI_VISION_MODEL: 'vision-model', NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public-vapid-placeholder',
  VAPID_PRIVATE_KEY: 'private-vapid-placeholder', VAPID_SUBJECT: 'mailto:ops@example.com',
};

test('environment example uses exact runtime names and a project base URL', async () => {
  const env = await read('.env.example');
  assert.match(env, /NEXT_PUBLIC_SUPABASE_URL=https:\/\/project-ref\.supabase\.co\s/);
  assert.match(env, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/);
  assert.doesNotMatch(env, /\/rest\/v1|NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  for (const name of ['BRAIN_DEPLOYMENT_ENV','CRON_SECRET','NOTIFICATION_WORKER_SECRET','TASK_EVIDENCE_WORKER_SECRET']) assert.match(env, new RegExp(`${name}=`));
});

test('server validation returns every safe configuration issue in one pass', async () => {
  const source = await read('lib/environment.server.ts');
  const instrumentation = await read('instrumentation.ts');
  assert.match(instrumentation, /validateServerEnvironment\(\)/);
  assert.match(instrumentation, /error\.toJSON\(\)/);
  assert.match(source, /CONFIGURATION_MISSING_/);
  assert.match(source, /CONFIGURATION_ENVIRONMENT_MISMATCH/);
  assert.match(source, /CONFIGURATION_WORKER_SECRETS_NOT_DISTINCT/);
  assert.match(source, /hostname\.endsWith\('\.supabase\.co'\)/);
  assert.doesNotMatch(source, /console\.(?:log|error|info).*env/);
  const result = inspectServerEnvironment({
    ...validEnvironment,
    NEXT_PUBLIC_APP_URL: 'http://preview.example.com/path',
    NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
    CRON_SECRET: undefined,
    NOTIFICATION_WORKER_SECRET: undefined,
    BRAIN_AGENT_TOKEN_PEPPER: undefined,
  });
  assert.deepEqual(
    result.issues.map((item) => item.variableNames[0]),
    ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'CRON_SECRET', 'NOTIFICATION_WORKER_SECRET', 'BRAIN_AGENT_TOKEN_PEPPER'],
  );
  assert.deepEqual(
    result.issues.map((item) => item.code),
    [
      'CONFIGURATION_INVALID_NEXT_PUBLIC_APP_URL', 'CONFIGURATION_INVALID_NEXT_PUBLIC_SUPABASE_URL',
      'CONFIGURATION_MISSING_CRON_SECRET', 'CONFIGURATION_MISSING_NOTIFICATION_WORKER_SECRET',
      'CONFIGURATION_MISSING_BRAIN_AGENT_TOKEN_PEPPER',
    ],
  );
});

test('feature configuration does not crash startup while core failures aggregate and fail closed', () => {
  const featureResult = validateServerEnvironment({
    ...validEnvironment,
    CRON_SECRET: undefined,
    TASK_EVIDENCE_WORKER_SECRET: undefined,
    BRAIN_AGENT_RATE_LIMIT_PEPPER: undefined,
  });
  assert.equal(featureResult.coreValid, true);
  assert.equal(featureResult.valid, false);
  assert.equal(featureResult.issues.length, 3);

  assert.throws(
    () => validateServerEnvironment({
      ...validEnvironment,
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_SUPABASE_URL: 'ftp://not-valid.example',
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    }),
    (error) => error instanceof EnvironmentConfigurationError
      && error.code === 'CONFIGURATION_CORE_INVALID'
      && error.result.issues.filter((item) => item.area === 'core').length === 3,
  );
});

test('configuration diagnostics contain names and codes but never configured values', () => {
  const invalid = { ...validEnvironment, CRON_SECRET: undefined, VAPID_SUBJECT: 'invalid-subject' };
  const diagnostics = safeEnvironmentDiagnostics(invalid);
  const serialized = JSON.stringify(diagnostics);
  assert.match(serialized, /CRON_SECRET/);
  assert.match(serialized, /CONFIGURATION_INVALID_VAPID_SUBJECT/);
  for (const name of [
    'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'NOTIFICATION_WORKER_SECRET', 'TASK_EVIDENCE_WORKER_SECRET',
    'BRAIN_AGENT_TOKEN_PEPPER', 'BRAIN_AGENT_RATE_LIMIT_PEPPER', 'OPENAI_API_KEY', 'VAPID_PRIVATE_KEY',
  ]) assert.equal(serialized.includes(validEnvironment[name]), false);
  const complete = validateServerEnvironment(validEnvironment);
  assert.equal(complete.deploymentEnvironment, 'preview');
  assert.equal(complete.valid, true);
  assert.deepEqual(complete.issues, []);
  assert.equal(
    inspectServerEnvironment({ ...validEnvironment, VERCEL_ENV: 'production' }).issues
      .some((item) => item.code === 'CONFIGURATION_ENVIRONMENT_MISMATCH'),
    true,
  );
  assert.equal(
    inspectServerEnvironment({
      ...validEnvironment,
      CRON_SECRET: validEnvironment.NOTIFICATION_WORKER_SECRET,
    }).issues.some((item) => item.code === 'CONFIGURATION_WORKER_SECRETS_NOT_DISTINCT'),
    true,
  );
});

test('Vercel schedules cover four independent bounded worker contracts', async () => {
  const config = JSON.parse(await read('vercel.json'));
  const paths = new Map(config.crons.map((item) => [item.path, item.schedule]));
  assert.equal(paths.get('/api/internal/notification-worker'), '* * * * *');
  assert.equal(paths.get('/api/internal/recurring-task-worker'), '*/5 * * * *');
  assert.equal(paths.get('/api/internal/weekly-shift-worker'), '0 * * * *');
  assert.equal(paths.get('/api/internal/task-evidence-worker'), '* * * * *');
  const notification = await read('lib/notification-worker.server.ts');
  assert.match(notification, /processRecurringTaskWork/);
  assert.match(notification, /materializeWeeklyShiftSchedules/);
});

test('cron GET and manual POST use distinct fail-closed bearer boundaries', async () => {
  const auth = await read('lib/internal-worker-auth.ts');
  const response = await read('lib/internal-worker-response.server.ts');
  assert.match(auth, /request\.method === 'GET'.*CRON_SECRET/s);
  assert.match(auth, /request\.method === 'POST'/);
  assert.match(auth, /timingSafeEqual/);
  assert.match(response, /status: 401/);
  assert.match(response, /WORKER_CONFIGURATION_UNAVAILABLE/);
  assert.match(response, /isWorkerAuthenticationConfigured\('CRON_SECRET'\)/);
  assert.match(response, /authorizeNamedManualWorkerRequest\(request, manualSecretName\)/);
  assert.match(response, /safeWorkerFailureCode/);
  assert.doesNotMatch(response, /request\.headers\.get\(['"]user-agent/);
});

test('worker authentication rejects browsers, absent secrets, wrong methods, and shared secrets', () => {
  const env = {
    CRON_SECRET: validEnvironment.CRON_SECRET,
    NOTIFICATION_WORKER_SECRET: validEnvironment.NOTIFICATION_WORKER_SECRET,
    TASK_EVIDENCE_WORKER_SECRET: validEnvironment.TASK_EVIDENCE_WORKER_SECRET,
  };
  const cron = new Request('https://preview.example.com/api/internal/notification-worker', {
    method: 'GET', headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const browser = new Request('https://preview.example.com/api/internal/notification-worker');
  const manual = new Request('https://preview.example.com/api/internal/notification-worker', {
    method: 'POST', headers: { authorization: `Bearer ${env.NOTIFICATION_WORKER_SECRET}` },
  });
  assert.equal(authorizeCronRequest(cron, env), true);
  assert.equal(authorizeCronRequest(browser, env), false);
  assert.equal(authorizeCronRequest(manual, env), false);
  assert.equal(authorizeCronRequest(cron, { ...env, CRON_SECRET: undefined }), false);
  assert.equal(authorizeNamedManualWorkerRequest(manual, 'NOTIFICATION_WORKER_SECRET', env), true);
  assert.equal(authorizeNamedManualWorkerRequest(cron, 'NOTIFICATION_WORKER_SECRET', env), false);
  assert.equal(isWorkerAuthenticationConfigured('CRON_SECRET', {
    ...env, CRON_SECRET: env.NOTIFICATION_WORKER_SECRET,
  }), false);
});

test('every worker independently requires its manual secret and runtime dependencies', async () => {
  const routes = {
    notification: await read('app/api/internal/notification-worker/route.ts'),
    recurring: await read('app/api/internal/recurring-task-worker/route.ts'),
    weekly: await read('app/api/internal/weekly-shift-worker/route.ts'),
    evidence: await read('app/api/internal/task-evidence-worker/route.ts'),
  };
  assert.match(routes.notification, /'NOTIFICATION_WORKER_SECRET'/);
  assert.match(routes.notification, /'VAPID_PRIVATE_KEY'/);
  assert.match(routes.recurring, /'NOTIFICATION_WORKER_SECRET'/);
  assert.match(routes.weekly, /'NOTIFICATION_WORKER_SECRET'/);
  assert.match(routes.evidence, /'TASK_EVIDENCE_WORKER_SECRET'/);
  assert.match(routes.evidence, /'OPENAI_API_KEY'/);
  assert.equal(hasEnvironmentIssues(['CRON_SECRET'], { ...validEnvironment, CRON_SECRET: undefined }), true);
  assert.equal(hasEnvironmentIssues(['CRON_SECRET'], validEnvironment), false);
});

test('worker telemetry is tenant-neutral, service-only, and reports null rather than invented freshness', async () => {
  const migration = await read('supabase/migrations/202608030003_worker_health_v1.sql');
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_system_worker_health_v1\(\) TO service_role/);
  assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE).*system_worker_runs TO service_role/);
  assert.doesNotMatch(migration, /company_id|task_id|payload|secret/i);
  assert.match(migration, /max\(completed_at\)/);
  assert.match(migration, /max\(local_date\)/);
  assert.doesNotMatch(migration, /COALESCE\(\(SELECT max\(completed_at\)/);
});

test('canonical idempotency and lease protections remain on every repeated worker path', async () => {
  const [baseline, recurring, repair, evidence] = await Promise.all([
    read('supabase/migrations/202607240000_current_state_baseline.sql'),
    read('supabase/migrations/202607300001_recurring_task_engine_v1.sql'),
    read('supabase/migrations/202608030002_fix_weekly_shift_correlation_v1.sql'),
    read('lib/task-evidence-verification.server.ts'),
  ]);
  assert.match(baseline, /claim_notification_delivery/);
  assert.match(baseline, /UNIQUE \(notification_id, subscription_id\)/);
  assert.match(recurring, /UNIQUE \(rule_id, rule_version, local_occurrence_at\)/);
  assert.match(repair, /md5\('weekly-shift-v1:'\|\|v_series\.id/);
  assert.match(evidence, /claim_task_evidence_verification_job/);
});

test('health exposes safe diagnostics only after management authorization', async () => {
  const [service, route, page, internal] = await Promise.all([
    read('lib/worker-health.server.ts'), read('app/api/workers/health/route.ts'),
    read('app/dashboard/operations/worker-health/page.tsx'), read('lib/internal-worker-response.server.ts'),
  ]);
  assert.match(service, /manager.*owner.*super_admin/);
  assert.match(service, /safeEnvironmentDiagnostics\(\)/);
  assert.match(route, /resolveActorContext/);
  assert.match(route, /private, no-store/);
  assert.match(route, /UNAUTHENTICATED[\s\S]*401/);
  assert.match(route, /WORKER_HEALTH_FORBIDDEN/);
  assert.match(page, /configuration\?\.issues/);
  assert.match(page, /item\.variableNames\.join/);
  assert.match(page, /telemetryDiagnostic\.postgrestCode/);
  assert.doesNotMatch(`${route}\n${internal}`, /process\.env\.(?:CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY).*NextResponse/s);
});

test('service client classification checks role and project binding without exposing identifiers', () => {
  const secret = inspectSupabaseServiceConfiguration({
    NEXT_PUBLIC_SUPABASE_URL: 'https://project-one.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${'a'.repeat(22)}_${'b'.repeat(8)}`,
  });
  assert.deepEqual(secret, {
    usable: true,
    code: 'SUPABASE_SERVICE_CONFIGURATION_VALID',
    credentialKind: 'secret_key',
    credentialRoleValid: true,
    projectBinding: 'request_required',
  });

  const payload = Buffer.from(JSON.stringify({ role: 'service_role', ref: 'project-two' })).toString('base64url');
  const mismatch = inspectSupabaseServiceConfiguration({
    NEXT_PUBLIC_SUPABASE_URL: 'https://project-one.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: `eyJ.${payload}.signature`,
  });
  assert.equal(mismatch.usable, false);
  assert.equal(mismatch.code, 'SUPABASE_SERVICE_PROJECT_MISMATCH');
  assert.equal(JSON.stringify(mismatch).includes('project-one'), false);
  assert.equal(JSON.stringify(mismatch).includes('project-two'), false);
});

test('worker health normalizes valid PostgREST JSON shapes and rejects malformed responses', () => {
  const payload = { workers: [], queues: {}, materialization: {}, observedAt: '2026-08-05T12:00:00Z' };
  assert.deepEqual(normalizeWorkerHealthPayload(payload), payload);
  assert.deepEqual(normalizeWorkerHealthPayload([payload]), payload);
  assert.deepEqual(normalizeWorkerHealthPayload(JSON.stringify(payload)), payload);
  assert.equal(normalizeWorkerHealthPayload([]), null);
  assert.equal(normalizeWorkerHealthPayload({ workers: [], queues: {} }), null);
});

test('PostgREST diagnostics retain only safe code, status, and stage', () => {
  const configuration = inspectSupabaseServiceConfiguration({
    NEXT_PUBLIC_SUPABASE_URL: 'https://project-one.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${'a'.repeat(22)}_${'b'.repeat(8)}`,
  });
  const diagnostic = rpcFailureDiagnostic({
    data: { tenant: 'must-not-escape' },
    error: { code: 'PGRST202', message: 'raw database message with identifiers' },
    status: 404,
  }, configuration);
  assert.deepEqual(diagnostic, {
    code: 'WORKER_HEALTH_RPC_UNAVAILABLE',
    stage: 'rpc_request',
    postgrestCode: 'PGRST202',
    httpStatus: 404,
    credentialKind: 'secret_key',
    credentialRoleValid: true,
    projectBinding: 'confirmed',
  });
  assert.equal(JSON.stringify(diagnostic).includes('must-not-escape'), false);
  assert.equal(JSON.stringify(diagnostic).includes('raw database message'), false);
});

test('service-role client normalizes validated values and has no browser session lifecycle', async () => {
  const source = await read('lib/supabaseServer.ts');
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY\?\.trim\(\)/);
  assert.match(source, /NEXT_PUBLIC_SUPABASE_URL\?\.trim\(\)/);
  assert.match(source, /autoRefreshToken: false/);
  assert.match(source, /detectSessionInUrl: false/);
  assert.match(source, /db: \{ schema: 'public' \}/);
});

test('CI has no deployment step or production secret dependency', async () => {
  const workflow = await read('.github/workflows/release-gate.yml');
  for (const command of ['npm ci','check:secrets','check:migrations','test:release','test:all','typecheck','lint:changed','npm run build','git diff --check']) assert.match(workflow, new RegExp(command.replaceAll(' ', '\\s+')));
  assert.doesNotMatch(workflow, /vercel deploy|supabase db push|environment:\s*production|secrets\./i);
});

test('build uses system font variables and requires no network font fetch', async () => {
  const [layout, css] = await Promise.all([read('app/layout.tsx'), read('app/globals.css')]);
  assert.doesNotMatch(layout, /next\/font\/google|Geist\(/);
  assert.match(css, /--font-geist-sans: "Segoe UI Variable"/);
  assert.match(css, /--font-geist-mono: "Cascadia Mono"/);
});
