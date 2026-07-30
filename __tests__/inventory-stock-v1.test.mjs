import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  INVENTORY_COUNT_STATUSES,
  INVENTORY_MOVEMENT_TYPES,
  INVENTORY_QUANTITY_RULES,
  INVENTORY_UNITS,
  parseInventoryQuantity,
  validateInventoryQuantityInput,
} from '../lib/inventory/contracts.ts';
import { inventoryMessages } from '../lib/inventory/i18n.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationPath = 'supabase/migrations/202607290001_inventory_stock_v1.sql';
const migration = read(migrationPath);
const service = read('lib/inventory/service.server.ts');
const inventoryRoute = read('app/api/inventory/route.ts');
const operationRoute = read('app/api/inventory/operations/route.ts');
const countRoute = read('app/api/inventory/counts/[id]/route.ts');
const ui = read('components/inventory/InventoryConsole.tsx');
const worker = read('lib/notification-worker.server.ts');
const brain = read('app/api/brain/chat/route.ts');
const c5 = read('supabase/migrations/202607280002_camera_evidence_c5_multi_photo_counts.sql');

test('migration is forward-only, empty-state safe, and collision free', () => {
  assert.match(migration, /^-- Inventory Stock V1/);
  assert.match(migration, /\bBEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN|SCHEMA)\b|\bTRUNCATE\b|\bDELETE FROM\b/i);
  const beforeFunctions = migration.slice(0, migration.indexOf('CREATE OR REPLACE FUNCTION'));
  assert.doesNotMatch(beforeFunctions, /INSERT INTO public\.inventory_items|INSERT INTO public\.inventory_count_sessions/);
  const names = readdirSync(new URL('../supabase/migrations', import.meta.url))
    .filter((name) => name.startsWith('202607290001'));
  assert.deepEqual(names, ['202607290001_inventory_stock_v1.sql']);
});

test('catalog uses controlled units, normalized company uniqueness, and immutable units after activity', () => {
  assert.deepEqual(INVENTORY_UNITS, ['piece','bag','bottle','case','box','pack','kilogram','gram','litre','millilitre']);
  assert.match(migration, /CREATE TABLE public\.inventory_items/);
  assert.match(migration, /normalized_name text GENERATED ALWAYS AS/);
  assert.match(migration, /inventory_items_company_name_uidx/);
  assert.match(migration, /inventory_items_company_sku_uidx[\s\S]+WHERE sku IS NOT NULL/);
  assert.match(migration, /inventory_items_company_barcode_uidx[\s\S]+WHERE barcode IS NOT NULL/);
  assert.match(migration, /INVENTORY_ITEM_UNIT_IMMUTABLE[\s\S]+public\.inventory_movements/);
  assert.match(migration, /status IN \('active','inactive'\)/);
});

test('quantity parsing rejects floats, exponent notation, negatives, excessive precision and oversized values', () => {
  assert.equal(parseInventoryQuantity('12.340000'), '12.34');
  assert.equal(parseInventoryQuantity('0.000001'), '0.000001');
  for (const invalid of [12.3, '1e3', '-1', '+2', '.5', '01', '1.0000001', '1000000000000', '', 'NaN']) {
    assert.throws(() => parseInventoryQuantity(invalid), /INVENTORY_QUANTITY_INVALID/);
  }
  assert.throws(() => parseInventoryQuantity('0', { positive: true }), /INVENTORY_QUANTITY_INVALID/);
  assert.doesNotMatch(service, /parseFloat|Number\(input\.quantity\)|Math\.(?:abs|round).*quantity/);
});

