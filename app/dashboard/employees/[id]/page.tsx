import { createSupabaseServerAuth } from "../../../../lib/supabaseServer";
import type { Employee, EmployeeCompany, EmployeeLocation } from "../../../../lib/employee";
import type { Department } from "../../../../lib/department";
import EmployeeForm from "../../../../components/EmployeeForm";
import EmployeeDeleteButton from "../../../../components/EmployeeDeleteButton";

export const dynamic = "force-dynamic";

async function getEmployee(id: string) {
  const supabase = await createSupabaseServerAuth();
  const { data, error } = await supabase
    .from("employees")
    .select(`id, company_id, location_id, department_id, first_name, last_name, role, phone, email, employment_type, salary, hire_date, status, notes, created_at, updated_at`)
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Employee not found.");
  }

  return data as Employee;
}

async function getCompanies() {
  const supabase = await createSupabaseServerAuth();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as EmployeeCompany[];
}

async function getLocations() {
  const supabase = await createSupabaseServerAuth();
  const { data, error } = await supabase
    .from("locations")
    .select("id, company_id, name")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as EmployeeLocation[];
}

async function getDepartments() {
  const supabase = await createSupabaseServerAuth();
  const { data, error } = await supabase
    .from("departments")
    .select("id, company_id, name")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Department[];
}

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [employee, companies, locations, departments] = await Promise.all([getEmployee(id), getCompanies(), getLocations(), getDepartments()]);

  const initialValues = {
    id: employee.id,
    company_id: employee.company_id,
    location_id: employee.location_id ?? "",
    department_id: employee.department_id ?? "",
    first_name: employee.first_name,
    last_name: employee.last_name,
    role: employee.role,
    phone: employee.phone ?? "",
    email: employee.email ?? "",
    employment_type: employee.employment_type,
    salary: employee.salary,
    hire_date: employee.hire_date ?? "",
    status: employee.status,
    notes: employee.notes ?? "",
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
