import type { SupabaseClient } from '@supabase/supabase-js';
import type { Employee } from '@/lib/employee';

type JoinedRow = Record<string, unknown> & {
  id?: unknown;
  company_id?: unknown;
  location_id?: unknown;
  department_id?: unknown;
  company?: unknown;
  location?: unknown;
  department?: unknown;
};

type AuthorizedRelation = { id: string; company_id: string; name: string };

export const EMPLOYEE_LIST_PROJECTION = `id, company_id, location_id, department_id, first_name, last_name, role, phone, email, employment_type, salary, hire_date, status, notes, created_at, updated_at, company:companies(id, name), location:locations!employees_location_id_fkey(id, company_id, name), department:departments!employees_department_id_fkey(id, company_id, name)`;

function one(value: unknown): unknown {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function authorizedRelation(
  value: unknown,
  relationshipId: unknown,
  companyId: string,
): AuthorizedRelation | null {
  const row = one(value);
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const relation = row as Record<string, unknown>;
  if (typeof relationshipId !== 'string'
    || relation.id !== relationshipId
    || relation.company_id !== companyId
    || typeof relation.name !== 'string') return null;
  return { id: relation.id, company_id: relation.company_id, name: relation.name };
}

export function projectEmployeeListRow(row: JoinedRow, companyId: string): Employee {
  if (row.company_id !== companyId) throw new Error('EMPLOYEE_COMPANY_SCOPE_INVALID');
  const company = one(row.company);
  const authorizedCompany = company && typeof company === 'object' && !Array.isArray(company)
    && (company as Record<string, unknown>).id === companyId
    ? company
    : null;

  return {
    ...row,
    company: authorizedCompany,
    location: authorizedRelation(row.location, row.location_id, companyId),
    department: authorizedRelation(row.department, row.department_id, companyId),
  } as Employee;
}

export async function loadEmployeeList(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select(EMPLOYEE_LIST_PROJECTION)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as JoinedRow[]).map((row) => projectEmployeeListRow(row, companyId));
}

export function employeeRelationshipName(
  relation: { name: string } | null | undefined,
  unassigned: string,
): string {
  return relation?.name ?? unassigned;
}
