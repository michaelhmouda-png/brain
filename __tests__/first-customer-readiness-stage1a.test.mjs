import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateServerEnvironment } from '../lib/environment.server.ts';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('environment example uses exact runtime names and a project base URL', async () => {
  const env = await read('.env.example');
  assert.match(env, /NEXT_PUBLIC_SUPABASE_URL=https:\/\/project-ref\.supabase\.co\s/);
  assert.match(env, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/);
  assert.doesNotMatch(env, /\/rest\/v1|NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  for (const name of ['BRAIN_DEPLOYMENT_ENV','CRON_SECRET','NOTIFICATION_WORKER_SECRET','TASK_EVIDENCE_WORKER_SECRET']) assert.match(env, new RegExp(`${name}=`));
});

test('server startup fails closed on missing, malformed, shared, or cross-environment configuration', async () => {
  const source = await read('lib/environment.server.ts');
  const instrumentation = await read('instrumentation.ts');
  assert.match(instrumentation, /validateServerEnvironment\(\)/);
  assert.match(source, /CONFIGURATION_MISSING_/);
  assert.match(source, /CONFIGURATION_ENVIRONMENT_MISMATCH/);
  assert.match(source, /CONFIGURATION_WORKER_SECRETS_NOT_DISTINCT/);
  assert.match(source, /supabase\.hostname\.endsWith\('\.supabase\.co'\)/);
  assert.doesNotMatch(source, /console\.(?:log|error|info).*env/);
  const valid = {
    NODE_ENV: 'production', BRAIN_DEPLOYMENT_ENV: 'preview', VERCEL_ENV: 'preview',
    NEXT_PUBLIC_APP_URL: 'https://preview.example.com', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-placeholder-00000000',
    SUPABASE_SERVICE_ROLE_KEY: 'service-placeholder-0000000000000', CRON_SECRET: 'cron-placeholder-00000000000000000',
    NOTIFICATION_WORKER_SECRET: 'notification-placeholder-0000000000', TASK_EVIDENCE_WORKER_SECRET: 'evidence-placeholder-00000000000000',
    BRAIN_AGENT_TOKEN_PEPPER: 'agent-token-placeholder-0000000000', BRAIN_AGENT_RATE_LIMIT_PEPPER: 'agent-rate-placeholder-00000000000',
    OPENAI_API_KEY: 'provider-placeholder', OPENAI_VISION_MODEL: 'vision-model', NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public-vapid-placeholder',
    VAPID_PRIVATE_KEY: 'private-vapid-placeholder', VAPID_SUBJECT: 'mailto:ops@example.com',
  };
  assert.equal(validateServerEnvironment(valid), 'preview');
  assert.throws(() => validateServerEnvironment({ ...valid, CRON_SECRET: undefined }), /CONFIGURATION_MISSING_CRON_SECRET/);
  assert.throws(() => validateServerEnvironment({ ...valid, VERCEL_ENV: 'production' }), /CONFIGURATION_ENVIRONMENT_MISMATCH/);
  assert.throws(() => validateServerEnvironment({ ...valid, CRON_SECRET: valid.NOTIFICATION_WORKER_SECRET }), /CONFIGURATION_WORKER_SECRETS_NOT_DISTINCT/);
  try { validateServerEnvironment({ ...valid, CRON_SECRET: undefined }); } catch (error) { assert.doesNotMatch(error.message, /placeholder/); }
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
  const auth = await read('lib/internal-worker-auth.server.ts');
  const response = await read('lib/internal-worker-response.server.ts');
  assert.match(auth, /request\.method === 'GET'.*CRON_SECRET/s);
  assert.match(auth, /request\.method === 'POST'/);
  assert.match(auth, /timingSafeEqual/);
  assert.match(response, /status: 401/);
  assert.match(response, /safeWorkerFailureCode/);
  assert.doesNotMatch(response, /request\.headers\.get\(['"]user-agent/);
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

test('health is management-only and responses/logs contain no configured secret values', async () => {
  const [service, route, internal] = await Promise.all([
    read('lib/worker-health.server.ts'), read('app/api/workers/health/route.ts'), read('lib/internal-worker-response.server.ts'),
  ]);
  assert.match(service, /manager.*owner.*super_admin/);
  assert.match(route, /resolveActorContext/);
  assert.match(route, /private, no-store/);
  assert.doesNotMatch(`${route}\n${internal}`, /process\.env\.(?:CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY).*NextResponse/s);
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
