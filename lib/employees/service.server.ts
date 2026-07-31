import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorContext } from '@/lib/brain/kernel/actor-context';
import { canManageEmployees, normalizeEmployeeMutationError, parseEmployeeMutation } from './contracts';

const EMPLOYEE_PROJECTION = [
  'id', 'company_id', 'location_id', 'department_id', 'department',
  'first_name', 'last_name', 'role', 'phone', 'email', 'employment_type',
  'salary', 'hire_date', 'status', 'notes', 'version', 'lifecycle_status',
  'created_at', 'updated_at',
].join(',');

function assertManager(actor: ActorContext) {
  if (!canManageEmployees(actor.role)) throw new Error('EMPLOYEE_FORBIDDEN');
}

function payload(actor: ActorContext, value: unknown) {
  assertManager(actor);
  const input = parseEmployeeMutation(value);
  return {
    company_id: actor.companyId,
    location_id: input.locationId,
    department_id: input.departmentId,
    first_name: input.firstName,
    last_name: input.lastName,
    role: input.role,
    phone: input.phone,
    email: input.email,
    employment_type: input.employmentType,
    salary: input.salary,
    hire_date: input.hireDate,
    status: input.status,
    notes: input.notes,
  };
}

export async function createEmployee(
  authenticated: SupabaseClient,
  actor: ActorContext,
  value: unknown,
) {
  const { data, error } = await authenticated.from('employees')
    .insert(payload(actor, value))
    .select(EMPLOYEE_PROJECTION)
    .single();
  if (error) throw new Error(normalizeEmployeeMutationError(new Error(error.message)));
  return data;
}

export async function updateEmployee(
  authenticated: SupabaseClient,
  actor: ActorContext,
  employeeId: string,
  value: unknown,
) {
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) throw new Error('EMPLOYEE_NOT_FOUND');
  const { data, error } = await authenticated.from('employees')
    .update(payload(actor, value))
    .eq('id', employeeId)
    .eq('company_id', actor.companyId)
    .select(EMPLOYEE_PROJECTION)
    .maybeSingle();
  if (error) throw new Error(normalizeEmployeeMutationError(new Error(error.message)));
  if (!data) throw new Error('EMPLOYEE_NOT_FOUND');
  return data;
}
