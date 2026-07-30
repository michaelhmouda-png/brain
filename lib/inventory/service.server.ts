import 'server-only';

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorContext } from '@/lib/brain/kernel/actor-context';
import {
  INVENTORY_UNITS,
  boundedText,
  isUuid,
  oneOf,
  parseInventoryQuantity,
  type InventoryItemInput,
  type InventoryMovementInput,
  type InventoryStockRow,
  type InventoryTransferInput,
} from './contracts';

export const canManageInventory = (role: string) =>
  role === 'manager' || role === 'owner' || role === 'super_admin';

function exactObject(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVENTORY_INPUT_INVALID');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !keys.includes(key))) throw new Error('INVENTORY_INPUT_INVALID');
  return row;
}

function optionalQuantity(value: unknown) {
  return value === undefined || value === null || value === '' ? null : parseInventoryQuantity(value);
}

export function parseInventoryItem(value: unknown): InventoryItemInput {
  const row = exactObject(value, [
    'name', 'description', 'category', 'canonicalUnit', 'sku', 'barcode', 'defaultLowStockThreshold',
  ]);
  if (!oneOf(INVENTORY_UNITS, row.canonicalUnit)) throw new Error('INVENTORY_UNIT_INVALID');
  return {
    name: boundedText(row.name, 160, true)!,
    description: boundedText(row.description, 2000),
    category: boundedText(row.category, 80, true)!,
    canonicalUnit: row.canonicalUnit,
    sku: boundedText(row.sku, 80),
    barcode: boundedText(row.barcode, 128),
    defaultLowStockThreshold: optionalQuantity(row.defaultLowStockThreshold),
  };
}

export function parseInventoryMovement(value: unknown): InventoryMovementInput {
  const row = exactObject(value, [
    'idempotencyKey', 'locationId', 'storageAreaId', 'inventoryItemId',
    'type', 'quantity', 'reason',
  ]);
  const allowedTypes = [
    'opening_balance', 'receipt', 'usage', 'waste', 'adjustment_increase', 'adjustment_decrease',
  ] as const;
  if (!isUuid(row.idempotencyKey) || !isUuid(row.locationId)
      || !isUuid(row.storageAreaId) || !isUuid(row.inventoryItemId)
      || !oneOf(allowedTypes, row.type)) {
    throw new Error('INVENTORY_INPUT_INVALID');
  }
  return {
    idempotencyKey: row.idempotencyKey,
    locationId: row.locationId,
    storageAreaId: row.storageAreaId,
    inventoryItemId: row.inventoryItemId,
    type: row.type,
    quantity: parseInventoryQuantity(row.quantity, { positive: true }),
    reason: boundedText(row.reason, 1000),
    sourceType: 'manual',
    sourceId: null,
  };
}

export function parseInventoryTransfer(value: unknown): InventoryTransferInput {
  const row = exactObject(value, [
    'idempotencyKey', 'locationId', 'sourceStorageAreaId',
    'destinationStorageAreaId', 'inventoryItemId', 'quantity', 'reason',
  ]);
  if (!isUuid(row.idempotencyKey) || !isUuid(row.locationId)
      || !isUuid(row.sourceStorageAreaId) || !isUuid(row.destinationStorageAreaId)
      || !isUuid(row.inventoryItemId)
      || row.sourceStorageAreaId === row.destinationStorageAreaId) {
    throw new Error('INVENTORY_TRANSFER_INVALID');
  }
  return {
    idempotencyKey: row.idempotencyKey,
    locationId: row.locationId,
    sourceStorageAreaId: row.sourceStorageAreaId,
    destinationStorageAreaId: row.destinationStorageAreaId,
    inventoryItemId: row.inventoryItemId,
    quantity: parseInventoryQuantity(row.quantity, { positive: true }),
    reason: boundedText(row.reason, 1000),
  };
}

function requestHash(value: object) {
  const normalized = Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
}

function oneRow(data: unknown) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('INVENTORY_OPERATION_FAILED');
  return row;
}

