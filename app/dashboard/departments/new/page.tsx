import { createSupabase } from "../../../../lib/supabaseClient";
import type { DepartmentCompany, DepartmentLocation, DepartmentManager } from "../../../../lib/department";
import DepartmentForm from "../../../../components/DepartmentForm";

export const dynamic = "force-dynamic";

async function getCompanies() {
  const supabase = createSupabase();
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
  const supabase = createSupabase();
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
  const supabase = createSupabase();
  const { data, error } = await supabase
    .from("employees")
    .select("id, first_name, last_name")
    .order("first_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as DepartmentManager[];
}

export default async function NewDepartmentPage() {
  const [companies, locations, managers] = await Promise.all([getCompanies(), getLocations(), getManagers()]);

  const defaultValues = {
    company_id: companies[0]?.id ?? "",
    location_id: "",
    name: "",
    description: "",
    manager_employee_id: "",
    status: "active",
  };

  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <DepartmentForm mode="create" initialData={defaultValues} companies={companies} locations={locations} managers={managers} />
    </div>
  );
}
