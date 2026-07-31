import { redirect } from 'next/navigation';
import EmployeeForm from '@/components/EmployeeForm';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { canManageEmployees } from '@/lib/employees/contracts';
import type { Department } from '@/lib/department';
import type { EmployeeCompany, EmployeeLocation } from '@/lib/employee';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function NewEmployeePage() {
  const supabase = await createSupabaseServerAuth();
  const actor = await resolveActorContext(supabase);
  if (!canManageEmployees(actor.role)) redirect('/dashboard');

  const [companyResult, locationResult, departmentResult] = await Promise.all([
    supabase.from('companies').select('id,name').eq('id', actor.companyId).maybeSingle(),
    supabase.from('locations').select('id,company_id,name')
      .eq('company_id', actor.companyId).eq('status', 'active').order('name'),
    supabase.from('departments').select('id,company_id,name')
      .eq('company_id', actor.companyId).eq('status', 'active').order('name'),
  ]);
  if (companyResult.error || !companyResult.data || locationResult.error || departmentResult.error) {
    throw new Error('EMPLOYEE_FORM_UNAVAILABLE');
  }

  const companies = [companyResult.data] as EmployeeCompany[];
  const locations = (locationResult.data ?? []) as EmployeeLocation[];
  const departments = (departmentResult.data ?? []) as Department[];
  const defaultValues = {
    company_id: actor.companyId,
    location_id: '',
    department_id: '',
    first_name: '',
    last_name: '',
    role: '',
    phone: '',
    email: '',
    employment_type: 'full-time',
    salary: 0,
    hire_date: '',
    status: 'active',
    notes: '',
  };

  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <EmployeeForm mode="create" initialData={defaultValues} companies={companies} locations={locations} departments={departments} />
    </div>
  );
}
