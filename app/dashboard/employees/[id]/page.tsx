import { redirect } from 'next/navigation';
import EmployeeDeleteButton from '@/components/EmployeeDeleteButton';
import EmployeeForm from '@/components/EmployeeForm';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { canManageEmployees } from '@/lib/employees/contracts';
import type { Department } from '@/lib/department';
import type { Employee, EmployeeCompany, EmployeeLocation } from '@/lib/employee';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerAuth();
  const actor = await resolveActorContext(supabase);
  if (!canManageEmployees(actor.role)) redirect('/dashboard');

  const [employeeResult, companyResult, locationResult, departmentResult] = await Promise.all([
    supabase.from('employees')
      .select('id,company_id,location_id,department_id,first_name,last_name,role,phone,email,employment_type,salary,hire_date,status,notes,created_at,updated_at')
      .eq('id', id).eq('company_id', actor.companyId).maybeSingle(),
    supabase.from('companies').select('id,name').eq('id', actor.companyId).maybeSingle(),
    supabase.from('locations').select('id,company_id,name')
      .eq('company_id', actor.companyId).eq('status', 'active').order('name'),
    supabase.from('departments').select('id,company_id,name')
      .eq('company_id', actor.companyId).eq('status', 'active').order('name'),
  ]);
  if (employeeResult.error || !employeeResult.data || companyResult.error || !companyResult.data
    || locationResult.error || departmentResult.error) {
    throw new Error('EMPLOYEE_FORM_UNAVAILABLE');
  }

  const employee = employeeResult.data as Employee;
  const companies = [companyResult.data] as EmployeeCompany[];
  const locations = (locationResult.data ?? []) as EmployeeLocation[];
  const departments = (departmentResult.data ?? []) as Department[];
  const initialValues = {
    id: employee.id,
    company_id: actor.companyId,
    location_id: employee.location_id ?? '',
    department_id: employee.department_id ?? '',
    first_name: employee.first_name,
    last_name: employee.last_name,
    role: employee.role,
    phone: employee.phone ?? '',
    email: employee.email ?? '',
    employment_type: employee.employment_type,
    salary: employee.salary,
    hire_date: employee.hire_date ?? '',
    status: employee.status,
    notes: employee.notes ?? '',
  };

  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Edit employee</p>
          <h1 className="mt-4 text-4xl font-black text-white">{employee.first_name} {employee.last_name}</h1>
          <p className="mt-3 text-slate-300">Update team member details or change their assignment.</p>
        </div>
        <EmployeeDeleteButton employeeId={employee.id} />
      </div>
      <EmployeeForm mode="edit" initialData={initialValues} companies={companies} locations={locations} departments={departments} />
    </div>
  );
}
