import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { canManageNvrs, canViewCameraManager, isSafeLocalHost, parseCameraWrite, parseNvrWrite } from '../lib/camera-manager.ts';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migration_audit/pre_baseline_20260724/202607220014_camera_manager_foundation.sql');
const tenantTriggerRepair = read('supabase/migration_audit/pre_baseline_20260724/202607220015_fix_camera_manager_tenant_trigger.sql');
const forwardColumnGrants = read('supabase/migrations/202607240003_restore_camera_manager_column_grants.sql');
const nvrRoute = read('app/api/devices/nvrs/route.ts');
const cameraRoute = read('app/api/devices/cameras/route.ts');
const page = read('app/dashboard/cameras/page.tsx');
const acceptedLocalHosts = ['192.168.10.124', '10.0.0.5', '172.16.1.20', 'nvr-gateway', 'nvr.localdomain', 'cameras.internal.example'];
const rejectedLocalHosts = [
  '', ' localhost', 'localhost ', 'localhost', 'LOCALHOST', 'localhost.', 'nvr.localhost', 'localhost.example',
  '127.0.0.1', '127.12.34.56', '0.0.0.0', '0.1.2.3', '169.254.1.20',
  '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
  '999.1.1.1', '1.2.3', '127.000.0.1', 'http://nvr.local', 'nvr.local:80',
  'nvr.local/path', 'nvr.local?x=1', 'nvr.local#status', 'user@nvr.local', 'nvr local',
];

function tenantTriggerBranches(sql) {
  const functionStart = sql.indexOf('CREATE OR REPLACE FUNCTION private.validate_device_tenant_relationships()');
  const body = sql.slice(functionStart >= 0 ? functionStart : sql.indexOf('CREATE FUNCTION private.validate_device_tenant_relationships()'));
  const gatewayStart = body.indexOf("IF TG_TABLE_NAME = 'device_gateways' THEN");
  const nvrStart = body.indexOf("ELSIF TG_TABLE_NAME = 'nvr_connections' THEN");
  const cameraStart = body.indexOf("ELSIF TG_TABLE_NAME = 'cameras' THEN");
  const unknownStart = body.indexOf('ELSE', cameraStart);
  return {
    body,
    gateway: body.slice(gatewayStart, nvrStart),
    nvr: body.slice(nvrStart, cameraStart),
    camera: body.slice(cameraStart, unknownStart),
    unknown: body.slice(unknownStart),
  };
}

test('role matrix denies employees, permits management reads, and reserves NVR changes for owners', () => {
  assert.equal(canViewCameraManager('employee'), false);
  assert.equal(canViewCameraManager('manager'), true);
  assert.equal(canViewCameraManager('owner'), true);
  assert.equal(canViewCameraManager('super_admin'), true);
  assert.equal(canManageNvrs('manager'), false);
  assert.equal(canManageNvrs('owner'), true);
  assert.equal(canManageNvrs('super_admin'), true);
});

test('NVR metadata validation accepts hosts, rejects URLs and never accepts client authority fields', () => {
  const valid = { locationId: crypto.randomUUID(), gatewayId: null, name: 'Main NVR', vendor: 'Dahua', localHost: '192.168.10.124', httpPort: 80, rtspPort: 554, onvifPort: null, usernameSecretReference: 'vault/nvr/user', passwordSecretReference: 'vault/nvr/password', status: 'configured' };
  assert.ok(parseNvrWrite(valid, false));
  const gatewayId = crypto.randomUUID();
  assert.equal(parseNvrWrite({ ...valid, gatewayId }, false)?.gatewayId, gatewayId);
  assert.equal(parseNvrWrite({ ...valid, gatewayId: 'not-a-uuid' }, false), null);
  assert.equal(isSafeLocalHost('nvr-01.local'), true);
  for (const host of ['http://192.168.10.124', 'rtsp://user:pass@host/stream', '192.168.10.999', 'host/path']) assert.equal(isSafeLocalHost(host), false, host);
  assert.equal(parseNvrWrite({ ...valid, localHost: 'http://localhost' }, false), null);
  assert.equal(parseNvrWrite({ ...valid, passwordSecretReference: 'plain password' }, false), null);
  assert.doesNotMatch(nvrRoute, /body\.company|body\.role|body\.profile/);
});

