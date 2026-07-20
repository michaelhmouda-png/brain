import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { authorizeCompanyApiRequest } from '../lib/company-api-authorization.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

function accessFor({ role = 'employee', status = 'active', userId = USER_ID, companyId = COMPANY_ID, exists = true } = {}) {
  return {
    async getAuthenticatedUserId() {
      return userId;
    },
    async loadProfile(authUserId) {
      return {
        profile: {
          id: authUserId,
          company_id: companyId,
          role,
          status,
        },
        failed: false,
      };
    },
    async companyExists(candidate) {
      return exists && candidate === companyId;
    },
  };
}

for (const role of ['super_admin', 'owner', 'manager', 'employee']) {
  test(`${role} receives only the persisted active company scope`, async () => {
    const result = await authorizeCompanyApiRequest(accessFor({ role }));
    assert.deepEqual(result, {
      authorized: true,
      userId: USER_ID,
      profileId: USER_ID,
      companyId: COMPANY_ID,
      role,
      employeeId: null,
    });
  });
}

test('unauthenticated requests remain denied', async () => {
  const result = await authorizeCompanyApiRequest(accessFor({ userId: null }));
  assert.deepEqual(result, { authorized: false, status: 401, code: 'UNAUTHENTICATED' });
});

test('inactive users remain denied', async () => {
  const result = await authorizeCompanyApiRequest(accessFor({ status: 'inactive' }));
  assert.deepEqual(result, { authorized: false, status: 403, code: 'ACCOUNT_NOT_PROVISIONED' });
});

test('non-canonical role casing fails closed', async () => {
  const result = await authorizeCompanyApiRequest(accessFor({ role: 'Super_Admin' }));
  assert.deepEqual(result, { authorized: false, status: 403, code: 'ACCOUNT_NOT_PROVISIONED' });
});

test('missing or inaccessible persisted companies fail closed', async () => {
  const result = await authorizeCompanyApiRequest(accessFor({ exists: false }));
  assert.deepEqual(result, { authorized: false, status: 403, code: 'ACCOUNT_NOT_PROVISIONED' });
});

test('all four GET routes use the centralized resolver and no legacy user_id profile lookup', async () => {
  const routes = ['shifts', 'maintenance', 'incidents', 'announcements'];
  for (const route of routes) {
    const source = await readFile(new URL(`../app/api/${route}/route.ts`, import.meta.url), 'utf8');
    const getHandler = source.slice(source.indexOf('export async function GET'), source.indexOf('export async function POST'));
    assert.match(getHandler, /authorizeCompanyApiRequestFromSupabase\(supabase\)/);
    assert.doesNotMatch(getHandler, /\.eq\(['"]user_id['"]/);
    assert.match(getHandler, /authorization\.companyId/);
  }
});