test('shared browser quantity validation accepts canonical decimals and rejects unsafe forms', () => {
  const valid = new Map([
    ['0', '0'],
    ['1', '1'],
    ['10', '10'],
    ['10.0', '10'],
    ['0.5', '0.5'],
    ['12.345678', '12.345678'],
  ]);
  for (const [input, expected] of valid) {
    assert.deepEqual(
      validateInventoryQuantityInput(input, { required: true }),
      { ok: true, value: expected },
    );
  }

  for (const invalid of [
    '-1',
    '1e3',
    '1E3',
    '1,000',
    '10 kg',
    '12.3456789',
    'NaN',
    'Infinity',
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.deepEqual(
      validateInventoryQuantityInput(invalid, { required: true }),
      { ok: false, code: 'INVENTORY_QUANTITY_INVALID' },
    );
  }

  assert.deepEqual(
    validateInventoryQuantityInput('', { required: true }),
    { ok: false, code: 'INVENTORY_QUANTITY_REQUIRED' },
  );
  assert.deepEqual(validateInventoryQuantityInput('', { required: false }), { ok: true, value: null });
  assert.deepEqual(validateInventoryQuantityInput(null, { required: false }), { ok: true, value: null });
  assert.deepEqual(
    validateInventoryQuantityInput('0', { required: true, positive: true }),
    { ok: false, code: 'INVENTORY_QUANTITY_POSITIVE_REQUIRED' },
  );
  assert.deepEqual(
    validateInventoryQuantityInput('0.5', { required: true, positive: true }),
    { ok: true, value: '0.5' },
  );
});

test('every Inventory decimal field uses the cross-browser parser and localized inline errors', () => {
  assert.match(ui, /function DecimalInput\(/);
  assert.match(ui, /type="text"[\s\S]+inputMode="decimal"/);
  assert.match(ui, /validateInventoryQuantityInput\(value, \{ required, positive \}\)/);
  assert.match(ui, /localizedQuantityError\(displayedError, language\)/);
  assert.match(ui, /aria-invalid=\{displayedError \? true : undefined\}/);
  assert.match(ui, /role="alert"/);
  assert.doesNotMatch(ui, /\bpattern=|\btype="number"|\bstep=|\bmin=/);

  assert.match(ui, /name="threshold"[\s\S]{0,180}errorCode=\{quantityErrors\.threshold\}/);
  assert.match(ui, /errorCode=\{quantityErrors\.detailThreshold\}/);
  assert.match(ui, /name="quantity"[\s\S]{0,260}INVENTORY_QUANTITY_RULES\.(?:movementQuantity|transferQuantity)/);
  assert.match(ui, /validateQuantity\('threshold', INVENTORY_QUANTITY_RULES\.itemThreshold\)/);
  assert.match(ui, /validateQuantity\('quantity', INVENTORY_QUANTITY_RULES\.movementQuantity\)/);
  assert.match(ui, /validateQuantity\('quantity', INVENTORY_QUANTITY_RULES\.transferQuantity\)/);
  assert.match(ui, /threshold: validation\.value/);
  assert.match(ui, /validateInventoryQuantityInput\(threshold, INVENTORY_QUANTITY_RULES\.lowStockThreshold\)/);
  assert.match(ui, /counted = validateInventoryQuantityInput[\s\S]+INVENTORY_QUANTITY_RULES\.countQuantity/);
  assert.match(ui, /damaged = validateInventoryQuantityInput[\s\S]+INVENTORY_QUANTITY_RULES\.damagedQuantity/);
  assert.ok(ui.includes('errorCode={quantityErrors[`${line.id}:counted`]}'));
  assert.ok(ui.includes('errorCode={quantityErrors[`${line.id}:damaged`]}'));

  for (const language of ['en', 'ar']) {
    for (const code of [
      'INVENTORY_QUANTITY_REQUIRED',
      'INVENTORY_QUANTITY_INVALID',
      'INVENTORY_QUANTITY_POSITIVE_REQUIRED',
    ]) {
      assert.ok(inventoryMessages[language].errors[code]);
    }
  }
});

test('field-specific Inventory decimal rules cover thresholds, operations, transfers, counts and damage', () => {
  const zeroAllowed = [
    'itemThreshold',
    'lowStockThreshold',
    'countQuantity',
    'damagedQuantity',
  ];
  for (const field of zeroAllowed) {
    assert.deepEqual(
      validateInventoryQuantityInput('0', INVENTORY_QUANTITY_RULES[field]),
      { ok: true, value: '0' },
    );
  }

  for (const field of ['movementQuantity', 'transferQuantity']) {
    assert.deepEqual(
      validateInventoryQuantityInput('0', INVENTORY_QUANTITY_RULES[field]),
      { ok: false, code: 'INVENTORY_QUANTITY_POSITIVE_REQUIRED' },
    );
    assert.deepEqual(
      validateInventoryQuantityInput('10.0', INVENTORY_QUANTITY_RULES[field]),
      { ok: true, value: '10' },
    );
  }

  assert.deepEqual(
    validateInventoryQuantityInput('', INVENTORY_QUANTITY_RULES.itemThreshold),
    { ok: true, value: null },
  );
  assert.deepEqual(
    validateInventoryQuantityInput('', INVENTORY_QUANTITY_RULES.damagedQuantity),
    { ok: true, value: null },
  );
  assert.deepEqual(
    validateInventoryQuantityInput('', INVENTORY_QUANTITY_RULES.lowStockThreshold),
    { ok: false, code: 'INVENTORY_QUANTITY_REQUIRED' },
  );
  assert.deepEqual(
    validateInventoryQuantityInput('', INVENTORY_QUANTITY_RULES.countQuantity),
    { ok: false, code: 'INVENTORY_QUANTITY_REQUIRED' },
  );
});

test('storage areas are normalized, active-location validated, tenant safe, and historical', () => {
  assert.match(migration, /CREATE TABLE public\.inventory_storage_areas/);
  assert.match(migration, /inventory_storage_areas_location_name_uidx/);
  assert.match(migration, /location\.id=p_location_id AND location\.company_id=p_company_id AND location\.status='active'/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.match(migration, /set_inventory_storage_area_status/);
});

test('ledger is authoritative, append-only, provenance-rich, and projection changes atomically', () => {
  assert.deepEqual(INVENTORY_MOVEMENT_TYPES, [
    'opening_balance','receipt','usage','waste','transfer_out','transfer_in',
    'adjustment_increase','adjustment_decrease','count_reconciliation',
  ]);
  assert.match(migration, /CREATE TABLE public\.inventory_movements/);
  assert.match(migration, /inventory_movements_append_only[\s\S]+BEFORE UPDATE OR DELETE/);
  assert.match(migration, /CREATE TABLE public\.inventory_balances/);
  assert.match(migration, /quantity numeric\(18, 6\) NOT NULL DEFAULT 0/);
  assert.match(migration, /quantity_delta numeric\(18, 6\)/);
  assert.match(migration, /operation_id uuid NOT NULL/);
  assert.match(migration, /actor_profile_id uuid NOT NULL/);
  assert.match(migration, /correlation_id uuid NOT NULL/);
  assert.match(migration, /source_type text/);
  const rpc = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.record_inventory_movement'));
  assert.match(rpc, /FOR UPDATE/);
  assert.match(rpc, /IF v_balance \+ v_delta < 0[\s\S]+INVENTORY_INSUFFICIENT_STOCK/);
  assert.match(rpc, /UPDATE public\.inventory_balances[\s\S]+INSERT INTO public\.inventory_movements/);
});

test('movement idempotency handles replay, conflict, and concurrent balance locking', () => {
  assert.match(migration, /CONSTRAINT inventory_operations_company_key UNIQUE \(company_id, idempotency_key\)/);
  assert.match(migration, /v_operation\.request_hash IS DISTINCT FROM p_request_hash[\s\S]+INVENTORY_IDEMPOTENCY_CONFLICT/);
  assert.match(migration, /RETURN QUERY[\s\S]+movement\.operation_id=v_operation\.id[\s\S]+true/);
  assert.match(service, /createHash\('sha256'\)/);
  assert.match(operationRoute, /crypto|idempotencyKey|parseInventoryMovement/);
  assert.doesNotMatch(operationRoute, /\.from\('inventory_balances'\)\.(?:insert|update|delete)/);
});

test('transfers create one locked operation and exactly matched atomic ledger movements', () => {
  const rpc = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.transfer_inventory_stock'), migration.indexOf('CREATE OR REPLACE FUNCTION public.create_inventory_count_session'));
  assert.match(rpc, /p_source_storage_area_id=p_destination_storage_area_id/);
  assert.match(rpc, /ORDER BY balance\.storage_area_id FOR UPDATE/);
  assert.match(rpc, /v_source<p_quantity[\s\S]+INVENTORY_INSUFFICIENT_STOCK/);
  assert.match(rpc, /'transfer_out',-p_quantity/);
  assert.match(rpc, /'transfer_in',p_quantity/);
  assert.match(migration, /inventory_movements_transfer_pair_uidx/);
});

test('count lifecycle, assignment, expected ownership, approval, and stale safety are database-owned', () => {
  assert.deepEqual(INVENTORY_COUNT_STATUSES, ['draft','counting','submitted','approved','cancelled']);
  assert.match(migration, /CREATE TABLE public\.inventory_count_sessions/);
  assert.match(migration, /CREATE TABLE public\.inventory_count_lines/);
  assert.match(migration, /expected_quantity numeric\(18, 6\) NOT NULL/);
  assert.match(migration, /variance numeric\(18, 6\) GENERATED ALWAYS/);
  assert.match(migration, /p\.role='employee' AND p\.employee_id=inventory_count_sessions\.assigned_employee_id/);
  assert.match(migration, /v_session\.assigned_employee_id<>v_profile\.employee_id[\s\S]+INVENTORY_COUNT_FORBIDDEN/);
  assert.match(migration, /v_profile\.role NOT IN \('manager','owner','super_admin'\)/);
  assert.match(migration, /v_current IS DISTINCT FROM v_line\.expected_quantity[\s\S]+INVENTORY_COUNT_STALE/);
  assert.match(migration, /inventory_movements_count_reconciliation_uidx/);
  assert.match(migration, /status='approved'[\s\S]+reconciliation_operation_id=v_operation\.id/);
  assert.doesNotMatch(countRoute, /expectedQuantity|companyId|employeeId|role/);
});

test('shared scope trigger is safe for every attached table and never accesses a missing NEW field', () => {
  const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION private.validate_inventory_scope'), migration.indexOf('CREATE TRIGGER inventory_storage_areas_scope'));
  assert.match(fn, /v_row jsonb := to_jsonb\(NEW\)/);
  assert.match(fn, /v_row ->> 'location_id'/);
  assert.match(fn, /v_row ->> 'storage_area_id'/);
  assert.match(fn, /v_row ->> 'inventory_item_id'/);
  assert.match(fn, /v_row ->> 'session_id'/);
  assert.doesNotMatch(fn, /NEW\.(?:location_id|storage_area_id|inventory_item_id|session_id)/);
  for (const table of ['inventory_storage_areas','inventory_count_sessions','inventory_count_lines','inventory_balances','inventory_movements','inventory_low_stock_thresholds','inventory_low_stock_conditions']) {
    assert.match(migration, new RegExp(`BEFORE INSERT OR UPDATE ON public\\.${table}[\\s\\S]{0,120}private\\.validate_inventory_scope`));
  }
});

test('RLS is forced, browser writes are absent, and focused service RPCs use hardened metadata', () => {
  const tables = ['inventory_items','inventory_storage_areas','inventory_operations','inventory_balances','inventory_movements','inventory_count_sessions','inventory_count_lines','inventory_low_stock_thresholds','inventory_low_stock_conditions'];
  for (const table of tables) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.doesNotMatch(migration, /CREATE POLICY [^\n]+ FOR (?:INSERT|UPDATE|DELETE) TO authenticated/);
  assert.match(migration, /REVOKE ALL ON TABLE[\s\S]+FROM PUBLIC,anon,authenticated/);
  assert.match(migration, /SECURITY DEFINER[\s\S]+SET search_path TO ''/);
  assert.doesNotMatch(migration, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_inventory_movement[\s\S]+TO service_role/);
  assert.match(inventoryRoute, /resolveActorContext\(authenticated\)/);
  assert.match(service, /p_actor_profile_id: actor\.profileId/);
  assert.match(service, /p_company_id: actor\.companyId/);
});

test('inactive, employee, unassigned, cross-company and cross-location actors fail closed', () => {
  assert.match(migration, /profile\.status = 'active'/);
  assert.match(migration, /profile\.role IN \('manager','owner','super_admin'\)/);
  assert.match(migration, /employee\.company_id=p_company_id[\s\S]+employee\.location_id=p_location_id[\s\S]+employee\.status='active'/);
  assert.match(migration, /area\.company_id=p_company_id[\s\S]+area\.location_id=p_location_id/);
  assert.match(inventoryRoute, /canManageInventory\(actor\.role\)/);
  assert.match(countRoute, /resolveActorContext\(authenticated\)/);
});

test('low stock uses effective threshold, deduplicates, recovers, and reuses existing worker', () => {
  assert.match(migration, /coalesce\(threshold\.threshold, item\.default_low_stock_threshold\)/);
  assert.match(migration, /inventory_low_stock_conditions_open_uidx[\s\S]+WHERE resolved_at IS NULL/);
  assert.match(migration, /'inventory\.low_stock:' \|\| v_condition_id::text/);
  assert.match(migration, /ON CONFLICT \(company_id, event_key\) DO NOTHING/);
  assert.match(migration, /resolution_reason = CASE[\s\S]+WHEN v_threshold IS NULL THEN 'threshold_removed'[\s\S]+ELSE 'recovered'/);
  assert.match(migration, /profile\.role IN \('manager','owner','super_admin'\)/);
  assert.match(migration, /Open HospiBrain Inventory to review the low-stock condition/);
  assert.doesNotMatch(migration, /CREATE EXTENSION.*pg_cron|cron\.schedule/);
  assert.match(worker, /materialize_inventory_low_stock_outbox/);
  assert.match(worker, /materialize_notification_outbox/);
});

test('localized dark responsive UI provides filters, actions, safe-area sheets and assigned counts', () => {
  assert.equal(Object.keys(inventoryMessages.en.units).length, INVENTORY_UNITS.length);
  assert.deepEqual(Object.keys(inventoryMessages.en), Object.keys(inventoryMessages.ar));
  assert.deepEqual(Object.keys(inventoryMessages.en.units), Object.keys(inventoryMessages.ar.units));
  assert.match(ui, /bg-slate-950|bg-\[linear-gradient/);
  assert.match(ui, /locationId/);
  assert.match(ui, /storageAreaId/);
  assert.match(ui, /lowOnly/);
  for (const label of ['addItem','addArea','receive','use','waste','transfer','adjust','startCount','history']) {
    assert.ok(label in inventoryMessages.en);
  }
  assert.match(ui, /max-h-\[min\(92dvh,760px\)\]/);
  assert.match(ui, /env\(safe-area-inset-bottom\)/);
  assert.match(ui, /overflow-y-auto/);
  assert.match(ui, /\[-webkit-overflow-scrolling:touch\]/);
  assert.match(ui, /dir="ltr"/);
  assert.match(ui, /data-testid="assigned-inventory-counts"/);
  assert.doesNotMatch(ui, /min-w-\[[4-9]\d\dpx\]|w-\[[4-9]\d\dpx\]/);
});

test('Brain reads canonical snapshots, scopes employees, and disables model-authored mutations', () => {
  assert.match(brain, /this\.supabase\.rpc\('list_inventory_stock'/);
  assert.match(brain, /source: 'inventory_stock_v1'/);
  assert.match(brain, /scope: 'assigned_counts_only'/);
  assert.match(brain, /INVENTORY_BRAIN_MUTATION_DISABLED/g);
  assert.match(brain, /disabledInventoryMutationTools[\s\S]+create_inventory_item[\s\S]+record_inventory_movement[\s\S]+update_inventory_item/);
  assert.match(brain, /const TOOLS = ALL_TOOLS\.filter\([\s\S]*!disabledInventoryMutationTools\.has\(tool\.name\)/);
  assert.doesNotMatch(service, /OpenAI|chat\.completions|responses\.create/);
  assert.doesNotMatch(migration, /brain_score|score_version/);
});

test('C5 bridge is deliberately deferred because no explicit item/storage link exists', () => {
  assert.match(c5, /task_evidence_count_requirements/);
  assert.doesNotMatch(c5, /inventory_item_id|storage_area_id/);
  assert.doesNotMatch(migration, /(?:FROM|JOIN|ON) public\.task_evidence/);
  assert.doesNotMatch(migration, /CREATE TRIGGER [^\n]*task_evidence/);
});

test('migration includes read-only verification queries and creates no business rows', () => {
  assert.match(migration, /Read-only post-apply verification queries/);
  assert.match(migration, /SELECT relname, relrowsecurity, relforcerowsecurity/);
  assert.match(migration, /SELECT p\.oid::regprocedure/);
  assert.match(migration, /HAVING balance\.quantity IS DISTINCT FROM coalesce\(sum\(movement\.quantity_delta\),0\)/);
});
