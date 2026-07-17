/**
 * Brain Command Engine — Centralized Entity Resolvers
 *
 * Searches employees, inventory items, and customers by name
 * within the authenticated company. Never crosses company boundaries.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface EmployeeMatch {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: string;
  status: string;
  department?: string;
  email?: string;
  phone?: string;
}

export interface InventoryMatch {
  id: string;
  name: string;
  current_quantity: number;
  minimum_quantity: number;
  unit: string;
  category?: string;
  status: string;
}

export interface CustomerMatch {
  id: string;
  first_name: string;
  last_name?: string;
  full_name: string;
  vip_status: string;
  last_visit_at?: string;
  total_visits?: number;
  total_spend?: number;
  phone?: string;
  email?: string;
}

export type EntityResolutionResult<T> =
  | { success: true; entity: T }
  | { success: false; ambiguous: true; matches: T[]; message: string }
  | { success: false; notFound: true; message: string };

// ── Employee Resolver ────────────────────────────────────────────────────────

/**
 * Resolve an employee name to a single match within the company.
 * - Exact full-name match is preferred over partial matches.
 * - Returns ambiguous result if multiple likely matches found.
 * - Company isolation is enforced via the companyId parameter.
 */
export async function resolveEmployee(
  supabase: SupabaseClient,
  companyId: string,
  name: string,
): Promise<EntityResolutionResult<EmployeeMatch>> {
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;

  let query = supabase
    .from('employees')
    .select('id, first_name, last_name, role, status, department, email, phone')
    .eq('company_id', companyId)
    .ilike('first_name', `%${firstName}%`);

  if (lastName) {
    query = query.ilike('last_name', `%${lastName}%`);
  }

  const { data, error } = await query.limit(10);

  if (error) {
    return { success: false, notFound: true, message: `Employee lookup failed: ${error.message}` };
  }

  if (!data || data.length === 0) {
    return {
      success: false,
      notFound: true,
      message: `No employee found matching "${name}" in your company.`,
    };
  }

  // Prefer exact full-name match (case-insensitive)
  const exact = data.find(
    (e: any) =>
      `${e.first_name} ${e.last_name || ''}`.trim().toLowerCase() === trimmed.toLowerCase(),
  );

  if (exact || data.length === 1) {
    const emp = exact || data[0];
    return {
      success: true,
      entity: {
        id: emp.id,
        first_name: emp.first_name,
        last_name: emp.last_name || '',
        full_name: `${emp.first_name} ${emp.last_name || ''}`.trim(),
        role: emp.role,
        status: emp.status,
        department: emp.department,
        email: emp.email,
        phone: emp.phone,
      },
    };
  }

  // Multiple matches — ask user to clarify
  const matches: EmployeeMatch[] = data.map((emp: any) => ({
    id: emp.id,
    first_name: emp.first_name,
    last_name: emp.last_name || '',
    full_name: `${emp.first_name} ${emp.last_name || ''}`.trim(),
    role: emp.role,
    status: emp.status,
    department: emp.department,
    email: emp.email,
    phone: emp.phone,
  }));

  const matchList = matches.map((m) => `${m.full_name} (${m.status})`).join(', ');
  return {
    success: false,
    ambiguous: true,
    matches,
    message: `Multiple employees match "${name}": ${matchList}. Please be more specific (use full name).`,
  };
}

// ── Inventory Item Resolver ──────────────────────────────────────────────────

/**
 * Resolve an inventory item name to a single match within the company.
 * - Exact name match is preferred over partial matches.
 * - Company isolation is enforced.
 */
export async function resolveInventoryItem(
  supabase: SupabaseClient,
  companyId: string,
  name: string,
): Promise<EntityResolutionResult<InventoryMatch>> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, name, current_quantity, minimum_quantity, unit, category, status')
    .eq('company_id', companyId)
    .ilike('name', `%${name.trim()}%`)
    .order('name', { ascending: true })
    .limit(10);

  if (error) {
    return { success: false, notFound: true, message: `Inventory lookup failed: ${error.message}` };
  }

  if (!data || data.length === 0) {
    return {
      success: false,
      notFound: true,
      message: `"${name}" is not in inventory.`,
    };
  }

  // Prefer exact name match
  const exact = data.find((item: any) => item.name.toLowerCase() === name.trim().toLowerCase());

  if (exact || data.length === 1) {
    const item = exact || data[0];
    return {
      success: true,
      entity: {
        id: item.id,
        name: item.name,
        current_quantity: item.current_quantity,
        minimum_quantity: item.minimum_quantity,
        unit: item.unit,
        category: item.category,
        status: item.status,
      },
    };
  }

  // Multiple matches
  const matches: InventoryMatch[] = data.map((item: any) => ({
    id: item.id,
    name: item.name,
    current_quantity: item.current_quantity,
    minimum_quantity: item.minimum_quantity,
    unit: item.unit,
    category: item.category,
    status: item.status,
  }));

  const matchList = matches.map((m) => `${m.name} (${m.current_quantity} ${m.unit})`).join(', ');
  return {
    success: false,
    ambiguous: true,
    matches,
    message: `Multiple items match "${name}": ${matchList}. Please be more specific.`,
  };
}

// ── Customer Resolver ────────────────────────────────────────────────────────

/**
 * Resolve a customer name to a single match within the company.
 */
export async function resolveCustomer(
  supabase: SupabaseClient,
  companyId: string,
  name: string,
): Promise<EntityResolutionResult<CustomerMatch>> {
  const parts = name.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;

  let query = supabase
    .from('customers')
    .select('id, first_name, last_name, vip_status, last_visit_at, total_visits, total_spend, phone, email')
    .eq('company_id', companyId)
    .ilike('first_name', `%${firstName}%`);

  if (lastName) {
    query = query.ilike('last_name', `%${lastName}%`);
  }

  const { data, error } = await query.limit(10);

  if (error || !data || data.length === 0) {
    return {
      success: false,
      notFound: true,
      message: `No customer found matching "${name}".`,
    };
  }

  const exact = data.find(
    (c: any) =>
      `${c.first_name} ${c.last_name || ''}`.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  if (exact || data.length === 1) {
    const c = exact || data[0];
    return {
      success: true,
      entity: {
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name || undefined,
        full_name: `${c.first_name} ${c.last_name || ''}`.trim(),
        vip_status: c.vip_status,
        last_visit_at: c.last_visit_at || undefined,
        total_visits: c.total_visits,
        total_spend: c.total_spend,
        phone: c.phone || undefined,
        email: c.email || undefined,
      },
    };
  }

  const matches: CustomerMatch[] = data.map((c: any) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name || undefined,
    full_name: `${c.first_name} ${c.last_name || ''}`.trim(),
    vip_status: c.vip_status,
    last_visit_at: c.last_visit_at || undefined,
    total_visits: c.total_visits,
    total_spend: c.total_spend,
    phone: c.phone || undefined,
    email: c.email || undefined,
  }));

  const matchList = matches
    .map((m) => `${m.full_name} (${m.vip_status}, last visit: ${m.last_visit_at ? new Date(m.last_visit_at).toLocaleDateString() : 'never'})`)
    .join(', ');

  return {
    success: false,
    ambiguous: true,
    matches,
    message: `Multiple customers match "${name}": ${matchList}. Please be more specific.`,
  };
}
