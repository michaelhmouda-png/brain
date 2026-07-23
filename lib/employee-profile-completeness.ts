import type { SupabaseClient } from '@supabase/supabase-js';

export const ACTIVE_EMPLOYEE_STATUS = 'active' as const;
export const EMPLOYEE_PROFILE_REQUIRED_FIELDS = [
  'company_id',
  'first_name',
  'last_name',
  'role',
] as const;
export const EMPLOYEE_PROFILE_SELECT =
  'id, company_id, first_name, last_name, role, status, phone, email, department_id, location_id';

export type EmployeeProfileCompletenessRow = {
  id: string;
  company_id: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  status: string | null;
  phone?: string | null;
  email?: string | null;
  department_id?: string | null;
  location_id?: string | null;
};

export type MissingEmployeeProfileField =
  (typeof EMPLOYEE_PROFILE_REQUIRED_FIELDS)[number];

function isBlank(value: string | null | undefined): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

export function getMissingEmployeeProfileFields(
  employee: EmployeeProfileCompletenessRow,
): MissingEmployeeProfileField[] {
  return EMPLOYEE_PROFILE_REQUIRED_FIELDS.filter((field) => isBlank(employee[field]));
}

export function isEmployeeProfileComplete(
  employee: EmployeeProfileCompletenessRow,
): boolean {
  return getMissingEmployeeProfileFields(employee).length === 0;
}

export function isIncompleteActiveEmployeeProfile(
  employee: EmployeeProfileCompletenessRow,
): boolean {
  return employee.status === ACTIVE_EMPLOYEE_STATUS && !isEmployeeProfileComplete(employee);
}

export async function loadActiveEmployeeProfileSnapshot(
  supabase: SupabaseClient,
  companyId: string,
): Promise<EmployeeProfileCompletenessRow[]> {
  const { data, error } = await supabase
    .from('employees')
    .select(EMPLOYEE_PROFILE_SELECT)
    .eq('company_id', companyId)
    .eq('status', ACTIVE_EMPLOYEE_STATUS);

  if (error) throw error;
  return (data ?? []) as EmployeeProfileCompletenessRow[];
}
