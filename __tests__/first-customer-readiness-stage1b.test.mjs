import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseFirstCustomerPayload } from '../lib/onboarding/contracts.ts';
import { classifyOperationalHealth } from '../lib/operational-health.ts';
import { safeRequestErrorDiagnostic } from '../lib/safe-runtime-observability.ts';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const now = Date.parse('2026-08-06T12:00:00.000Z');
const healthy = {
  workers: ['notifications','recurring_tasks','weekly_shifts','evidence'].map((name) => ({ name, lastSucceededAt:'2026-08-06T11:59:00.000Z', lastFailedAt:null })),
  queues: { notifications:{pending:0,retrying:0,deadLetter:0,oldestPendingAt:null}, deliveries:{pending:0,retrying:0,deadLetter:0,oldestPendingAt:null}, evidence:{pending:0,retrying:0,deadLetter:0,oldestPendingAt:null} },
  materialization: {}, agents:{configured:1,online:1,offline:0}, recurring:{failedLast24Hours:0}, observedAt:'2026-08-06T12:00:00.000Z',
};

test('operational health detects stale workers, queues, offline agents, and recurring failures without details', () => {
  assert.deepEqual(classifyOperationalHealth(healthy, now), { status:'ok', alerts:[], observedAt:healthy.observedAt });
  const degraded = structuredClone(healthy);
  degraded.workers[0].lastSucceededAt = '2026-08-06T11:40:00.000Z';
  degraded.queues.evidence.deadLetter = 2;
  degraded.queues.notifications.oldestPendingAt = '2026-08-06T11:30:00.000Z';
  degraded.agents.offline = 1;
  degraded.recurring.failedLast24Hours = 3;
  const result = classifyOperationalHealth(degraded, now);
  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.alerts.map((item) => item.code), [
    'WORKER_NOTIFICATIONS_STALE','QUEUE_NOTIFICATIONS_STALE','QUEUE_EVIDENCE_DEAD_LETTER','BRAIN_AGENTS_OFFLINE','RECURRING_TASK_FAILURES',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /company|tenant|task_id|payload/i);
  assert.deepEqual(classifyOperationalHealth({ ...healthy, agents: undefined }, now).alerts[0], { code:'OPERATIONAL_AGENT_SIGNAL_UNAVAILABLE',severity:'critical' });
});

test('public uptime and request error diagnostics expose stable safe fields only', async () => {
  const [route,instrumentation,observability] = await Promise.all([read('app/api/health/route.ts'),read('instrumentation.ts'),read('lib/safe-runtime-observability.ts')]);
  assert.match(route, /BRAIN_HEALTHY/);
  assert.match(route, /status: 503/);
  assert.doesNotMatch(route, /workers|queues|agents|recurring|tenant|company/);
  assert.match(instrumentation, /onRequestError/);
  assert.doesNotMatch(observability, /request\.path|headers|message:/);
  assert.deepEqual(safeRequestErrorDiagnostic(new Error('DATABASE_URL=secret'), { method:'GET' }, { routeType:'route',routerKind:'App Router' }), { stage:'request',code:'SERVER_REQUEST_FAILED',method:'GET',routeType:'route',routerKind:'App Router' });
});

test('fifth cron uses the existing protected boundaries and browser requests remain rejected', async () => {
  const config = JSON.parse(await read('vercel.json'));
  assert.equal(config.crons.find((item) => item.path === '/api/internal/operational-health-worker')?.schedule, '*/5 * * * *');
  const route = await read('app/api/internal/operational-health-worker/route.ts');
  assert.match(route, /createWorkerHandlers/);
  assert.match(route, /'NOTIFICATION_WORKER_SECRET'/);
  assert.match(route, /OPERATIONAL_HEALTH_DEGRADED/);
  assert.doesNotMatch(route, /OPENAI/);
});

test('first-customer payload is bounded, normalized, and requires an owner', () => {
  const payload = parseFirstCustomerPayload({ companyName:' Pilot Co ',industry:'hospitality',country:'Lebanon',currency:'USD',timezone:'Asia/Beirut',location:{name:'Venue',type:'restaurant',city:'Beirut',address:''},users:[{email:'OWNER@EXAMPLE.COM',firstName:'A',lastName:'Owner',jobTitle:'Owner',department:'Management',role:'owner',language:'ar'}] });
  assert.equal(payload?.companyName, 'Pilot Co');
  assert.equal(payload?.users[0].email, 'owner@example.com');
  assert.equal(payload?.users[0].language, 'ar');
  assert.equal(parseFirstCustomerPayload({ ...payload, users:[{ ...payload.users[0], role:'employee' }] }), null);
  assert.equal(parseFirstCustomerPayload({ ...payload, users:[payload.users[0],payload.users[0]] }), null);
});