export async function listInventory(
  authenticated: SupabaseClient,
  actor: ActorContext,
  filters: { locationId?: string; storageAreaId?: string; search?: string; category?: string; lowOnly?: boolean },
) {
  if (!canManageInventory(actor.role)) throw new Error('INVENTORY_FORBIDDEN');
  if (filters.locationId && !isUuid(filters.locationId)
      || filters.storageAreaId && !isUuid(filters.storageAreaId)) throw new Error('INVENTORY_INPUT_INVALID');
  const { data, error } = await authenticated.rpc('list_inventory_stock', {
    p_location_id: filters.locationId ?? null,
    p_storage_area_id: filters.storageAreaId ?? null,
    p_search: filters.search?.trim().slice(0, 160) || null,
    p_category: filters.category?.trim().slice(0, 80) || null,
    p_low_stock_only: filters.lowOnly ?? false,
    p_limit: 500,
  });
  if (error) throw new Error('INVENTORY_UNAVAILABLE');
  return (Array.isArray(data) ? data : []) as InventoryStockRow[];
}

export async function createInventoryItem(service: SupabaseClient, actor: ActorContext, input: InventoryItemInput) {
  if (!canManageInventory(actor.role)) throw new Error('INVENTORY_FORBIDDEN');
  const { data, error } = await service.rpc('create_inventory_item', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId,
    p_name: input.name, p_description: input.description, p_category: input.category,
    p_canonical_unit: input.canonicalUnit, p_sku: input.sku, p_barcode: input.barcode,
    p_default_low_stock_threshold: input.defaultLowStockThreshold,
  });
  if (error) throw new Error(error.code === '23505' ? 'INVENTORY_ITEM_DUPLICATE' : 'INVENTORY_OPERATION_FAILED');
  return oneRow(data);
}

export async function updateInventoryItem(
  service: SupabaseClient,
  actor: ActorContext,
  itemId: string,
  input: InventoryItemInput & { status: 'active'|'inactive' },
) {
  if (!canManageInventory(actor.role) || !isUuid(itemId)) throw new Error('INVENTORY_FORBIDDEN');
  const { data, error } = await service.rpc('update_inventory_item', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId, p_item_id: itemId,
    p_name: input.name, p_description: input.description, p_category: input.category,
    p_canonical_unit: input.canonicalUnit, p_sku: input.sku, p_barcode: input.barcode,
    p_status: input.status, p_default_low_stock_threshold: input.defaultLowStockThreshold,
  });
  if (error) throw new Error(normalizeInventoryDatabaseError(error));
  return oneRow(data);
}

export async function createStorageArea(
  service: SupabaseClient, actor: ActorContext,
  input: { locationId: string; name: string; description: string | null },
) {
  if (!canManageInventory(actor.role) || !isUuid(input.locationId)) throw new Error('INVENTORY_FORBIDDEN');
  const { data, error } = await service.rpc('create_inventory_storage_area', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId, p_location_id: input.locationId,
    p_name: boundedText(input.name, 160, true), p_description: boundedText(input.description, 1000),
  });
  if (error) throw new Error(error.code === '23505' ? 'INVENTORY_STORAGE_AREA_DUPLICATE' : 'INVENTORY_OPERATION_FAILED');
  return oneRow(data);
}

export async function setStorageAreaStatus(
  service: SupabaseClient, actor: ActorContext, storageAreaId: string, status: 'active'|'inactive',
) {
  if (!canManageInventory(actor.role) || !isUuid(storageAreaId)) throw new Error('INVENTORY_FORBIDDEN');
  const { data, error } = await service.rpc('set_inventory_storage_area_status', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId,
    p_storage_area_id: storageAreaId, p_status: status,
  });
  if (error) throw new Error(normalizeInventoryDatabaseError(error));
  return oneRow(data);
}

