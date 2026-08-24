import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationPath = 'supabase/migrations/202608240001_delivery_health_semantics_repair.sql';

function deliveryDeadLetterPredicate({ status, failureCode, subscriptionRevoked }) {
  return status === 'failed' && !(failureCode === 'SUBSCRIPTION_EXPIRED' && subscriptionRevoked);
}

test('revoked expired-subscription history is not an actionable delivery dead letter', async () => {
  const sql = await read(migrationPath);
  assert.equal(deliveryDeadLetterPredicate({ status:'failed', failureCode:'SUBSCRIPTION_EXPIRED', subscriptionRevoked:true }), false);
  assert.match(sql, /delivery\.last_failure_code IS NOT DISTINCT FROM 'SUBSCRIPTION_EXPIRED'[\s\S]*subscription\.id=delivery\.subscription_id[\s\S]*subscription\.company_id=delivery\.company_id[\s\S]*subscription\.revoked_at IS NOT NULL/);
});

test('expired-subscription failure remains unhealthy while its subscription is active', () => {
  assert.equal(deliveryDeadLetterPredicate({ status:'failed', failureCode:'SUBSCRIPTION_EXPIRED', subscriptionRevoked:false }), true);
});

test('other genuine failed deliveries remain dead letters', () => {
  assert.equal(deliveryDeadLetterPredicate({ status:'failed', failureCode:'PUSH_DELIVERY_FAILED', subscriptionRevoked:false }), true);
  assert.equal(deliveryDeadLetterPredicate({ status:'failed', failureCode:'PUSH_DELIVERY_FAILED', subscriptionRevoked:true }), true);
  assert.equal(deliveryDeadLetterPredicate({ status:'failed', failureCode:null, subscriptionRevoked:true }), true);
});

test('pending and retrying delivery queue-age semantics remain unchanged', async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /'pending',\(SELECT count\(\*\) FROM public\.notification_delivery_jobs WHERE status='pending'\)/);
  assert.match(sql, /'retrying',\(SELECT count\(\*\) FROM public\.notification_delivery_jobs WHERE status='pending' AND attempt_count>0\)/);
  assert.match(sql, /'oldestPendingAt',\(SELECT min\(created_at\) FROM public\.notification_delivery_jobs WHERE status='pending'\)/);
});

test('evidence dead-letter semantics and every non-delivery RPC expression remain unchanged', async () => {
  const [previous, current] = await Promise.all([
    read('supabase/migrations/202608100001_stage1b_production_health_semantics_repair.sql'),
    read(migrationPath),
  ]);
  const functionBody = (sql) => sql.match(/CREATE OR REPLACE FUNCTION public\.get_system_worker_health_v1\(\)[\s\S]*?\n\$\$;/)?.[0];
  const previousBody = functionBody(previous);
  const currentBody = functionBody(current);
  assert.ok(previousBody && currentBody);
  const currentDelivery = /'deadLetter',\(SELECT count\(\*\)\n          FROM public\.notification_delivery_jobs delivery[\s\S]*?            \)\),/;
  const normalizedCurrent = currentBody.replace(
    currentDelivery,
    "'deadLetter',(SELECT count(*) FROM public.notification_delivery_jobs WHERE status='failed'),",
  );
  const normalizeLines = (value) => value.replace(/\r\n/g, '\n');
  assert.equal(normalizeLines(normalizedCurrent), normalizeLines(previousBody));
  assert.match(current, /job\.status='failed'[\s\S]*evidence\.status <> 'human_approved'[\s\S]*task\.status NOT IN \('completed','cancelled'\)/);
  assert.doesNotMatch(current, /\b(?:UPDATE|DELETE|TRUNCATE|DROP)\b/);
  assert.match(current, /BEGIN;[\s\S]*COMMIT;\s*$/);
});
