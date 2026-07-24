import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  parseNvrProbeEnqueue,
  sanitizeNvrProbeControlState,
  sanitizeNvrProbeResult,
  validDeviceCommandResult,
} from '../lib/brain-agent/command-contracts.ts';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/202607240006_camera_manager_nvr_probe_controls.sql');
const route = read('app/api/devices/commands/route.ts');
const component = read('components/camera-manager/NvrProbeControls.tsx');
const runtime = read('agent/src/runtime.ts');
const heartbeat = read('app/api/agent/heartbeat/route.ts');
const transport = read('lib/brain-agent/command-transport.server.ts');
const adapter = read('agent/src/dahua-adapter.ts');
const id = () => crypto.randomUUID();

function result(overrides = {}) {
  return {
    vendor: 'Dahua',
    model: 'NVR5216-4KS2',
    firmwareVersion: 'V4.001.0000000.0',
    capabilities: ['dahua.cgi.v1', 'nvr.health_diagnostics'],
    healthy: true,
    responseTimeMs: 42,
    ...overrides,
  };
}

test('probe enqueue input is owner-control shaped and discards no hidden authority fields', () => {
  const value = {
    nvrConnectionId: id(),
    commandType: 'nvr_capability_probe',
    idempotencyKey: id(),
    ttlSeconds: 120,
  };
  assert.deepEqual(parseNvrProbeEnqueue(value), value);
  assert.equal(parseNvrProbeEnqueue({ ...value, gatewayId: id() }), null);
  assert.equal(parseNvrProbeEnqueue({ ...value, commandType: 'channel_discovery' }), null);
  assert.equal(parseNvrProbeEnqueue({ ...value, ttlSeconds: 601 }), null);
  assert.match(route, /canManageNvrs\(actor\.role\)/);
  assert.match(migration, /v_profile\.role NOT IN \('owner','super_admin'\)/);
  assert.doesNotMatch(route, /createSupabaseServer\(|SUPABASE_SERVICE_ROLE/);
});

test('tenant and assignment checks bind profile, company, location, gateway, and NVR', () => {
  const enqueue = migration.slice(
    migration.indexOf('CREATE FUNCTION public.enqueue_nvr_probe_command'),
    migration.indexOf('ALTER FUNCTION public.authenticate_device_agent_heartbeat'),
  );
  assert.match(enqueue, /profile\.id = auth\.uid\(\) AND profile\.status = 'active'/);
  assert.match(enqueue, /nvr\.company_id = v_profile\.company_id/);
  assert.match(enqueue, /gateway\.id = v_nvr\.gateway_id[\s\S]*gateway\.company_id = v_nvr\.company_id[\s\S]*gateway\.location_id = v_nvr\.location_id/);
  assert.match(enqueue, /presence\.company_id = v_nvr\.company_id[\s\S]*presence\.location_id = v_nvr\.location_id[\s\S]*presence\.gateway_id = v_gateway\.id/);
  assert.match(migration, /nvr\.company_id = v_heartbeat\.company_id[\s\S]*nvr\.location_id = v_heartbeat\.location_id[\s\S]*nvr\.gateway_id = v_heartbeat\.gateway_id/);
});

test('active duplicate probes are prevented atomically and existing work is reused', () => {
  assert.match(migration, /CREATE UNIQUE INDEX device_commands_active_nvr_probe_uidx/);
  assert.match(migration, /WHERE status IN \('pending','leased'\)[\s\S]*nvr_capability_probe[\s\S]*nvr_health_diagnostics/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /candidate\.status IN \('pending','leased'\)[\s\S]*RETURN QUERY SELECT[\s\S]*false, true/);
  assert.match(component, /hasActiveCommand/);
  assert.match(component, /disabled=\{hasActiveCommand \|\| hasActiveLocalCommand \|\| submitting !== null\}/);
});

test('offline gateways and stale heartbeats fail closed before enqueue', () => {
  assert.match(migration, /v_gateway\.status <> 'online'/);
  assert.match(migration, /v_gateway\.last_seen_at <= v_now - interval '3 minutes'/);
  assert.match(migration, /NVR_PROBE_GATEWAY_OFFLINE/);
  assert.match(migration, /v_gateway\.status = 'online'[\s\S]*last_seen_at > clock_timestamp\(\) - interval '3 minutes'/);
  assert.match(component, /state && !state\.eligible/);
  assert.match(component, /state\?\.eligible/);
});

test('local credential presence reports only assigned NVR UUIDs and never credential material', () => {
  assert.match(migration, /CREATE TABLE public\.device_nvr_credential_presence/);
  assert.match(migration, /ALTER TABLE public\.device_nvr_credential_presence FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.device_nvr_credential_presence[\s\S]*PUBLIC, anon, authenticated, service_role/);
  assert.match(runtime, /credentialedNvrIds: Object\.keys\(state\?\.nvrCredentials \?\? \{\}\)/);
  assert.match(heartbeat, /p_credentialed_nvr_ids: metadata\.credentialedNvrIds/);
  assert.match(migration, /NVR_PROBE_CREDENTIALS_NOT_REPORTED/);
  const presenceTable = migration.slice(
    migration.indexOf('CREATE TABLE public.device_nvr_credential_presence'),
    migration.indexOf('CREATE INDEX device_nvr_credential_presence_gateway_reported_idx'),
  );
  assert.doesNotMatch(presenceTable + route + transport + component, /encryptedUsername|encryptedPassword|unprotectCredential|credential_hash|username_secret_reference|password_secret_reference/);
});

test('expired probe commands become terminal and are audited before replacement', () => {
  assert.match(migration, /candidate\.expires_at <= v_now/);
  assert.match(migration, /outcome = 'command_expired'/);
  assert.match(migration, /status = 'expired'/);
  assert.match(migration, /'system', 'command\.expired', 'COMMAND_EXPIRED'/);
  assert.match(migration, /public\.enqueue_device_command/);
  assert.match(migration, /'commandId', command\.id[\s\S]*'createdAt', command\.created_at[\s\S]*'expiresAt', command\.expires_at[\s\S]*'completedAt', command\.completed_at/);
});

test('durable probe results use one exact non-sensitive projection', () => {
  const safe = result();
  assert.equal(validDeviceCommandResult('nvr_capability_probe', safe), true);
  assert.equal(validDeviceCommandResult('nvr_health_diagnostics', safe), true);
  assert.deepEqual(sanitizeNvrProbeResult({ ...safe, serialNumber: 'forbidden' }), null);
  assert.deepEqual(sanitizeNvrProbeResult({ ...safe, password: 'forbidden' }), null);
  assert.deepEqual(sanitizeNvrProbeResult(safe), safe);
  assert.match(migration, /private\.valid_nvr_probe_result\(p_result\)/);
  assert.match(migration, /private\.sanitized_nvr_probe_result/);
  assert.doesNotMatch(migration + component, /serialNumber|rawHeaders|unrestrictedResponse/);
  assert.doesNotMatch(JSON.stringify(safe), /serial|password|credential/i);
});

test('control-state sanitizer rejects raw or unexpected server result fields', () => {
  const commandId = id();
  const state = {
    nvrConnectionId: id(),
    gatewayId: id(),
    eligible: true,
    assignmentCompatible: true,
    gatewayOnline: true,
    credentialsPresent: true,
    safeUnavailableCode: null,
    commands: [{
      commandId,
      requestId: commandId,
      commandType: 'nvr_capability_probe',
      status: 'succeeded',
      attemptCount: 1,
      safeFailureCode: null,
      result: result(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }],
  };
  assert.deepEqual(sanitizeNvrProbeControlState(state), state);
  assert.equal(sanitizeNvrProbeControlState({
    ...state,
    commands: [{ ...state.commands[0], result: { ...result(), headers: { authorization: 'forbidden' } } }],
  }), null);
});

test('UI shows durable state, safe failure, request ID, timestamps, and sanitized fields only', () => {
  for (const token of ['requestId', 'safeFailureCode', 'createdAt', 'expiresAt', 'completedAt', 'firmwareVersion', 'responseTimeMs', 'capabilities']) {
    assert.match(component, new RegExp(token));
  }
  assert.match(component, /nvr_capability_probe/);
  assert.match(component, /nvr_health_diagnostics/);
  assert.match(component, /commandType: 'channel_discovery'/);
  assert.match(component, /request: diagnostic \? \{ diagnostic: true \} : \{\}/);
  assert.doesNotMatch(component, /snapshot_request|PTZ|streaming|configuration|recording|user management/i);
  assert.doesNotMatch(route + component, /localHost|local_host|cgi-bin|password|secret_reference/);
});

test('authenticated channel discovery control uses only the existing safe command transport', () => {
  assert.match(component, /fetch\('\/api\/devices\/commands'/);
  assert.match(component, /gatewayId: state\.gatewayId/);
  assert.match(component, /nvrConnectionId/);
  assert.match(component, /commandType: 'channel_discovery'/);
  assert.match(component, /idempotencyKey: crypto\.randomUUID\(\)/);
  assert.match(component, /enqueueDiscovery\(true\)/);
  assert.match(component, /hasActiveLocalCommand/);
  assert.doesNotMatch(component, /createSupabaseServer|service.role|SUPABASE_SERVICE_ROLE/i);
});

test('probe lifecycle retains core lease, retry, idempotency, and audit transport', () => {
  assert.match(migration, /p_idempotency_key/);
  assert.match(migration, /p_ttl_seconds/);
  assert.match(migration, /public\.enqueue_device_command/);
  assert.match(transport, /client\.rpc\('enqueue_nvr_probe_command'/);
  assert.match(transport, /client\.rpc\('get_nvr_probe_control_state'/);
  assert.doesNotMatch(component, /fetch\([^)]*192\.168|http:\/\/|https:\/\//);
  assert.match(adapter, /method: 'GET'/);
  assert.doesNotMatch(adapter, /method: 'POST'|method: 'PUT'|method: 'DELETE'/);
});
