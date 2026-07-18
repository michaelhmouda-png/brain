import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { POST as setupTestUser } from '../app/api/debug/setup-test-user/route.ts';
import { POST as applyTasksRls } from '../app/api/admin/apply-tasks-rls/route.ts';
import {
  GET as status,
  createStatusHandler,
} from '../app/api/debug/status/route.ts';

const originalNodeEnv = process.env.NODE_ENV;

function assertOpaqueNotFound(response) {
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-type'), null);
  return response.text().then((body) => assert.equal(body, ''));
}

describe('Stage 0A endpoint containment', () => {
  before(() => {
    process.env.NODE_ENV = 'production';
  });

  after(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test('production retires the service-role test-user endpoint', async () => {
    const response = await setupTestUser(
      new Request('http://localhost/api/debug/setup-test-user', {
        method: 'POST',
        body: JSON.stringify({
          email: 'attacker@example.com',
          password: 'not-used',
          role: 'manager',
        }),
      })
    );

    await assertOpaqueNotFound(response);
  });

  test('production retires the HTTP database-administration endpoint', async () => {
    const response = await applyTasksRls(
      new Request('http://localhost/api/admin/apply-tasks-rls', {
        method: 'POST',
        headers: { authorization: 'Bearer access-token-is-not-a-user-id' },
      })
    );

    await assertOpaqueNotFound(response);
  });

  test('production status guard runs before privileged dependencies', async () => {
    let privilegedClientLoads = 0;
    const guardedStatus = createStatusHandler(async () => {
      privilegedClientLoads += 1;
      throw new Error('privileged dependency must not load');
    });

    const response = await guardedStatus();

    await assertOpaqueNotFound(response);
    assert.equal(privilegedClientLoads, 0);
  });

  test('production status response exposes no diagnostics', async () => {
    const response = await status();
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.equal(body, '');
    assert.equal(body.includes('company'), false);
    assert.equal(body.includes('schema'), false);
    assert.equal(body.includes('Supabase'), false);
    assert.equal(body.includes('SQL'), false);
  });

  test('development status is available only to an authenticated user', async () => {
    process.env.NODE_ENV = 'development';
    let getUserCalls = 0;
    const developmentStatus = createStatusHandler(async () => ({
      auth: {
        async getUser() {
          getUserCalls += 1;
          return { data: { user: { id: 'authenticated-user' } }, error: null };
        },
      },
    }));

    const response = await developmentStatus();

    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(getUserCalls, 1);
    process.env.NODE_ENV = 'production';
  });

  test('development status hides itself from unauthorized users', async () => {
    process.env.NODE_ENV = 'development';
    const developmentStatus = createStatusHandler(async () => ({
      auth: {
        async getUser() {
          return { data: { user: null }, error: new Error('not authenticated') };
        },
      },
    }));

    const response = await developmentStatus();

    await assertOpaqueNotFound(response);
    process.env.NODE_ENV = 'production';
  });
});
