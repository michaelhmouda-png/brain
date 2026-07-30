export const INVENTORY_UNITS = [
  'piece', 'bag', 'bottle', 'case', 'box', 'pack',
  'kilogram', 'gram', 'litre', 'millilitre',
] as const;

export const INVENTORY_MOVEMENT_TYPES = [
  'opening_balance', 'receipt', 'usage', 'waste', 'transfer_out', 'transfer_in',
  'adjustment_increase', 'adjustment_decrease', 'count_reconciliation',
] as const;

export const INVENTORY_COUNT_STATUSES = [
  'draft', 'counting', 'submitted', 'approved', 'cancelled',
] as const;

export type InventoryUnit = (typeof INVENTORY_UNITS)[number];
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];
export type InventoryCountStatus = (typeof INVENTORY_COUNT_STATUSES)[number];

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const oneOf = <T extends readonly string[]>(values: T, value: unknown): value is T[number] =>
  typeof value === 'string' && values.includes(value);

/**
 * Quantities cross the browser/server boundary as canonical decimal strings.
 * This prevents binary floating-point arithmetic from becoming stock authority.
 */
export function parseInventoryQuantity(value: unknown, options: { positive?: boolean; allowZero?: boolean } = {}) {
  if (typeof value !== 'string') throw new Error('INVENTORY_QUANTITY_INVALID');
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error('INVENTORY_QUANTITY_INVALID');
  }
  const [whole, fraction = ''] = normalized.split('.');
  const canonical = fraction ? `${whole}.${fraction.replace(/0+$/, '')}`.replace(/\.$/, '') : whole;
  if (options.positive && canonical === '0') throw new Error('INVENTORY_QUANTITY_INVALID');
  if (options.allowZero === false && canonical === '0') throw new Error('INVENTORY_QUANTITY_INVALID');
  return canonical;
}

export function boundedText(value: unknown, maximum: number, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('INVENTORY_INPUT_INVALID');
    return null;
  }
  if (typeof value !== 'string') throw new Error('INVENTORY_INPUT_INVALID');
  const text = value.trim();
  if (!text || text.length > maximum) throw new Error('INVENTORY_INPUT_INVALID');
  return text;
}

export type InventoryStockRow = {
  item_id: string;
  item_name: string;
  description: string | null;
  category: string;
  canonical_unit: InventoryUnit;
  sku: string | null;
  barcode: string | null;
  item_status: 'active' | 'inactive';
  default_threshold: string | null;
  location_id: string;
  location_name: string;
  storage_area_id: string;
  storage_area_name: string;
  storage_area_status: 'active' | 'inactive';
  quantity: string;
  effective_threshold: string | null;
  is_low_stock: boolean;
  last_movement_at: string | null;
};

export type InventoryItemInput = {
  name: string;
  description: string | null;
  category: string;
  canonicalUnit: InventoryUnit;
  sku: string | null;
  barcode: string | null;
  defaultLowStockThreshold: string | null;
};

export type InventoryMovementInput = {
  idempotencyKey: string;
  locationId: string;
  storageAreaId: string;
  inventoryItemId: string;
  type: Extract<InventoryMovementType, 'opening_balance'|'receipt'|'usage'|'waste'|'adjustment_increase'|'adjustment_decrease'>;
  quantity: string;
  reason: string | null;
  sourceType: string | null;
  sourceId: string | null;
};

export type InventoryTransferInput = {
  idempotencyKey: string;
  locationId: string;
  sourceStorageAreaId: string;
  destinationStorageAreaId: string;
  inventoryItemId: string;
  quantity: string;
  reason: string | null;
};
