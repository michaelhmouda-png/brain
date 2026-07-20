import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeMaintenanceTicket } from '../lib/maintenance-list.ts';
import { canCreateIncident, parseIncidentCreationRequest } from '../lib/incident-report.ts';
import { validateMaintenanceLocation } from '../lib/brain/maintenance-location.ts';

test('AI-created canonical maintenance rows map into the live page model', () => {
  const ticket = normalizeMaintenanceTicket({
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Repair fridge seal',
    description: null,
    priority: 'high',
    status: 'open',
    location: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Main kitchen' }],
    assigned_to: [],
    due_date: null,
  });
  assert.equal(ticket?.title, 'Repair fridge seal');
  assert.equal(ticket?.status, 'open');
  assert.equal(ticket?.location, 'Main kitchen');
});

test('maintenance and incident GETs are centralized, company-scoped, and uncached', async () => {
  for (const routeName of ['maintenance', 'incidents']) {
    const route = await readFile(new URL(`../app/api/${routeName}/route.ts`, import.meta.url), 'utf8');
    const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
    assert.match(get, /authorizeCompanyApiRequestFromSupabase\(supabase\)/);
    assert.match(get, /authorization\.companyId/);
    assert.match(route, /private, no-store, max-age=0/);
    assert.match(route, /dynamic = 'force-dynamic'/);
  }
});

test('maintenance listing uses live profile and location columns and does not swallow query failures', async () => {
  const service = await readFile(new URL('../lib/maintenance.ts', import.meta.url), 'utf8');
  assert.match(service, /created_by:profiles\(id, full_name\)/);
  assert.doesNotMatch(service, /created_by:profiles\(id, email\)/);
  assert.match(service, /throw new Error\('MAINTENANCE_LIST_FAILED'/);
});

test('incident form accepts valid schema-backed input and rejects invalid enums or missing required fields', () => {
  const valid = parseIncidentCreationRequest({ action: 'create', data: {
    title: 'Guest slipped', description: 'Guest slipped near the entrance.',
    incidentType: 'guest_injury', severity: 'high', affectedArea: 'Entrance',
    incidentTime: '2026-07-20T20:30',
  } });
  assert.equal(valid?.incidentType, 'guest_injury');
  assert.equal(valid?.severity, 'high');
  assert.equal(parseIncidentCreationRequest({ action: 'create', data: { title: '', description: '' } }), null);
  assert.equal(parseIncidentCreationRequest({ action: 'create', data: {
    title: 'Bad enum', description: 'Description', incidentType: 'invented',
    severity: 'extreme', incidentTime: '2026-07-20T20:30',
  } }), null);
});

test('incident mutation authority is role-bound and client identity fields are not parsed', () => {
  assert.equal(canCreateIncident('super_admin'), true);
  assert.equal(canCreateIncident('owner'), true);
  assert.equal(canCreateIncident('manager'), true);
  assert.equal(canCreateIncident('employee'), true);
  const parsed = parseIncidentCreationRequest({ action: 'create', data: {
    title: 'Test', description: 'Valid details', incidentTime: '2026-07-20T20:30',
    company_id: 'attacker', role: 'super_admin', reported_by_id: 'attacker',
  } });
  assert.ok(parsed);
  assert.equal('company_id' in parsed, false);
  assert.equal('reported_by_id' in parsed, false);
  assert.equal('status' in parsed, false);
});

test('incident INSERT policy binds active canonical reporters, tenant, location, and initial status', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202607210004_incident_reporter_insert_policy.sql', import.meta.url), 'utf8');
  assert.match(sql, /FOR INSERT\s+TO authenticated/);
  assert.match(sql, /pr\.id = auth\.uid\(\)/);
  assert.match(sql, /reported_by_id = auth\.uid\(\)/);
  assert.match(sql, /pr\.status = 'active'/);
  assert.match(sql, /pr\.role IN \('employee', 'manager', 'owner', 'super_admin'\)/);
  assert.match(sql, /pr\.company_id = public\.incident_reports\.company_id/);
  assert.match(sql, /loc\.company_id = public\.incident_reports\.company_id/);
  assert.match(sql, /public\.incident_reports\.status = 'open'/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /FOR (SELECT|UPDATE|DELETE)|incident_reports_(select|update|delete)/i);
});

test('incident POST derives company, reporter, and initial status server-side', async () => {
  const route = await readFile(new URL('../app/api/incidents/route.ts', import.meta.url), 'utf8');
  const service = await readFile(new URL('../lib/incidents.ts', import.meta.url), 'utf8');
  const post = route.slice(route.indexOf('export async function POST'), route.indexOf('export async function PATCH'));
  assert.match(post, /authorization\.companyId/);
  assert.match(post, /authorization\.profileId/);
  assert.match(post, /\.eq\('company_id', authorization\.companyId\)/);
  assert.match(service, /reported_by_id: reportedByUserId/);
  assert.match(service, /status: 'open'/);
});

test('maintenance location validation permits null and same-company locations', async () => {
  const company = '11111111-1111-4111-8111-111111111111';
  const location = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(await validateMaintenanceLocation(null, company, async () => false), { valid: true, locationId: null });
  assert.deepEqual(
    await validateMaintenanceLocation(location, company, async (candidate, tenant) => candidate === location && tenant === company),
    { valid: true, locationId: location },
  );
});

test('maintenance location validation rejects nonexistent and cross-company locations', async () => {
  const company = '11111111-1111-4111-8111-111111111111';
  const location = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(await validateMaintenanceLocation(location, company, async () => false), { valid: false, locationId: null });
  assert.deepEqual(
    await validateMaintenanceLocation(location, company, async (_candidate, tenant) => tenant === '33333333-3333-4333-8333-333333333333'),
    { valid: false, locationId: null },
  );
});

test('Brain maintenance validates location before preview and insertion using trusted company scope', async () => {
  const route = await readFile(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  const method = route.slice(route.indexOf('async createMaintenanceTicket'), route.indexOf('async updateMaintenanceTicket'));
  assert.ok(method.indexOf('validateMaintenanceLocation') < method.indexOf('if (!params.confirmed)'));
  assert.match(method, /\.eq\('company_id', companyId\)/);
  assert.match(method, /location_id: location\.locationId/);
  assert.match(method, /Location is not available for this company/);
});

test('Report incident opens a real form and successful POST refreshes the live list', async () => {
  const page = await readFile(new URL('../app/dashboard/incidents/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /onClick=\{\(\) => \{ setForm/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /method: 'POST'/);
  assert.match(page, /await loadIncidents\(\)/);
  assert.doesNotMatch(page, /mock|demo/i);
});

test('incident POST uses centralized authority and no obsolete profile user_id lookup', async () => {
  const route = await readFile(new URL('../app/api/incidents/route.ts', import.meta.url), 'utf8');
  const post = route.slice(route.indexOf('export async function POST'), route.indexOf('export async function PATCH'));
  assert.match(post, /authorizeCompanyApiRequestFromSupabase\(supabase\)/);
  assert.match(post, /authorization\.companyId/);
  assert.match(post, /authorization\.profileId/);
  assert.doesNotMatch(post, /\.eq\(['"]user_id['"]/);
  assert.match(post, /status: 403/);
  assert.match(post, /status: 400/);
});
