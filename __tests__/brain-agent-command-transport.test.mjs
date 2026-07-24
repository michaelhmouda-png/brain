import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  DEVICE_COMMAND_TYPES,
  parseAgentCommandCompletion,
  parseClaimedDeviceCommands,
  parseDeviceCommandEnqueue,
  validDeviceCommandResult,
} from '../lib/brain-agent/command-contracts.ts';
import { executeDeviceCommand, isPrivateNvrAddress } from '../agent/src/commands.ts';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/202607240001_device_agent_command_transport.sql');
const managementRoute = read('app/api/devices/commands/route.ts');
const claimRoute = read('app/api/agent/commands/claim/route.ts');
const completeRoute = read('app/api/agent/commands/complete/route.ts');
const transportService = read('lib/brain-agent/command-transport.server.ts');
const runtime = read('agent/src/runtime.ts');
const executor = read('agent/src/commands.ts');
const id = () => crypto.randomUUID();

function command(overrides = {}) {
  return {
    commandId: id(),
    commandType: 'agent_health',
    nvrConnectionId: null,
    request: {},
    target: null,
    leaseToken: id(),
    leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    attemptNumber: 1,
    commandExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

test('only the five approved read-only command types exist', () => {
  assert.deepEqual(DEVICE_COMMAND_TYPES, [
    'agent_health',
    'network_reachability',
    'nvr_capability_probe',
    'channel_discovery',
    'snapshot_request',
  ]);
  for (const forbidden of ['ptz', 'configure', 'delete', 'reboot', 'firmware_update', 'credential_retrieval', 'remote_shell']) {
    assert.doesNotMatch(migration, new RegExp(`'${forbidden}'`, 'i'));
  }
});

test('enqueue contracts are bounded, target-shaped, and discard client authority', () => {
  const gatewayId = id();
  const nvrConnectionId = id();
  const idempotencyKey = id();
  const parsed = parseDeviceCommandEnqueue({
    gatewayId,
    nvrConnectionId,
    idempotencyKey,
    commandType: 'network_reachability',
    request: { portKind: 'rtsp', timeoutMs: 2_000 },
    ttlSeconds: 120,
    companyId: id(),
    locationId: id(),
    credential: 'not-authority',
  });
  assert.deepEqual(parsed, {
    gatewayId,
    nvrConnectionId,
    idempotencyKey,
    commandType: 'network_reachability',
    request: { portKind: 'rtsp', timeoutMs: 2_000 },
    ttlSeconds: 120,
  });
  assert.equal(parseDeviceCommandEnqueue({ gatewayId, nvrConnectionId: null, idempotencyKey, commandType: 'network_reachability', request: { portKind: 'rtsp', timeoutMs: 2_000 } }), null);
  assert.equal(parseDeviceCommandEnqueue({ gatewayId, nvrConnectionId, idempotencyKey, commandType: 'agent_health', request: {} }), null);
  assert.equal(parseDeviceCommandEnqueue({ gatewayId, nvrConnectionId, idempotencyKey, commandType: 'network_reachability', request: { portKind: 'rtsp', timeoutMs: 60_000 } }), null);
});

test('completion results use exact allowlists and reject credential-bearing fields', () => {
  assert.equal(validDeviceCommandResult('agent_health', { agentVersion: '0.1.0', platform: 'win32', uptimeSeconds: 12 }), true);
  assert.equal(validDeviceCommandResult('agent_health', { agentVersion: '0.1.0', platform: 'win32', uptimeSeconds: 12, token: 'secret' }), false);
  assert.equal(validDeviceCommandResult('network_reachability', { reachable: true, portKind: 'rtsp', latencyMs: 5 }), true);
  assert.equal(validDeviceCommandResult('network_reachability', { reachable: true, portKind: 'rtsp', latencyMs: 5, localHost: '192.168.1.2' }), false);
  assert.equal(parseAgentCommandCompletion({
    commandId: id(), commandType: 'snapshot_request', leaseToken: id(), outcome: 'succeeded',
    result: { artifactId: id(), contentType: 'image/jpeg', capturedAt: new Date().toISOString(), password: 'x' },
    errorCode: null, retryable: false,
  }), null);
});

test('claimed command parsing accepts target metadata only for NVR operations', () => {
  const health = command();
  assert.equal(parseClaimedDeviceCommands([health])?.length, 1);
  const reachability = command({
    commandType: 'network_reachability',
    nvrConnectionId: id(),
    request: { portKind: 'http', timeoutMs: 1_000 },
    target: { vendor: 'Dahua', localHost: '192.168.1.10', httpPort: 80, rtspPort: 554, onvifPort: null },
  });
  assert.equal(parseClaimedDeviceCommands([reachability])?.length, 1);
  assert.equal(parseClaimedDeviceCommands([{ ...reachability, target: { ...reachability.target, password: 'x' } }]), null);
});

test('the local reachability boundary permits only RFC1918 IPv4 and IPv6 ULA addresses', () => {
  for (const address of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.20', 'fd00::10', 'fc00::1']) {
    assert.equal(isPrivateNvrAddress(address), true, address);
  }
  for (const address of ['127.0.0.1', '169.254.1.1', '172.32.0.1', '8.8.8.8', '::1', 'fe80::1', '2001:4860:4860::8888']) {
    assert.equal(isPrivateNvrAddress(address), false, address);
  }
});

test('agent health executes locally while adapter-backed commands stop safely before Dahua', async () => {
  const health = await executeDeviceCommand(command());
  assert.equal(health.outcome, 'succeeded');
  assert.deepEqual(Object.keys(health.result).sort(), ['agentVersion', 'platform', 'uptimeSeconds']);
  for (const commandType of ['nvr_capability_probe', 'channel_discovery', 'snapshot_request']) {
    const completion = await executeDeviceCommand(command({
      commandType,
      nvrConnectionId: id(),
      request: commandType === 'snapshot_request' ? { channelId: '1' } : {},
      target: { vendor: 'Dahua', localHost: '192.168.1.10', httpPort: 80, rtspPort: 554, onvifPort: 80 },
    }));
    assert.equal(completion.outcome, 'failed');
    assert.equal(completion.errorCode, 'NVR_ADAPTER_NOT_AVAILABLE');
    assert.equal(completion.retryable, false);
  }
});

test('migration is one forward transaction with durable private command state', () => {
  assert.match(migration, /^--[\s\S]*\bBEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
  for (const table of ['device_commands', 'device_command_attempts', 'device_command_audit']) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;\\s*ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY;`));
  }
  assert.doesNotMatch(migration, /CREATE POLICY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.device_commands, public\.device_command_attempts, public\.device_command_audit[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE)[^;]+(?:anon|authenticated)/);
});

test('database enqueue authorization binds canonical profile, company, location, gateway, and NVR', () => {
  const enqueue = migration.slice(migration.indexOf('CREATE FUNCTION public.enqueue_device_command'), migration.indexOf('CREATE FUNCTION public.get_device_command'));
  assert.match(enqueue, /profile\.id = auth\.uid\(\) AND profile\.status = 'active'/);
  assert.match(enqueue, /v_profile\.role NOT IN \('manager','owner','super_admin'\)/);
  assert.match(enqueue, /gateway\.company_id = v_profile\.company_id/);
  assert.match(enqueue, /location\.id = v_gateway\.location_id[\s\S]*location\.company_id = v_gateway\.company_id[\s\S]*location\.status = 'active'/);
  assert.match(enqueue, /nvr\.company_id = v_gateway\.company_id[\s\S]*nvr\.location_id = v_gateway\.location_id[\s\S]*nvr\.gateway_id = v_gateway\.id/);
  assert.match(managementRoute, /resolveActorContext/);
  assert.match(managementRoute, /canViewCameraManager\(actor\.role\)/);
  assert.doesNotMatch(managementRoute, /createSupabaseServer\(|SUPABASE_SERVICE_ROLE/);
  assert.match(transportService, /client\.rpc\('enqueue_device_command'/);
  assert.match(transportService, /client\.rpc\('get_device_command'/);
  assert.doesNotMatch(transportService, /fetch\(|createSupabaseServer|local_host|secret_reference/);
});

test('idempotency is company-scoped and conflicting reuse fails closed', () => {
  assert.match(migration, /CONSTRAINT device_commands_company_idempotency_unique UNIQUE\(company_id, idempotency_key\)/);
  assert.match(migration, /extensions\.digest[\s\S]*p_gateway_id::text[\s\S]*p_request_payload::text/);
  assert.match(migration, /ON CONFLICT\(company_id, idempotency_key\) DO NOTHING/);
  assert.match(migration, /v_command\.request_fingerprint <> v_fingerprint[\s\S]*DEVICE_COMMAND_IDEMPOTENCY_CONFLICT/);
});

test('claiming is gateway-scoped, lease-based, concurrent-safe, and bounded', () => {
  const claim = migration.slice(migration.indexOf('CREATE FUNCTION public.claim_device_commands'), migration.indexOf('CREATE FUNCTION public.complete_device_command'));
  assert.match(claim, /private\.resolve_device_command_agent\(p_public_agent_id, p_credential_hash\)/);
  assert.match(claim, /command\.gateway_id = v_agent\.gateway_id[\s\S]*command\.company_id = v_agent\.company_id[\s\S]*command\.location_id = v_agent\.location_id/);
  assert.match(claim, /FOR UPDATE SKIP LOCKED/g);
  assert.match(claim, /least\(v_now \+ interval '45 seconds', v_command\.expires_at\)/);
  assert.match(claim, /command\.attempt_count < command\.max_attempts/);
  assert.match(claim, /INSERT INTO public\.device_command_attempts/);
  assert.match(claim, /nvr\.gateway_id = v_agent\.gateway_id/);
});

test('retry, expiry, and duplicate completion transitions are deterministic', () => {
  const complete = migration.slice(migration.indexOf('CREATE FUNCTION public.complete_device_command'), migration.indexOf('ALTER TABLE public.device_agent_rate_limits'));
  assert.match(complete, /completion_fingerprint IS DISTINCT FROM v_fingerprint[\s\S]*DEVICE_COMMAND_COMPLETION_CONFLICT/);
  assert.match(complete, /command\.duplicate_completion[\s\S]*DUPLICATE_IGNORED/);
  assert.match(complete, /least\(30, \(2 \^ greatest\(0, v_attempt\.attempt_number - 1\)\)::integer\)/);
  assert.match(complete, /v_command\.attempt_count < v_command\.max_attempts/);
  assert.match(complete, /v_next_attempt_at < v_command\.expires_at/);
  assert.match(migration, /command\.expires_at <= v_now[\s\S]*status = 'expired'/);
  assert.match(migration, /MAX_ATTEMPTS_EXCEEDED/);
});

test('gateway credentials and the command capability are revalidated by every agent RPC', () => {
  assert.match(migration, /CREATE FUNCTION private\.resolve_device_command_agent/);
  assert.match(migration, /credential\.public_agent_id = p_public_agent_id[\s\S]*credential\.credential_hash = p_credential_hash[\s\S]*credential\.revoked_at IS NULL/);
  assert.match(migration, /capability\.capability_code = 'brain\.command\.transport\.v1'[\s\S]*capability\.approved[\s\S]*catalog\.enabled/);
  assert.match(migration, /ON CONFLICT\(gateway_id, capability_code\) DO UPDATE SET\s*declared_version = 1, last_declared_at = clock_timestamp\(\)/);
  assert.doesNotMatch(migration, /ON CONFLICT\(gateway_id, capability_code\) DO UPDATE SET[\s\S]{0,200}revoked_at = NULL/);
  for (const route of [claimRoute, completeRoute]) {
    assert.match(route, /authenticateAgentCommandRequest/);
    assert.match(route, /createSupabaseServer/);
    assert.doesNotMatch(route, /createSupabaseServerAuth|resolveActorContext/);
  }
});

test('only the outbound agent receives private target metadata and no credential columns cross the transport', () => {
  assert.doesNotMatch(managementRoute, /local_host|username_secret_reference|password_secret_reference|credential_hash/);
  assert.match(migration, /'localHost', v_nvr\.local_host/);
  assert.doesNotMatch(claimRoute, /row\.(?:username_secret_reference|password_secret_reference|credential_hash)/);
  assert.doesNotMatch(migration.slice(migration.indexOf("'localHost', v_nvr.local_host"), migration.indexOf('CREATE FUNCTION public.complete_device_command')), /secret_reference|credential_hash/);
  assert.match(runtime, /fetch\(new URL\('\/api\/agent\/commands\/claim'/);
  assert.match(runtime, /fetch\(new URL\('\/api\/agent\/commands\/complete'/);
  assert.doesNotMatch(managementRoute + claimRoute + completeRoute, /fetch\([^)]*(?:local_host|localHost|nvr)/i);
  assert.doesNotMatch(executor, /https?:\/\/|Authorization|username|password|secret_reference/i);
});

test('dangerous operational mechanisms remain absent', () => {
  const executableMigration = migration.replace(/--.*$/gm, '');
  const sources = [executableMigration, managementRoute, claimRoute, completeRoute, transportService, runtime, executor].join('\n');
  assert.doesNotMatch(sources, /\b(?:PTZ|reboot|firmware|remote shell|child_process|execFile|spawn)\b/i);
  assert.doesNotMatch(sources, /DELETE FROM public\.(?:nvr_connections|cameras|device_gateways)/i);
  assert.doesNotMatch(sources, /UPDATE public\.nvr_connections/i);
});
