import assert from 'node:assert/strict';
import test from 'node:test';
import { ClientApiError, fetchJsonCollection } from '../lib/client-api.ts';

async function withFetch(responseFactory, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseFactory();
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('accepts a direct JSON array response', async () => {
  await withFetch(
    () => Response.json([{ id: 'one' }]),
    async () => {
      const result = await fetchJsonCollection('Test route', '/api/test', new AbortController().signal);
      assert.deepEqual(result, [{ id: 'one' }]);
    }
  );
});

test('accepts the paginated API data envelope used by operational services', async () => {
  await withFetch(
    () => Response.json({ data: [{ id: 'one' }], total: 1, page: 1 }),
    async () => {
      const result = await fetchJsonCollection('Test route', '/api/test', new AbortController().signal);
      assert.deepEqual(result, [{ id: 'one' }]);
    }
  );
});

test('rejects a non-JSON response before attempting JSON parsing', async () => {
  await withFetch(
    () => new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    async () => {
      await assert.rejects(
        fetchJsonCollection('Test route', '/api/test', new AbortController().signal),
        (error) => error instanceof ClientApiError && error.diagnostic.errorName === 'InvalidContentType'
      );
    }
  );
});

test('rejects authenticated API failures without treating the error object as a collection', async () => {
  await withFetch(
    () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    async () => {
      await assert.rejects(
        fetchJsonCollection('Test route', '/api/test', new AbortController().signal),
        (error) => error instanceof ClientApiError && error.diagnostic.status === 401
      );
    }
  );
});

test('rejects an unexpected successful object instead of allowing a later map crash', async () => {
  await withFetch(
    () => Response.json({ total: 0 }),
    async () => {
      await assert.rejects(
        fetchJsonCollection('Test route', '/api/test', new AbortController().signal),
        (error) => error instanceof ClientApiError && error.diagnostic.errorName === 'InvalidCollectionShape'
      );
    }
  );
});
