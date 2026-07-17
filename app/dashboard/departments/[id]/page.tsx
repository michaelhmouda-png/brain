import { createSupabaseServerAuth } from "../../../../lib/supabaseServer";
import type { Department, DepartmentCompany, DepartmentLocation, DepartmentManager } from "../../../../lib/department";
import DepartmentForm from "../../../../components/DepartmentForm";
import DepartmentDeleteButton from "../../../../components/DepartmentDeleteButton";

export const dynamic = "force-dynamic";

async function getDepartment(id: string) {
  const supabase = await createSupabaseServerAuth();
  const { data, error } = await supabase
    .from("departments")
    .select(`id, company_id, location_id, name, description, manager_employee_id, status, created_at, updated_at`)
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Department not found.");
  }

  return data as Department;
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

  return (data ?? []) as DepartmentCompany[];
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

  return (data ?? []) as DepartmentLocation[];
}

async function getManagers() {
  const supabase = await createSupabaseServerAuth();
  const { data, error } = await supabase
    .from("employees")
    .select("id, first_name, last_name")
    .order("first_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as DepartmentManager[];
}

export default async function EditDepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [department, companies, locations, managers] = await Promise.all([
    getDepartment(id),
    getCompanies(),
    getLocations(),
    getManagers(),
  ]);

  const initialValues = {
    id: department.id,
    company_id: department.company_id,
    location_id: department.location_id ?? "",
    name: department.name,
    description: department.description ?? "",
    manager_employee_id: department.manager_employee_id ?? "",
    status: department.status,
  };

  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Edit department</p>
          <h1 className="mt-4 text-4xl font-black text-white">{department.name}</h1>
          <p className="mt-3 text-slate-300">Update department settings or assign a manager.</p>
        </div>
        <DepartmentDeleteButton departmentId={department.id} />
      </div>

      <DepartmentForm mode="edit" initialData={initialValues} companies={companies} locations={locations} managers={managers} />
    </div>
  );
}
