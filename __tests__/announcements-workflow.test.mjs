import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { canCreateAnnouncement, parseAnnouncementCreationRequest } from '../lib/announcement.ts';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('manual announcement creation is limited to canonical managers', () => {
  assert.equal(canCreateAnnouncement('super_admin'), true);
  assert.equal(canCreateAnnouncement('owner'), true);
  assert.equal(canCreateAnnouncement('manager'), true);
  assert.equal(canCreateAnnouncement('employee'), false);
});

test('announcement input uses only canonical schema-backed fields', () => {
  const parsed = parseAnnouncementCreationRequest({
    action: 'create',
    data: {
      title: '  Team briefing  ',
      content: '  Meet at reception.  ',
      priority: 'high',
      company_id: 'spoofed',
      created_by_id: 'spoofed',
      role: 'super_admin',
      status: 'published',
    },
  });
  assert.deepEqual(parsed, {
    title: 'Team briefing',
    content: 'Meet at reception.',
    priority: 'high',
    expiresAt: null,
  });
  assert.equal(parseAnnouncementCreationRequest({ action: 'create', data: { title: 'x', content: 'y', priority: 'HIGH' } }), null);
  assert.equal(parseAnnouncementCreationRequest({ action: 'create', data: { title: 'x', content: 'y', locationId: crypto.randomUUID() } }), null);
});

test('GET uses the centralized persisted company scope and is uncached', () => {
  const route = read('app/api/announcements/route.ts');
  assert.match(route, /authorizeCompanyApiRequestFromSupabase\(supabase\)/);
  assert.match(route, /new AnnouncementsService\(supabase, authorization\.companyId\)/);
  assert.match(route, /dynamic = 'force-dynamic'/);
  assert.match(route, /revalidate = 0/);
  assert.match(route, /private, no-store, max-age=0/);
});

test('invalid profile projection and swallowed list errors cannot return false empty data', () => {
  const service = read('lib/announcements.ts');
  assert.match(service, /created_by:profiles\(id, full_name\)/);
  assert.doesNotMatch(service, /created_by:profiles\(id, email\)/);
  assert.match(service, /throw new Error\('ANNOUNCEMENT_LIST_FAILED'/);
});

test('POST derives company and creator and rejects employee creation', () => {
  const route = read('app/api/announcements/route.ts');
  assert.match(route, /canCreateAnnouncement\(authorization\.role\)/);
  assert.match(route, /authorization\.companyId/);
  assert.match(route, /authorization\.profileId/);
  assert.doesNotMatch(route.slice(route.indexOf('export async function POST'), route.indexOf('export async function PATCH')), /\.eq\('user_id'/);
});

test('AI and manual creation write the same canonical announcements table', () => {
  const brain = read('app/api/brain/chat/route.ts');
  const service = read('lib/announcements.ts');
  const createStart = brain.indexOf('async createAnnouncement(params: CreateAnnouncementInput)');
  const createEnd = brain.indexOf('async updateAnnouncement', createStart);
  const aiCreate = brain.slice(createStart, createEnd);
  assert.match(aiCreate, /\.from\('announcements'\)/);
  assert.match(aiCreate, /company_id: this\.userCompanyId/);
  assert.match(aiCreate, /created_by_id: user\.id/);
  assert.match(aiCreate, /priority: params\.priority \|\| 'normal'/);
  assert.match(service, /\.from\('announcements'\)/);
});

test('page opens a real modal, posts canonical input, and refreshes after success', () => {
  const page = read('app/dashboard/announcements/page.tsx');
  assert.match(page, /setCreating\(true\)/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /method: 'POST'/);
  assert.match(page, /await loadAnnouncements\(\)/);
  assert.match(page, /Try again/);
  assert.match(page, /Refresh/);
  assert.doesNotMatch(page, /mock|demo announcement/i);
});

test('checked-in RLS preserves employee reads and manager-only mutation boundary', () => {
  const schema = read('hospibrain_phase1_schemas.sql');
  assert.match(schema, /CREATE POLICY announcements_select[\s\S]*private\.is_active_user\(\)/);
  assert.match(schema, /CREATE POLICY announcements_insert[\s\S]*private\.can_manage_company\(company_id\)/);
  const auth = read('auth_schema.sql');
  assert.match(auth, /current_user_role\(\) in \('owner', 'manager'\)/);
  assert.match(auth, /private\.is_super_admin\(\)/);
});
