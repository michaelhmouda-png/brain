"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DepartmentCompany, DepartmentLocation, DepartmentManager } from "../lib/department";

type DepartmentFormValues = {
  id?: string;
  company_id: string;
  location_id: string;
  name: string;
  description: string;
  manager_employee_id: string;
  status: string;
};

type DepartmentFormProps = {
  initialData: DepartmentFormValues;
  mode: "create" | "edit";
  companies: DepartmentCompany[];
  locations: DepartmentLocation[];
  managers: DepartmentManager[];
};

const statusOptions = ["active", "inactive"];

export default function DepartmentForm({ initialData, mode, companies, locations, managers }: DepartmentFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<DepartmentFormValues>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const availableLocations = useMemo(
    () => locations.filter((location) => location.company_id === values.company_id),
    [locations, values.company_id]
  );

  useEffect(() => {
    if (values.location_id && !availableLocations.some((location) => location.id === values.location_id)) {
      setValues((current) => ({
        ...current,
        location_id: availableLocations[0]?.id ?? "",
      }));
    }
  }, [availableLocations, values.location_id]);

  const handleChange = (field: keyof DepartmentFormValues, value: string | number) => {
    setValues((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const payload = {
      company_id: values.company_id,
      location_id: values.location_id || null,
      name: values.name.trim(),
      description: values.description.trim() || null,
      manager_employee_id: values.manager_employee_id || null,
      status: values.status,
    };

    const endpoint = mode === "create" ? "/api/departments" : `/api/departments/${values.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setBusy(false);

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || "Unable to save department.");
      return;
    }

    router.push("/dashboard/departments");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div className="grid gap-6 md:grid-cols-2">
        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Company</span>
          <select
            required
            value={values.company_id}
            onChange={(event) => handleChange("company_id", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Location</span>
          <select
            value={values.location_id}
            onChange={(event) => handleChange("location_id", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          >
            <option value="">No location assigned</option>
            {availableLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Department name</span>
          <input
            required
            value={values.name}
            onChange={(event) => handleChange("name", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Operations"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300 md:col-span-2">
          <span className="font-semibold text-white">Description</span>
          <textarea
            value={values.description}
            onChange={(event) => handleChange("description", event.target.value)}
            className="h-32 w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Optional department details"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Manager</span>
          <select
            value={values.manager_employee_id}
            onChange={(event) => handleChange("manager_employee_id", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          >
            <option value="">No manager assigned</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.first_name} {manager.last_name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Status</span>
          <select
            value={values.status}
            onChange={(event) => handleChange("status", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="rounded-3xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p> : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm text-slate-400">Departments are tied to companies and optionally to locations.</p>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Organizational unit</p>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 px-6 py-3 text-sm font-semibold text-black transition duration-300 disabled:cursor-not-allowed disabled:opacity-60 hover:-translate-y-0.5"
        >
          {busy ? "Saving…" : mode === "create" ? "Create department" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