export async function recordMovement(service: SupabaseClient, actor: ActorContext, input: InventoryMovementInput) {
  if (!canManageInventory(actor.role)) throw new Error('INVENTORY_FORBIDDEN');
  const { data, error } = await service.rpc('record_inventory_movement', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId,
    p_location_id: input.locationId, p_storage_area_id: input.storageAreaId,
    p_inventory_item_id: input.inventoryItemId, p_movement_type: input.type,
    p_quantity: input.quantity, p_reason: input.reason, p_idempotency_key: input.idempotencyKey,
    p_request_hash: requestHash(input), p_correlation_id: actor.correlationId,
    p_source_type: input.sourceType ?? 'manual', p_source_id: input.sourceId,
  });
  if (error) throw new Error(normalizeInventoryDatabaseError(error));
  return oneRow(data);
}

export async function transferStock(service: SupabaseClient, actor: ActorContext, input: InventoryTransferInput) {
  if (!canManageInventory(actor.role)) throw new Error('INVENTORY_FORBIDDEN');
  const { data, error } = await service.rpc('transfer_inventory_stock', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId,
    p_location_id: input.locationId, p_source_storage_area_id: input.sourceStorageAreaId,
    p_destination_storage_area_id: input.destinationStorageAreaId,
    p_inventory_item_id: input.inventoryItemId, p_quantity: input.quantity,
    p_reason: input.reason, p_idempotency_key: input.idempotencyKey,
    p_request_hash: requestHash(input), p_correlation_id: actor.correlationId,
  });
  if (error) throw new Error(normalizeInventoryDatabaseError(error));
  return oneRow(data);
}

export async function createCountSession(
  service: SupabaseClient,
  actor: ActorContext,
  input: {
    locationId: string;
    storageAreaId: string;
    assignedEmployeeId: string | null;
    notes: string | null;
  },
) {
  if (!canManageInventory(actor.role)
      || !isUuid(input.locationId) || !isUuid(input.storageAreaId)
      || input.assignedEmployeeId !== null && !isUuid(input.assignedEmployeeId)) {
    throw new Error('INVENTORY_FORBIDDEN');
  }
  const { data, error } = await service.rpc('create_inventory_count_session', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId,
    p_location_id: input.locationId, p_storage_area_id: input.storageAreaId,
    p_assigned_employee_id: input.assignedEmployeeId,
    p_notes: boundedText(input.notes, 1000), p_correlation_id: actor.correlationId,
  });
  if (error) throw new Error(normalizeInventoryDatabaseError(error));
  return oneRow(data);
}

export function parseCountLines(value: unknown) {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('INVENTORY_COUNT_LINE_INVALID');
  return value.map((entry) => {
    const row = exactObject(entry, ['lineId', 'countedQuantity', 'damagedQuantity', 'note']);
    if (!isUuid(row.lineId)) throw new Error('INVENTORY_COUNT_LINE_INVALID');
    return {
      lineId: row.lineId,
      countedQuantity: parseInventoryQuantity(row.countedQuantity),
      damagedQuantity: row.damagedQuantity === null || row.damagedQuantity === undefined || row.damagedQuantity === ''
        ? null : parseInventoryQuantity(row.damagedQuantity),
      note: boundedText(row.note, 500),
    };
  });
}

export async function updateCountSession(
  service: SupabaseClient,
  actor: ActorContext,
  sessionId: string,
  action: 'start'|'save'|'submit'|'cancel',
  lines: ReturnType<typeof parseCountLines> | null,
) {
  if (!isUuid(sessionId)) throw new Error('INVENTORY_INPUT_INVALID');
  const { data, error } = await service.rpc('update_inventory_count', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId,
    p_session_id: sessionId, p_action: action, p_lines: lines,
  });
  if (error) throw new Error(normalizeInventoryDatabaseError(error));
  return oneRow(data);
}

export async function approveCountSession(
  service: SupabaseClient, actor: ActorContext, sessionId: string, idempotencyKey: string,
) {
  if (!canManageInventory(actor.role) || !isUuid(sessionId) || !isUuid(idempotencyKey)) {
    throw new Error('INVENTORY_FORBIDDEN');
  }
  const hash = requestHash({ sessionId, action: 'approve' });
  const { data, error } = await service.rpc('approve_inventory_count', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId,
    p_session_id: sessionId, p_idempotency_key: idempotencyKey,
    p_request_hash: hash, p_correlation_id: actor.correlationId,
  });
  if (error) throw new Error(normalizeInventoryDatabaseError(error));
  return oneRow(data);
}

