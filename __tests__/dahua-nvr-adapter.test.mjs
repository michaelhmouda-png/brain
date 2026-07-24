import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createDigestAuthorization,
  DahuaAdapter,
  parseDahuaChannels,
  parseDahuaKeyValues,
  parseDigestChallenge,
} from '../agent/src/dahua-adapter.ts';
import { executeDeviceCommand } from '../agent/src/commands.ts';
import { validDeviceCommandResult } from '../lib/brain-agent/command-contracts.ts';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/202607240002_dahua_nvr_adapter.sql');
const adapterSource = read('agent/src/dahua-adapter.ts');
const executorSource = read('agent/src/commands.ts');
const runtimeSource = read('agent/src/runtime.ts');
const storageSource = read('agent/src/storage.ts');
const cliSource = read('agent/src/cli.ts');
const uploadRoute = read('app/api/agent/commands/snapshot/route.ts');
const browserSnapshotRoute = read('app/api/devices/commands/snapshots/route.ts');
const claimRoute = read('app/api/agent/commands/claim/route.ts');
const id = () => crypto.randomUUID();
const encode = (value) => new TextEncoder().encode(value);
const digestChallenge = 'Digest realm="Dahua NVR", nonce="abcdef0123456789", qop="auth", algorithm=MD5, opaque="opaque-value"';

function mockTransport() {
  const calls = [];
  const transport = async (request) => {
    calls.push(request);
    if (!request.headers.Authorization) {
      return { status: 401, headers: { 'www-authenticate': digestChallenge }, body: new Uint8Array() };
    }
    if (request.path === '/cgi-bin/magicBox.cgi?action=getSystemInfo') {
      return {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: encode('deviceType=NVR5216-4KS2\nsoftwareVersion=V4.001.0000000.0\nserialNumber=SHOULD_NOT_LEAVE_AGENT\n'),
      };
    }
    if (request.path === '/cgi-bin/global.cgi?action=getCurrentTime') {
      return { status: 200, headers: { 'content-type': 'text/plain' }, body: encode('result=2026-07-24 12:00:00\n') };
    }
    if (request.path === '/cgi-bin/LogicDeviceManager.cgi?action=getCameraAll') {
      return {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: encode([
          'result[0].UniqueChannel=0',
          'result[0].DeviceName=Entrance',
          'result[0].Enable=true',
          'result[0].ConnectionState=Connected',
          'result[0].Password=MUST_BE_IGNORED',
          'result[1].UniqueChannel=1',
          'result[1].DeviceName=Kitchen',
          'result[1].Enable=true',
          'result[1].ConnectionState=ConnectFailed',
          'result[1].IPAddress=192.168.1.50',
          '',
        ].join('\n')),
      };
    }
    if (request.path === '/cgi-bin/snapshot.cgi?channel=1') {
      return {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        body: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
      };
    }
    throw new Error(`unexpected mock path: ${request.path}`);
  };
  return { calls, transport };
}

function target() {
  return { vendor: 'Dahua', localHost: '192.168.10.20', httpPort: 80, rtspPort: 554, onvifPort: 80 };
}

