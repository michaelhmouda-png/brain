import { createSupabaseServerAuth } from "../../../../lib/supabaseServer";
import type { EmployeeCompany, EmployeeLocation } from "../../../../lib/employee";
import type { Department } from "../../../../lib/department";
import EmployeeForm from "../../../../components/EmployeeForm";

export const dynamic = "force-dynamic";

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

export default async function NewEmployeePage() {
  const [companies, locations, departments] = await Promise.all([getCompanies(), getLocations(), getDepartments()]);

  const defaultValues = {
    company_id: companies[0]?.id ?? "",
    location_id: "",
    department_id: "",
    first_name: "",
    last_name: "",
    role: "",
    phone: "",
    email: "",
    employment_type: "full-time",
    salary: 0,
    hire_date: "",
    status: "active",
    notes: "",
  };

  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <EmployeeForm mode="create" initialData={defaultValues} companies={companies} locations={locations} departments={departments} />
    </div>
  );
}