export async function setLowStockThreshold(
  service: SupabaseClient,
  actor: ActorContext,
  input: { locationId: string; storageAreaId: string; inventoryItemId: string; threshold: string },
) {
  if (!canManageInventory(actor.role) || !isUuid(input.locationId)
      || !isUuid(input.storageAreaId) || !isUuid(input.inventoryItemId)) {
    throw new Error('INVENTORY_FORBIDDEN');
  }
  const { data, error } = await service.rpc('set_inventory_low_stock_threshold', {
    p_actor_profile_id: actor.profileId, p_company_id: actor.companyId,
    p_location_id: input.locationId, p_storage_area_id: input.storageAreaId,
    p_inventory_item_id: input.inventoryItemId,
    p_threshold: parseInventoryQuantity(input.threshold),
  });
  if (error) throw new Error(normalizeInventoryDatabaseError(error));
  return oneRow(data);
}

export function normalizeInventoryDatabaseError(error: { code?: string; message?: string }) {
  const message = error.message ?? '';
  const allowed = [
    'INVENTORY_INPUT_INVALID', 'INVENTORY_UNIT_INVALID', 'INVENTORY_FORBIDDEN',
    'INVENTORY_LOCATION_INVALID', 'INVENTORY_STORAGE_AREA_INVALID', 'INVENTORY_ITEM_INVALID',
    'INVENTORY_ITEM_NOT_FOUND', 'INVENTORY_STORAGE_AREA_NOT_FOUND',
    'INVENTORY_INSUFFICIENT_STOCK', 'INVENTORY_IDEMPOTENCY_CONFLICT',
    'INVENTORY_OPENING_BALANCE_EXISTS',
    'INVENTORY_TRANSFER_INVALID', 'INVENTORY_TRANSFER_SCOPE_INVALID',
    'INVENTORY_COUNT_FORBIDDEN', 'INVENTORY_COUNT_NOT_FOUND',
    'INVENTORY_COUNT_TRANSITION_INVALID', 'INVENTORY_COUNT_NOT_EDITABLE',
    'INVENTORY_COUNT_STALE', 'INVENTORY_ITEM_UNIT_IMMUTABLE',
  ];
  return allowed.find((code) => message.includes(code)) ?? 'INVENTORY_OPERATION_FAILED';
}

export function normalizeInventoryError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const allowed = [
    'INVENTORY_INPUT_INVALID', 'INVENTORY_QUANTITY_INVALID', 'INVENTORY_UNIT_INVALID',
    'INVENTORY_FORBIDDEN', 'INVENTORY_ITEM_DUPLICATE', 'INVENTORY_STORAGE_AREA_DUPLICATE',
    'INVENTORY_LOCATION_INVALID', 'INVENTORY_STORAGE_AREA_INVALID', 'INVENTORY_ITEM_INVALID',
    'INVENTORY_ITEM_NOT_FOUND', 'INVENTORY_STORAGE_AREA_NOT_FOUND',
    'INVENTORY_INSUFFICIENT_STOCK', 'INVENTORY_IDEMPOTENCY_CONFLICT',
    'INVENTORY_OPENING_BALANCE_EXISTS',
    'INVENTORY_TRANSFER_INVALID', 'INVENTORY_TRANSFER_SCOPE_INVALID',
    'INVENTORY_COUNT_FORBIDDEN', 'INVENTORY_COUNT_NOT_FOUND',
    'INVENTORY_COUNT_TRANSITION_INVALID', 'INVENTORY_COUNT_NOT_EDITABLE',
    'INVENTORY_COUNT_STALE', 'INVENTORY_ITEM_UNIT_IMMUTABLE',
  ];
  return allowed.find((code) => message.includes(code)) ?? 'INVENTORY_UNAVAILABLE';
}