function command(commandType, overrides = {}) {
  return {
    commandId: id(),
    commandType,
    nvrConnectionId: id(),
    request: commandType === 'snapshot_request' ? { channelId: '1' } : {},
    target: target(),
    leaseToken: id(),
    leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    attemptNumber: 1,
    commandExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

test('Digest challenge parsing is strict and authorization never exposes the password', () => {
  const challenge = parseDigestChallenge(digestChallenge);
  assert.ok(challenge);
  const authorization = createDigestAuthorization(challenge, { username: 'operator', password: 'highly-secret' }, '/cgi-bin/magicBox.cgi?action=getSystemInfo', '00112233445566778899aabbccddeeff');
  assert.match(authorization, /^Digest username="operator"/);
  assert.match(authorization, /qop=auth/);
  assert.match(authorization, /nc=00000001/);
  assert.doesNotMatch(authorization, /highly-secret/);
  assert.equal(parseDigestChallenge('Basic realm="NVR"'), null);
  assert.equal(parseDigestChallenge('Digest realm="x", nonce="y", qop="auth-int"'), null);
  assert.throws(() => createDigestAuthorization(challenge, { username: 'a', password: 'b' }, '/arbitrary'));
  assert.throws(
    () => createDigestAuthorization(challenge, { username: 'admin\r\nInjected: yes', password: 'secret' }, '/cgi-bin/magicBox.cgi?action=getSystemInfo'),
    /DAHUA_CREDENTIAL_INVALID/,
  );
});

test('capability detection uses only mocked Dahua system information', async () => {
  const mock = mockTransport();
  const adapter = new DahuaAdapter(target(), { username: 'operator', password: 'secret' }, mock.transport);
  const result = await adapter.detectCapabilities();
  assert.equal(result.vendor, 'Dahua');
  assert.equal(result.model, 'NVR5216-4KS2');
  assert.deepEqual(result.capabilities, [
    'dahua.cgi.v1',
    'nvr.health_diagnostics',
    'nvr.channel_discovery',
    'nvr.camera_inventory_sync',
    'nvr.snapshot',
  ]);
  assert.equal(mock.calls.length, 2);
  assert.deepEqual([...new Set(mock.calls.map((call) => call.path))], ['/cgi-bin/magicBox.cgi?action=getSystemInfo']);
});

test('channel discovery parses a safe inventory projection and drops address and password fields', async () => {
  const mock = mockTransport();
  const adapter = new DahuaAdapter(target(), { username: 'operator', password: 'secret' }, mock.transport);
  const channels = await adapter.discoverChannels();
  assert.deepEqual(channels, [
    { externalChannelId: '1', name: 'Entrance', enabled: true, status: 'online' },
    { externalChannelId: '2', name: 'Kitchen', enabled: true, status: 'error' },
  ]);
  assert.doesNotMatch(JSON.stringify(channels), /MUST_BE_IGNORED|192\.168\.1\.50|Password|IPAddress/);
  assert.equal(validDeviceCommandResult('channel_discovery', { channels }), true);
});

test('health diagnostics return a bounded safe projection without serial number', async () => {
  const mock = mockTransport();
  const adapter = new DahuaAdapter(target(), { username: 'operator', password: 'secret' }, mock.transport);
  const result = await adapter.healthDiagnostics();
  assert.equal(result.healthy, true);
  assert.equal(result.vendor, 'Dahua');
  assert.equal(result.model, 'NVR5216-4KS2');
  assert.equal(result.softwareVersion, 'V4.001.0000000.0');
  assert.equal(result.deviceTime, '2026-07-24 12:00:00');
  assert.doesNotMatch(JSON.stringify(result), /SHOULD_NOT_LEAVE_AGENT|serial/i);
  assert.equal(validDeviceCommandResult('nvr_health_diagnostics', result), true);
});

test('snapshot retrieval validates JPEG bytes and uses the lease-bound upload callback', async () => {
  const mock = mockTransport();
  let uploaded = null;
  const completion = await executeDeviceCommand(command('snapshot_request'), {
    credential: { username: 'operator', password: 'secret' },
    dahuaTransport: mock.transport,
    uploadSnapshot: async (snapshot) => {
      uploaded = snapshot;
      return { artifactId: '11111111-1111-4111-8111-111111111111' };
    },
  });
  assert.equal(completion.outcome, 'succeeded');
  assert.equal(completion.result.artifactId, '11111111-1111-4111-8111-111111111111');
  assert.equal(uploaded.contentType, 'image/jpeg');
  assert.equal(uploaded.channelId, '1');
  assert.deepEqual([...uploaded.bytes.slice(0, 3)], [0xff, 0xd8, 0xff]);
});

test('all adapter-backed command handlers execute through mocked transport', async () => {
  for (const commandType of ['nvr_capability_probe', 'nvr_health_diagnostics', 'channel_discovery']) {
    const mock = mockTransport();
    const completion = await executeDeviceCommand(command(commandType), {
      credential: { username: 'operator', password: 'secret' },
      dahuaTransport: mock.transport,
    });
    assert.equal(completion.outcome, 'succeeded', commandType);
    assert.ok(mock.calls.length >= 2, commandType);
  }
});

test('authentication, redirect, malformed data, and invalid snapshot responses fail closed', async () => {
  const unauthorized = async () => ({ status: 401, headers: { 'www-authenticate': digestChallenge }, body: new Uint8Array() });
  const authFailure = await executeDeviceCommand(command('nvr_capability_probe'), {
    credential: { username: 'operator', password: 'wrong' },
    dahuaTransport: unauthorized,
  });
  assert.equal(authFailure.errorCode, 'NVR_AUTHENTICATION_FAILED');
  assert.equal(authFailure.retryable, false);

  const redirect = async () => ({ status: 302, headers: { location: 'http://example.com/' }, body: new Uint8Array() });
  const redirectFailure = await executeDeviceCommand(command('nvr_capability_probe'), {
    credential: { username: 'operator', password: 'secret' },
    dahuaTransport: redirect,
  });
  assert.equal(redirectFailure.outcome, 'failed');

  assert.throws(() => parseDahuaKeyValues(encode('not-a-key-value-line')));
  const values = parseDahuaKeyValues(encode('result[0].UniqueChannel=999\nresult[0].Password=secret\n'));
  assert.deepEqual(parseDahuaChannels(values), []);

  const invalidSnapshot = mockTransport();
  invalidSnapshot.transport = async (request) => request.headers.Authorization
    ? { status: 200, headers: { 'content-type': 'text/html' }, body: encode('<html>not image</html>') }
    : { status: 401, headers: { 'www-authenticate': digestChallenge }, body: new Uint8Array() };
  const snapshotFailure = await executeDeviceCommand(command('snapshot_request'), {
    credential: { username: 'operator', password: 'secret' },
    dahuaTransport: invalidSnapshot.transport,
    uploadSnapshot: async () => ({ artifactId: id() }),
  });
  assert.equal(snapshotFailure.errorCode, 'NVR_RESPONSE_INVALID');
  assert.equal(snapshotFailure.retryable, false);
});

test('production transport fixes DNS to a private address and has a closed read-only path allowlist', () => {
  assert.match(adapterSource, /resolvePrivateNvrAddress\(input\.host\)/);
  assert.match(adapterSource, /method: 'GET'/);
  assert.match(adapterSource, /agent: false/);
  assert.match(adapterSource, /DAHUA_REQUEST_NOT_ALLOWED/);
  assert.match(adapterSource, /SNAPSHOT_PATH\.test\(path\)/);
  assert.doesNotMatch(adapterSource, /method: 'POST'|method: 'PUT'|method: 'DELETE'|redirect:\s*'follow'/);
  assert.doesNotMatch(adapterSource, /\bfetch\(/);
});

test('NVR credentials remain local, DPAPI-protected, non-exportable, and absent from cloud routes', () => {
  assert.match(storageSource, /encryptedUsername: protectCredential\(username\)/);
  assert.match(storageSource, /encryptedPassword: protectCredential\(password\)/);
  assert.match(storageSource, /unprotectCredential\(stored\.encryptedUsername\)/);
  assert.match(cliSource, /set-nvr-credentials/);
  assert.match(cliSource, /remove-nvr-credentials/);
  assert.doesNotMatch(cliSource, /export-nvr|show-nvr|console\.log\([^)]*(?:username|password)/i);
  assert.doesNotMatch(claimRoute + uploadRoute + browserSnapshotRoute, /username_secret_reference|password_secret_reference|encryptedPassword/);
});

test('camera inventory synchronization is command-result driven and tenant-bound', () => {
  assert.match(migration, /CREATE FUNCTION private\.apply_dahua_command_result/);
  assert.match(migration, /NEW\.command_type = 'channel_discovery'/);
  assert.match(migration, /nvr\.company_id = NEW\.company_id[\s\S]*nvr\.location_id = NEW\.location_id[\s\S]*nvr\.gateway_id = NEW\.gateway_id/);
  assert.match(migration, /INSERT INTO public\.cameras\([\s\S]*ON CONFLICT\(nvr_connection_id, external_channel_id\) DO UPDATE/);
  assert.match(migration, /status = EXCLUDED\.status/);
  assert.match(migration, /NOT \(camera\.external_channel_id = ANY\(v_discovered_ids\)\)/);
  assert.match(migration, /CREATE TRIGGER device_commands_apply_dahua_result/);
  assert.doesNotMatch(executorSource, /from\('cameras'\)|INSERT INTO public\.cameras/);
});

test('snapshot artifacts are lease-bound, private, expiring, and company-authorized', () => {
  assert.match(migration, /CREATE TABLE public\.camera_snapshot_artifacts/);
  assert.match(migration, /ALTER TABLE public\.camera_snapshot_artifacts FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /'camera-snapshots', 'camera-snapshots', false/);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*camera-snapshots/);
  assert.match(migration, /command\.current_lease_token = p_lease_token[\s\S]*command\.current_lease_expires_at > v_now/);
  assert.match(migration, /artifact\.company_id = v_profile\.company_id[\s\S]*artifact\.status = 'ready'[\s\S]*artifact\.expires_at > clock_timestamp\(\)/);
  assert.match(migration, /v_artifact\.byte_size <> p_byte_size OR v_artifact\.sha256 <> p_sha256[\s\S]*status = 'pending', ready_at = NULL/);
  assert.match(uploadRoute, /boundedBody/);
  assert.match(uploadRoute, /createHash\('sha256'\)/);
  assert.match(uploadRoute, /reserve_device_snapshot_upload/);
  assert.match(uploadRoute, /finalize_device_snapshot_upload/);
  assert.match(browserSnapshotRoute, /resolveActorContext/);
  assert.match(browserSnapshotRoute, /createSignedUrl\(artifact\.storage_path, 60\)/);
});

test('snapshot upload and completion remain outbound agent operations', () => {
  assert.match(runtimeSource, /fetch\(new URL\('\/api\/agent\/commands\/snapshot'/);
  assert.match(runtimeSource, /X-Command-Id/);
  assert.match(runtimeSource, /X-Lease-Token/);
  assert.doesNotMatch(browserSnapshotRoute, /localHost|local_host|cgi-bin|Authorization: `Digest/);
  assert.doesNotMatch(uploadRoute, /localHost|local_host|cgi-bin/);
});

test('forbidden Dahua operations and arbitrary request surfaces are absent', () => {
  const executableMigration = migration.replace(/--.*$/gm, '');
  const sources = [executableMigration, adapterSource, executorSource, runtimeSource, uploadRoute, browserSnapshotRoute].join('\n');
  assert.doesNotMatch(sources, /\b(?:PTZ|reboot|firmware|user management|credential export|video streaming|remote shell)\b/i);
  assert.doesNotMatch(sources, /action=(?:set|delete|reboot|update|modify|add)/i);
  assert.doesNotMatch(sources, /configManager\.cgi/);
  assert.doesNotMatch(sources, /rtsp:\/\//i);
});