test('provisioning is service-only, idempotent, tenant-atomic, and invitation-bound', async () => {
  const [migration,service,route,form] = await Promise.all([
    read('supabase/migrations/202608060001_first_customer_readiness_stage1b.sql'),read('lib/onboarding/customer-provisioning.server.ts'),read('app/api/onboarding/customers/route.ts'),read('components/CustomerOnboardingForm.tsx'),
  ]);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /UNIQUE \(requested_by_profile_id, idempotency_key\)/);
  assert.match(migration, /auth\.role\(\).*service_role/s);
  assert.match(migration, /role='super_admin'/);
  assert.match(migration, /record_first_customer_invitation_v1/);
  assert.match(migration, /auth\.users u WHERE u\.id=p_auth_user_id AND lower\(u\.email\)=v_email/);
  assert.match(migration, /INSERT INTO public\.companies[\s\S]*INSERT INTO public\.locations[\s\S]*INSERT INTO public\.employees[\s\S]*INSERT INTO public\.profiles/);
  assert.doesNotMatch(migration, /GRANT EXECUTE[\s\S]* TO authenticated/);
  assert.match(service, /inviteUserByEmail/);
  assert.match(service, /record_first_customer_invitation_v1/);
  assert.match(service, /ONBOARDING_PERSISTENCE_NOT_VERIFIED/);
  assert.match(route, /resolveActorContext/);
  assert.match(route, /body\?\.confirmed !== true/);
  assert.match(form, /crypto\.randomUUID/);
  assert.match(form, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(form, /sessionStorage/);
  assert.match(form, /العربية|تجهيز العميل الأول/);
  assert.match(form, /sm:grid-cols|lg:grid-cols/);
});

test('new migration extends health with aggregate agents and failures but no tenant identifiers', async () => {
  const migration = await read('supabase/migrations/202608060001_first_customer_readiness_stage1b.sql');
  const healthSection = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.get_system_worker_health_v1'));
  assert.match(healthSection, /'agents'/);
  assert.match(healthSection, /'failedLast24Hours'/);
  assert.doesNotMatch(healthSection, /company_id|location_id|task_id|employee_id|canonical_payload/);
  const manifest = JSON.parse(await read('supabase/applied-migration-sha256.json'));
  assert.equal(manifest['202608030003_worker_health_v1.sql'], '218fb82f139e05a0d0b98067f1962b606487f6ba7e082fb12f578d0e22aceb37');
  assert.equal(manifest['202608060001_first_customer_readiness_stage1b.sql'], undefined);
});

test('backup workflow is manual, guarded, disposable-target only, and never uploads the dump', async () => {
  const [workflow,guard,verify,runner] = await Promise.all([read('.github/workflows/backup-restore-verification.yml'),read('scripts/verify-backup-boundary.mjs'),read('scripts/verify-restored-database.mjs'),read('scripts/run-backup-restore.mjs')]);
  assert.match(workflow, /workflow_dispatch/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /environment: backup-restore-verification/);
  assert.match(workflow, /run-backup-restore\.mjs restore/);
  assert.doesNotMatch(workflow, /upload-artifact|supabase db push/);
  assert.match(guard, /RESTORE_TARGET_MUST_BE_SEPARATE/);
  assert.match(guard, /RESTORE_TARGET_NOT_MARKED_DISPOSABLE/);
  assert.doesNotMatch(guard, /console\.log\([^)]*(?:URL|url|Ref|ref)/);
  assert.match(verify, /RESTORE_CATALOG_INCOMPLETE/);
  assert.match(runner, /'--clean','--if-exists'/);
  assert.doesNotMatch(runner, /spawnSync\([^\n]+DATABASE_URL/);
  assert.doesNotMatch(verify, /spawnSync\('psql', \[target/);
});

test('Windows package provides reboot startup, recovery, protected identity, status, update, and rollback', async () => {
  const [install,supervisor,status,update,runbook] = await Promise.all([
    read('agent/windows/Install-BrainAgent.ps1'),read('agent/windows/BrainAgentSupervisor.ps1'),read('agent/windows/Get-BrainAgentStatus.ps1'),read('agent/windows/Update-BrainAgent.ps1'),read('BRAIN_AGENT_WINDOWS_RUNBOOK.md'),
  ]);
  assert.match(install, /New-ScheduledTaskTrigger -AtStartup/);
  assert.match(install, /RestartCount 999/);
  assert.match(install, /PSCredential/);
  assert.match(install, /icacls\.exe/);
  assert.match(supervisor, /while \(\$true\)/);
  assert.match(supervisor, /Start-Sleep/);
  assert.doesNotMatch(status, /credential|password|token|gatewayId|locationId/i);
  assert.match(update, /FixedTimeEquals/);
  assert.match(update, /AGENT_UPDATE_ROLLED_BACK/);
  assert.match(update, /ParameterSetName='Rollback'/);
  assert.match(runbook, /DPAPI/);
});

test('external uptime workflow is independent, bounded, and carries no secrets', async () => {
  const workflow = await read('.github/workflows/external-uptime.yml');
  assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/);
  assert.match(workflow, /timeout-minutes: 3/);
  assert.match(workflow, /scripts\/check-external-health\.mjs/);
  assert.doesNotMatch(workflow, /secrets\.|authorization|token/i);
});

test('changed-file lint is cross-platform and includes unstaged and untracked source', async () => {
  const lint = await read('scripts/lint-changed.mjs');
  assert.match(lint, /ls-files.*--others.*--exclude-standard/s);
  assert.match(lint, /diff.*HEAD/s);
  assert.match(lint, /node_modules.*eslint.*bin.*eslint\.js/s);
  assert.doesNotMatch(lint, /npx\.cmd/);
});

test('launch checklist covers complete customer workflows and approval gates', async () => {
  const checklist = await read('FIRST_CUSTOMER_LAUNCH_CHECKLIST.md');
  for (const item of ['Tenant isolation','Provisioning','Workers','Backups','Agent','Tasks/routines','Shifts','Evidence','Inventory','Reservations','PWA/mobile/RTL','Production migration','Paid service']) assert.match(checklist, new RegExp(item.replace('/','\\/'),'i'));
});
