import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  createAccountNotProvisionedResponse,
  resolveBrainChatProvisioning,
} from '../lib/brain/chat-provisioning.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

function validProfile(overrides = {}) {
  return {
    id: USER_ID,
    full_name: 'Provisioned User',
    role: 'employee',
    status: 'active',
    company_id: COMPANY_ID,
    ...overrides,
  };
}

function accessFor(profile, options = {}) {
  const calls = { profileReads: 0, companyReads: 0, companyIds: [] };
  const access = {
    async loadProfile(userId) {
      calls.profileReads += 1;
      assert.equal(userId, USER_ID);
      return { profile, failed: options.profileFailed === true };
    },
    async companyExists(companyId) {
      calls.companyReads += 1;
      calls.companyIds.push(companyId);
      return options.companyExists !== false;
    },
  };
  return { access, calls };
}

async function assertDenied(profile, options = {}) {
  const { access, calls } = accessFor(profile, options);
  const result = await resolveBrainChatProvisioning(USER_ID, access);
  assert.deepEqual(result, {
    authorized: false,
    code: 'ACCOUNT_NOT_PROVISIONED',
  });
  return calls;
}

describe('Stage 0B Brain chat provisioning boundary', () => {
  test('denies an authenticated user without a profile without querying a company', async () => {
    const calls = await assertDenied(null);
    assert.deepEqual(calls, { profileReads: 1, companyReads: 0, companyIds: [] });
  });

  test('denies an inactive profile before tenant access', async () => {
    const calls = await assertDenied(validProfile({ status: 'inactive' }));
    assert.equal(calls.companyReads, 0);
  });

  test('denies a profile without a company assignment', async () => {
    const calls = await assertDenied(validProfile({ company_id: null }));
    assert.equal(calls.companyReads, 0);
  });

  test('denies an invalid persisted company identifier', async () => {
    const calls = await assertDenied(validProfile({ company_id: 'first-company' }));
    assert.equal(calls.companyReads, 0);
  });

  test('denies an invalid persisted role without creating a replacement role', async () => {
    const calls = await assertDenied(validProfile({ role: 'administrator' }));
    assert.equal(calls.companyReads, 0);
  });

  test('denies a profile that is not linked to the authenticated identity', async () => {
    const calls = await assertDenied(
      validProfile({ id: '33333333-3333-4333-8333-333333333333' })
    );
    assert.equal(calls.companyReads, 0);
  });

  test('denies profile lookup failures without attempting recovery', async () => {
    const calls = await assertDenied(null, { profileFailed: true });
    assert.equal(calls.companyReads, 0);
  });

  test('denies a persisted assignment whose exact company does not exist', async () => {
    const calls = await assertDenied(validProfile(), { companyExists: false });
    assert.deepEqual(calls.companyIds, [COMPANY_ID]);
  });

  test('continues only for a valid active profile and its exact persisted company', async () => {
    const profile = validProfile({ role: 'manager' });
    const { access, calls } = accessFor(profile);
    const result = await resolveBrainChatProvisioning(USER_ID, access);

    assert.equal(result.authorized, true);
    assert.deepEqual(result.authorized ? result.profile : null, profile);
    assert.deepEqual(calls.companyIds, [COMPANY_ID]);
  });

  test('caller context cannot override persisted tenant, role, or identity authority', async () => {
    const callerInput = {
      company_id: '44444444-4444-4444-8444-444444444444',
      role: 'owner',
      profile_id: '55555555-5555-4555-8555-555555555555',
      context: { company_id: '66666666-6666-4666-8666-666666666666' },
    };
    const { access, calls } = accessFor(validProfile());

    const result = await resolveBrainChatProvisioning(USER_ID, access);

    assert.equal(result.authorized, true);
    assert.deepEqual(calls.companyIds, [COMPANY_ID]);
    assert.notEqual(result.authorized ? result.profile.company_id : null, callerInput.company_id);
    assert.notEqual(result.authorized ? result.profile.role : null, callerInput.role);
    assert.notEqual(result.authorized ? result.profile.id : null, callerInput.profile_id);
  });

  test('denial response is stable and exposes no tenant or profile diagnostics', async () => {
    const response = createAccountNotProvisionedResponse();
    const body = await response.text();

    assert.equal(response.status, 403);
    assert.deepEqual(JSON.parse(body), {
      error: 'This account is not fully provisioned. Contact your administrator.',
      code: 'ACCOUNT_NOT_PROVISIONED',
    });
    for (const sensitive of ['company_id', 'profile', 'role', 'database', 'Supabase']) {
      assert.equal(body.includes(sensitive), false);
    }
  });

  test('the active route validates provisioning before request, OpenAI, or tools', () => {
    const route = readFileSync(
      new URL('../app/api/brain/chat/route.ts', import.meta.url),
      'utf8'
    );
    const handlerStart = route.indexOf('export async function POST');
    const provisioningStart = route.indexOf(
      'const provisioning = await resolveBrainChatProvisioning',
      handlerStart
    );
    const requestRead = route.indexOf('await request.json()', provisioningStart);
    const openAiInitialization = route.indexOf('const openai = new OpenAI', provisioningStart);
    const toolInitialization = route.indexOf('const handlers = new ToolHandlers', provisioningStart);
    const boundary = route.slice(provisioningStart, requestRead);

    assert.ok(handlerStart >= 0);
    assert.ok(provisioningStart > handlerStart);
    assert.ok(requestRead > provisioningStart);
    assert.ok(openAiInitialization > requestRead);
    assert.ok(toolInitialization > openAiInitialization);
    assert.equal(boundary.includes('.limit(1)'), false);
    assert.equal(boundary.includes('.insert('), false);
    assert.equal(boundary.includes('.update('), false);
    assert.equal(boundary.includes('pendingAction'), false);
  });
});