test('local hosts accept private IPv4 and DNS while rejecting unsafe local and reserved targets', () => {
  for (const host of acceptedLocalHosts) {
    assert.equal(isSafeLocalHost(host), true, host);
  }
  for (const host of rejectedLocalHosts) assert.equal(isSafeLocalHost(host), false, host);
  assert.equal(parseNvrWrite({ locationId: crypto.randomUUID(), gatewayId: null, name: 'NVR', vendor: 'Dahua', localHost: ' nvr.localdomain', httpPort: 80, rtspPort: 554, onvifPort: null, status: 'configured' }, false), null);
});

test('database local-host validator is immutable, private, side-effect free, and required by the NVR constraint', () => {
  const validatorStart = migration.indexOf('CREATE FUNCTION private.is_valid_camera_local_host');
  const validatorEnd = migration.indexOf('CREATE TABLE public.device_gateways');
  const validator = migration.slice(validatorStart, validatorEnd);
  assert.ok(validatorStart >= 0 && validatorEnd > validatorStart);
  assert.match(validator, /RETURNS boolean[\s\S]*LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = ''/);
  assert.match(validator, /REVOKE ALL ON FUNCTION private\.is_valid_camera_local_host\(text\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(validator, /GRANT EXECUTE ON FUNCTION private\.is_valid_camera_local_host\(text\) TO authenticated, service_role/);
  assert.doesNotMatch(validator, /SECURITY DEFINER|CREATE FUNCTION public\.|SELECT\s+.*FROM|INSERT|UPDATE|DELETE|http|rtsp|net\.|dblink/i);
  assert.match(migration, /local_host text NOT NULL CONSTRAINT nvr_connections_local_host_valid CHECK \(private\.is_valid_camera_local_host\(local_host\)\)/);
  assert.doesNotMatch(migration, /local_host text NOT NULL CHECK \(char_length\(btrim\(local_host\)\)/);
});

test('SQL validator structure covers the same accepted and rejected fixture classes as TypeScript', () => {
  for (const host of acceptedLocalHosts) assert.equal(isSafeLocalHost(host), true, host);
  for (const host of rejectedLocalHosts) assert.equal(isSafeLocalHost(host), false, host);
  assert.match(migration, /p_value IS DISTINCT FROM btrim\(p_value\)/);
  assert.match(migration, /v_host ~ '\^\[0-9\]\{1,3\}\(\\\.\[0-9\]\{1,3\}\)\{3\}\$'/);
  assert.match(migration, /v_octets\[1\] IN \(0, 127\)/);
  assert.match(migration, /v_octets\[1\] = 169 AND v_octets\[2\] = 254/);
  assert.match(migration, /v_octets\[1\] >= 224/);
  assert.match(migration, /v_label = 'localhost'/);
  assert.match(migration, /v_host ~ '\^\[0-9\.\]\+\$'/);
});

test('camera updates are bounded to metadata and approved feature flags', () => {
  const parsed = parseCameraWrite({ id: crypto.randomUUID(), name: 'Kitchen 1', area: 'Prep', department: 'Kitchen', aiEnabled: true, taskVerificationEnabled: false, companyId: 'spoof' });
  assert.deepEqual(Object.keys(parsed ?? {}).sort(), ['aiEnabled','area','department','id','name','taskVerificationEnabled'].sort());
  assert.match(cameraRoute, /update\(\{ name: input\.name, area: input\.area, department: input\.department, ai_enabled: input\.aiEnabled, task_verification_enabled: input\.taskVerificationEnabled \}\)/);
  assert.doesNotMatch(cameraRoute, /local_host|rtsp|fetch\([^'"`]*input/);
});

test('migration creates normalized Phase 1 tables without camera events', () => {
  for (const table of ['device_gateways','nvr_connections','cameras','device_configuration_audit']) assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`));
  assert.doesNotMatch(migration, /CREATE TABLE public\.camera_events/);
  assert.match(migration, /CONSTRAINT cameras_nvr_channel_unique UNIQUE \(nvr_connection_id, external_channel_id\)/);
  assert.match(migration, /DEVICE_LOCATION_TENANT_MISMATCH/);
  assert.match(migration, /CAMERA_NVR_TENANT_MISMATCH/);
});

test('tenant trigger replacement branches before referencing table-specific NEW fields', () => {
  for (const sql of [migration, tenantTriggerRepair]) {
    const branches = tenantTriggerBranches(sql);
    assert.match(branches.gateway, /NEW\.location_id/);
    assert.doesNotMatch(branches.gateway, /NEW\.gateway_id|NEW\.nvr_connection_id/);
    assert.match(branches.nvr, /NEW\.gateway_id/);
    assert.doesNotMatch(branches.nvr, /NEW\.nvr_connection_id/);
    assert.match(branches.camera, /NEW\.nvr_connection_id/);
    assert.doesNotMatch(branches.camera, /NEW\.gateway_id/);
    assert.match(branches.unknown, /UNSUPPORTED_DEVICE_TENANT_TRIGGER_TABLE/);
    assert.doesNotMatch(branches.body, /TG_TABLE_NAME\s*=\s*'nvr_connections'\s+AND\s+NEW\.gateway_id/);
    assert.doesNotMatch(branches.body, /TG_TABLE_NAME\s*=\s*'cameras'\s+AND[\s\S]{0,80}NEW\.nvr_connection_id/);
  }
});

test('tenant trigger covers valid gateway, NVR, and camera relationships and rejects mismatches', () => {
  const repair = tenantTriggerBranches(tenantTriggerRepair);
  assert.match(repair.gateway, /location\.id = NEW\.location_id AND location\.company_id = NEW\.company_id/);
  assert.match(repair.nvr, /gateway\.company_id = NEW\.company_id/);
  assert.match(repair.nvr, /gateway\.location_id IS NULL OR gateway\.location_id = NEW\.location_id/);
  assert.match(repair.camera, /nvr\.company_id = NEW\.company_id/);
  assert.match(repair.camera, /nvr\.location_id = NEW\.location_id/);
  assert.match(repair.gateway, /DEVICE_LOCATION_TENANT_MISMATCH/);
  assert.match(repair.nvr, /NVR_GATEWAY_TENANT_MISMATCH/);
  assert.match(repair.camera, /CAMERA_NVR_TENANT_MISMATCH/);
});

test('corrective migration is transactional and replaces only the existing trigger function', () => {
  assert.match(tenantTriggerRepair, /^--[\s\S]*\bBEGIN;/);
  assert.match(tenantTriggerRepair, /CREATE OR REPLACE FUNCTION private\.validate_device_tenant_relationships\(\)/);
  assert.match(tenantTriggerRepair, /LANGUAGE plpgsql[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(tenantTriggerRepair, /REVOKE ALL ON FUNCTION private\.validate_device_tenant_relationships\(\)[\s\S]*FROM PUBLIC, anon, authenticated;/);
  assert.match(tenantTriggerRepair, /COMMIT;\s*$/);
  assert.doesNotMatch(tenantTriggerRepair, /CREATE TABLE|DROP TABLE|DROP TRIGGER|CREATE TRIGGER/);
});

test('RLS, grants, and column permissions implement tenant and role isolation', () => {
  assert.equal((migration.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length, 4);
  assert.match(migration, /CREATE FUNCTION private\.can_view_camera_manager\(p_company_id uuid\)[\s\S]*profile\.role IN \('manager','owner','super_admin'\)/);
  assert.match(migration, /CREATE FUNCTION private\.can_administer_camera_manager\(p_company_id uuid\)[\s\S]*profile\.role IN \('owner','super_admin'\)/);
  const policies = migration.slice(migration.indexOf('CREATE POLICY nvr_connections_management_select'));
  assert.match(policies, /nvr_connections_management_select[\s\S]*private\.can_view_camera_manager\(nvr_connections\.company_id\)/);
  assert.match(policies, /nvr_connections_owner_insert[\s\S]*private\.can_administer_camera_manager\(nvr_connections\.company_id\)/);
  assert.match(policies, /cameras_management_update[\s\S]*private\.can_view_camera_manager\(cameras\.company_id\)/);
  assert.doesNotMatch(policies, /role IN \(/);
  assert.match(migration, /REVOKE ALL ON public\.device_gateways,public\.nvr_connections,public\.cameras,public\.device_configuration_audit FROM PUBLIC,anon,authenticated/);
  assert.doesNotMatch(migration.match(/GRANT SELECT\([\s\S]*?TO authenticated;/)?.[0] ?? '', /secret_reference|last_error_code/);
});

test('camera reads use an explicit safe column grant and helpers are private RLS primitives only', () => {
  assert.doesNotMatch(migration, /GRANT SELECT ON public\.cameras TO authenticated/);
  assert.match(migration, /GRANT SELECT\(id,company_id,location_id,nvr_connection_id,external_channel_id,name,area,department,stream_profile,status,ai_enabled,task_verification_enabled,last_seen_at,created_at,updated_at\) ON public\.cameras TO authenticated/);
  for (const helper of ['can_view_camera_manager', 'can_administer_camera_manager']) {
    assert.match(migration, new RegExp(`CREATE FUNCTION private\\.${helper}\\(p_company_id uuid\\) RETURNS boolean[\\s\\S]*?SECURITY DEFINER SET search_path = '' STABLE`));
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION private\\.${helper}\\(uuid\\) FROM PUBLIC, anon, authenticated`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION private\\.${helper}\\(uuid\\) TO authenticated`));
    assert.doesNotMatch(migration, new RegExp(`CREATE FUNCTION public\\.${helper}`));
  }
});

test('forward chain restores only the RLS-governed Camera Manager column privileges', () => {
  assert.match(forwardColumnGrants, /^--[\s\S]*\bBEGIN;/);
  assert.match(forwardColumnGrants, /COMMIT;\s*$/);
  assert.match(forwardColumnGrants, /nvr_connections_owner_insert/);
  assert.match(forwardColumnGrants, /cameras_management_update/);
  assert.match(forwardColumnGrants, /GRANT SELECT\([\s\S]*?\) ON public\.nvr_connections TO authenticated/);
  assert.match(forwardColumnGrants, /GRANT INSERT\([\s\S]*?\) ON public\.nvr_connections TO authenticated/);
  assert.match(forwardColumnGrants, /GRANT UPDATE\([\s\S]*?\) ON public\.nvr_connections TO authenticated/);
  assert.match(forwardColumnGrants, /GRANT SELECT\([\s\S]*?\) ON public\.cameras TO authenticated/);
  assert.match(forwardColumnGrants, /GRANT UPDATE\([\s\S]*?\) ON public\.cameras TO authenticated/);
  assert.doesNotMatch(forwardColumnGrants, /GRANT\s+(?:ALL|TRUNCATE|TRIGGER|REFERENCES)|service_role|anon/);
});

test('APIs derive trusted scope, apply explicit company filters, and return no secrets', () => {
  for (const source of [nvrRoute, cameraRoute]) {
    assert.match(source, /resolveActorContext/);
    assert.match(source, /actor\.companyId/);
    assert.match(source, /private, no-store/);
    assert.doesNotMatch(source, /createSupabaseServer\(|SUPABASE_SERVICE_ROLE/);
  }
  assert.doesNotMatch(nvrRoute.match(/export async function GET[\s\S]*?export async function POST/)?.[0] ?? '', /secret_reference|last_error_code/);
  assert.match(nvrRoute, /\.eq\('company_id', actor\.companyId\)/);
  assert.match(cameraRoute, /\.eq\('company_id', actor\.companyId\)/);
  assert.match(nvrRoute, /\.eq\('company_id', companyId\)\.eq\('status', 'active'\)/);
});

test('NVR writes and Camera Manager UI support location-compatible Brain Agent assignment', () => {
  assert.equal((nvrRoute.match(/gateway_id: input\.gatewayId/g) ?? []).length, 2);
  assert.doesNotMatch(nvrRoute, /input\.gatewayId !== null/);
  assert.match(page, /fetch\('\/api\/devices\/agents'/);
  assert.match(page, /gatewayId: form\.gatewayId \|\| null/);
  assert.match(page, /gateway\.location_id === null \|\| gateway\.location_id === form\.locationId/);
  assert.match(page, /gatewayName\(nvr\.gateway_id\)/);
});

test('UI replaces fake feeds with mobile Camera Manager states and centralized Arabic RTL labels', () => {
  const i18n = read('lib/i18n.ts');
  const sidebar = read('components/DashboardSidebar.tsx');
  assert.match(page, /useLocale/);
  assert.match(page, /dir=\{language === 'ar' \? 'rtl' : 'ltr'\}/);
  assert.match(page, /100dvh/);
  assert.match(page, /c\.noLocations/);
  assert.match(page, /c\.noCameras/);
  assert.match(page, /Connection testing will become available|c\.agentNotice/);
  assert.match(i18n, /title: 'الكاميرات'/);
  assert.match(sidebar, /t\.nav\.cameras/);
  assert.doesNotMatch(page, /fake|livestream|<video|rtsp:\/\//i);
});

test('no server path contacts a private NVR or exposes credentials', () => {
  const sources = [nvrRoute, cameraRoute, page, migration].join('\n');
  assert.doesNotMatch(sources, /192\.168\.10\.124|password\s*=|rtsp:\/\//i);
  assert.doesNotMatch(nvrRoute, /fetch\((?!['"]\/api)/);
  assert.match(migration, /username_secret_reference text NULL/);
  assert.match(migration, /password_secret_reference text NULL/);
});
