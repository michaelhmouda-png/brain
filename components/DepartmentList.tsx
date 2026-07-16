"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Department, DepartmentCompany, DepartmentLocation } from "../lib/department";

type DepartmentListProps = {
  departments: Department[];
  companies: DepartmentCompany[];
  locations: DepartmentLocation[];
};

export default function DepartmentList({ departments, companies, locations }: DepartmentListProps) {
  const [companyFilter, setCompanyFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filteredLocations = useMemo(
    () => (companyFilter ? locations.filter((location) => location.company_id === companyFilter) : locations),
    [companyFilter, locations]
  );

  const filteredDepartments = useMemo(
    () =>
      departments.filter((department) => {
        if (companyFilter && department.company_id !== companyFilter) return false;
        if (locationFilter && department.location_id !== locationFilter) return false;
        if (statusFilter && department.status !== statusFilter) return false;
        return true;
      }),
    [departments, companyFilter, locationFilter, statusFilter]
  );

  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-2 text-sm text-slate-300">
          <span className="font-semibold text-white">Company</span>
          <select
            value={companyFilter}
            onChange={(event) => {
              setCompanyFilter(event.target.value);
              setLocationFilter("");
            }}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          >
            <option value="">All companies</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          <span className="font-semibold text-white">Location</span>
          <select
            value={locationFilter}
            onChange={(event) => setLocationFilter(event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          >
            <option value="">All locations</option>
            {filteredLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          <span className="font-semibold text-white">Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          >
            <option value="">All statuses</option>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/80 text-slate-200 shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
        <table className="min-w-full border-separate border-spacing-0 text-left">
          <thead className="bg-white/5 text-sm uppercase tracking-[0.27em] text-slate-400">
            <tr>
              <th className="px-6 py-4">Department</th>
              <th className="px-6 py-4">Company</th>
              <th className="px-6 py-4">Location</th>
              <th className="px-6 py-4">Manager</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Employees</th>
              <th className="px-6 py-4">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 bg-slate-950/80">
            {filteredDepartments.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-16 text-center text-slate-400">
                  No departments found. Create a department to organize your team.
                </td>
              </tr>
            ) : (
              filteredDepartments.map((department) => (
                <tr key={department.id} className="transition hover:bg-white/5">
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">
                    <div className="font-semibold text-white">{department.name}</div>
                    <div className="text-xs text-slate-500">{department.description ?? "No description"}</div>
                  </td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{department.company?.name ?? "Unknown"}</td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{department.location?.name ?? "Unassigned"}</td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{department.manager ? `${department.manager.first_name} ${department.manager.last_name}` : "Unassigned"}</td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{department.status}</td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{department.employee_count ?? 0}</td>
                  <td className="px-6 py-5 align-middle text-sm">
                    <Link
                      href={`/dashboard/departments/${department.id}`}
                      className="rounded-full bg-white/5 px-4 py-2 text-slate-200 transition hover:bg-white/10"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
