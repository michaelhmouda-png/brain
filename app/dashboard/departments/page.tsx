import Link from "next/link";
import { createSupabaseServerAuth } from "../../../lib/supabaseServer";
import type { Department, DepartmentCompany, DepartmentLocation } from "../../../lib/department";
import DepartmentList from "../../../components/DepartmentList";

export const dynamic = "force-dynamic";

async function getDepartments() {
  const supabase = await createSupabaseServerAuth();
  
  // Verify authenticated user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!user || userError) {
    throw new Error('User not authenticated');
  }
  const { data, error } = await supabase
    .from("departments")
    .select(`id, company_id, location_id, name, description, manager_employee_id, status, created_at, updated_at, company:companies(id, name), location:locations(id, company_id, name)`)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as any[]).map((item) => ({
    ...item,
    company: Array.isArray(item.company) ? item.company[0] ?? null : item.company ?? null,
    location: Array.isArray(item.location) ? item.location[0] ?? null : item.location ?? null,
  })) as Department[];
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

export default async function DepartmentsPage() {
  const [departments, companies, locations] = await Promise.all([getDepartments(), getCompanies(), getLocations()]);

  return (
    <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:p-6 lg:space-y-8 lg:rounded-[36px] lg:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Departments</p>
          <h1 className="mt-4 text-4xl font-black text-white">Team organization</h1>
          <p className="mt-3 max-w-2xl text-slate-300">
            Manage departments, assign locations, and connect teams to company operations.
          </p>
        </div>
        <Link
          href="/dashboard/departments/new"
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 px-6 py-3 text-sm font-semibold text-black transition duration-300 hover:-translate-y-0.5"
        >
          New department
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Departments</p>
          <p className="mt-4 text-3xl font-semibold text-white">{departments.length}</p>
          <p className="mt-2 text-sm text-slate-400">Organizational teams in the system.</p>
        </article>
        <article className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Active units</p>
          <p className="mt-4 text-3xl font-semibold text-white">{departments.filter((department) => department.status === "active").length}</p>
          <p className="mt-2 text-sm text-slate-400">Departments currently marked as active.</p>
        </article>
        <article className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Latest department</p>
          <p className="mt-4 text-3xl font-semibold text-white">{departments[0]?.name ?? "No departments yet"}</p>
          <p className="mt-2 text-sm text-slate-400">Most recently added department.</p>
        </article>
      </div>

      <DepartmentList departments={departments} companies={companies} locations={locations} />
    </section>
  );
}
