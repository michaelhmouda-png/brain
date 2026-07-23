import Link from "next/link";
import { createSupabaseServerAuth } from "../../../lib/supabaseServer";
import type { Employee, EmployeeCompany, EmployeeLocation } from "../../../lib/employee";
import EmployeeList from "../../../components/EmployeeList";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeCompanyApiRequestFromSupabase } from "../../../lib/company-api-authorization.server";
import {
  ACTIVE_EMPLOYEE_STATUS,
  isEmployeeProfileComplete,
} from "../../../lib/employee-profile-completeness";

export const dynamic = "force-dynamic";

async function getEmployees(supabase: SupabaseClient, companyId: string) {
  const { data, error } = await supabase
    .from("employees")
    .select(`id, company_id, location_id, department_id, first_name, last_name, role, phone, email, employment_type, salary, hire_date, status, notes, created_at, updated_at, company:companies(id, name), location:locations(id, company_id, name), departments!employees_department_id_fkey(id, name)`)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as any[]).map((item) => ({
    ...item,
    company: Array.isArray(item.company) ? item.company[0] ?? null : item.company ?? null,
    location: Array.isArray(item.location) ? item.location[0] ?? null : item.location ?? null,
    department: Array.isArray(item.department) ? item.department[0] ?? null : item.department ?? null,
  })) as Employee[];
}

async function getCompanies(supabase: SupabaseClient, companyId: string) {
  const { data, error } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as EmployeeCompany[];
}

async function getLocations(supabase: SupabaseClient, companyId: string) {
  const { data, error } = await supabase
    .from("locations")
    .select("id, company_id, name")
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as EmployeeLocation[];
}

export default async function EmployeesPage() {
  const supabase = await createSupabaseServerAuth();
  const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
  if (!authorization.authorized) throw new Error("User not authenticated");

  const [employees, companies, locations] = await Promise.all([
    getEmployees(supabase, authorization.companyId),
    getCompanies(supabase, authorization.companyId),
    getLocations(supabase, authorization.companyId),
  ]);
  const activeEmployees = employees.filter(
    (employee) => employee.status === ACTIVE_EMPLOYEE_STATUS,
  );
  const incompleteEmployees = activeEmployees.filter(
    (employee) => !isEmployeeProfileComplete(employee),
  );

  return (
    <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:p-6 lg:space-y-8 lg:rounded-[36px] lg:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Employees</p>
          <h1 className="mt-4 text-4xl font-black text-white">Team operations</h1>
          <p className="mt-3 max-w-2xl text-slate-300">
            Manage staff, assignments, and employee details across your company locations.
          </p>
        </div>
        <Link
          href="/dashboard/employees/new"
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 px-6 py-3 text-sm font-semibold text-black transition duration-300 hover:-translate-y-0.5"
        >
          New employee
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Team members</p>
          <p className="mt-4 text-3xl font-semibold text-white">{employees.length}</p>
          <p className="mt-2 text-sm text-slate-400">Employees currently in the system.</p>
        </article>
        <article className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Active staff</p>
          <p className="mt-4 text-3xl font-semibold text-white">{activeEmployees.length}</p>
          <p className="mt-2 text-sm text-slate-400">Team members marked as active.</p>
        </article>
        <article className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Incomplete profiles</p>
          <p className="mt-4 text-3xl font-semibold text-white">{incompleteEmployees.length}</p>
          <p className="mt-2 text-sm text-slate-400">Active employees missing required profile information.</p>
        </article>
      </div>

      <EmployeeList employees={employees} companies={companies} locations={locations} />
    </section>
  );
}
