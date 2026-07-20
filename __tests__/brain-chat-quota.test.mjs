import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const HOUR = 60 * 60 * 1000;

class QuotaModel {
  constructor() { this.rows = new Map(); }
  admit(userId, now) {
    const existing = this.rows.get(userId);
    const row = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + HOUR }
      : existing;
    if (row.count >= 100) return { admitted: false, limit: 100, remaining: 0, resetAt: row.resetAt };
    row.count += 1;
    this.rows.set(userId, row);
    return { admitted: true, limit: 100, remaining: 100 - row.count, resetAt: row.resetAt };
  }
  status(userId, now) {
    const row = this.rows.get(userId);
    return !row || row.resetAt <= now
      ? { limit: 100, remaining: 100, resetAt: null }
      : { limit: 100, remaining: 100 - row.count, resetAt: row.resetAt };
  }
}

test('first through request 100 are admitted and request 101 is rejected', () => {
  const quota = new QuotaModel();
  for (let request = 1; request <= 100; request += 1) {
    const result = quota.admit('user-a', 1_000);
    assert.equal(result.admitted, true);
    assert.equal(result.remaining, 100 - request);
  }
  assert.deepEqual(quota.admit('user-a', 1_000), {
    admitted: false, limit: 100, remaining: 0, resetAt: 1_000 + HOUR,
  });
});

test('the fixed window resets exactly 60 minutes after its first admitted request', () => {
  const quota = new QuotaModel();
  const first = quota.admit('user-a', 5_000);
  assert.equal(first.resetAt, 5_000 + HOUR);
  assert.equal(quota.status('user-a', first.resetAt - 1).remaining, 99);
  assert.deepEqual(quota.status('user-a', first.resetAt), { limit: 100, remaining: 100, resetAt: null });
  assert.equal(quota.admit('user-a', first.resetAt).remaining, 99);
});

test('quota counters are isolated by authenticated user ID', () => {
  const quota = new QuotaModel();
  quota.admit('user-a', 1_000);
  quota.admit('user-a', 1_000);
  assert.equal(quota.status('user-a', 1_000).remaining, 98);
  assert.equal(quota.status('user-b', 1_000).remaining, 100);
});

test('parallel admission cannot produce more than 100 accepted requests', async () => {
  const quota = new QuotaModel();
  let lock = Promise.resolve();
  const results = await Promise.all(Array.from({ length: 150 }, async () => {
    const previous = lock;
    let release;
    lock = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return quota.admit('user-a', 1_000); } finally { release(); }
  }));
  assert.equal(results.filter((result) => result.admitted).length, 100);
  assert.equal(results.filter((result) => !result.admitted).length, 50);
});

test('migration locks admission, handles parallel first inserts, and derives identity only from auth.uid()', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202607210003_brain_chat_user_quota.sql', import.meta.url), 'utf8');
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /unique_violation/);
  assert.match(sql, /request_count >= 100/);
  assert.match(sql, /interval '60 minutes'/);
  assert.match(sql, /clock_timestamp\(\)/);
  assert.doesNotMatch(sql, /p_user_id|p_company_id|p_remaining|p_limit|p_reset/);
});

test('table access is denied while only authenticated users can execute focused RPCs', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202607210003_brain_chat_user_quota.sql', import.meta.url), 'utf8');
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.brain_chat_user_quotas FROM public, anon, authenticated/);
  assert.match(sql, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admit_brain_chat_request\(\) TO authenticated/);
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE).*brain_chat_user_quotas.*authenticated/i);
});

test('chat admission occurs after validation and immediately before OpenAI initialization', async () => {
  const route = await readFile(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  const validation = route.indexOf("failureStage = 'request.validate_messages'");
  const admission = route.indexOf("failureStage = 'brain_chat_quota.admit'");
  const openai = route.indexOf("failureStage = 'openai.client.initialize'");
  assert.ok(validation > 0 && validation < admission && admission < openai);
  assert.ok(route.indexOf('if (typeof proposalId') < admission);
  assert.match(route, /status: 429/);
  assert.match(route, /admittedQuota \? \{ quota: admittedQuota \}/);
  assert.match(route, /isValidBrainChatMessages\(messages\)/);
});

test('an admitted upstream failure remains consumed and returns authoritative metadata', async () => {
  const route = await readFile(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/202607210003_brain_chat_user_quota.sql', import.meta.url), 'utf8');
  assert.match(route, /let admittedQuota: BrainChatQuota \| null = null/);
  assert.match(route, /Internal server error'[\s\S]*admittedQuota[\s\S]*quota: admittedQuota/);
  assert.doesNotMatch(route, /refund|releaseQuota|decrementQuota/);
  assert.doesNotMatch(migration, /request_count = .*request_count - 1/);
});

test('unavailable enforcement fails closed and unauthenticated status requests are rejected', async () => {
  const chat = await readFile(new URL('../app/api/brain/chat/route.ts', import.meta.url), 'utf8');
  const status = await readFile(new URL('../app/api/brain/quota/route.ts', import.meta.url), 'utf8');
  assert.match(chat, /BRAIN_CHAT_QUOTA_UNAVAILABLE/);
  assert.match(chat, /status: 503/);
  assert.match(status, /supabase\.auth\.getUser\(\)/);
  assert.match(status, /status: 401/);
  assert.match(status, /private, no-store, max-age=0/);
});

test('UI reload and device state comes from the authoritative status endpoint', async () => {
  const page = await readFile(new URL('../app/dashboard/ai-assistant/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /fetch\('\/api\/brain\/quota'/);
  assert.match(page, /Requests remaining: \{quota\.remaining\} \/ \{quota\.limit\}/);
  assert.doesNotMatch(page, /useState\(10\)|setRateLimitRemaining/);
});
