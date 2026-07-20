"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmployeeCompany, EmployeeLocation } from "../lib/employee";
import type { Department } from "../lib/department";

type EmployeeDepartment = Pick<Department, "id" | "company_id" | "name">;

type EmployeeFormValues = {
  id?: string;
  company_id: string;
  location_id: string;
  department_id: string;
  first_name: string;
  last_name: string;
  role: string;
  phone: string;
  email: string;
  employment_type: string;
  salary: number;
  hire_date: string;
  status: string;
  notes: string;
};

type EmployeeFormProps = {
  initialData: EmployeeFormValues;
  mode: "create" | "edit";
  companies: EmployeeCompany[];
  locations: EmployeeLocation[];
  departments: EmployeeDepartment[];
};

const employmentOptions = ["full-time", "part-time", "contract", "temporary"];
const statusOptions = ["active", "inactive", "terminated"];

export default function EmployeeForm({ initialData, mode, companies, locations, departments }: EmployeeFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<EmployeeFormValues>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const availableLocations = useMemo(
    () => locations.filter((location) => location.company_id === values.company_id),
    [locations, values.company_id]
  );

  const availableDepartments = useMemo(
    () => departments.filter((department) => department.company_id === values.company_id),
    [departments, values.company_id]
  );

  useEffect(() => {
    if (values.location_id && !availableLocations.some((location) => location.id === values.location_id)) {
      setValues((current) => ({
        ...current,
        location_id: availableLocations[0]?.id ?? "",
      }));
    }
  }, [availableLocations, values.location_id]);

  useEffect(() => {
    if (values.department_id && !availableDepartments.some((department) => department.id === values.department_id)) {
      setValues((current) => ({
        ...current,
        department_id: availableDepartments[0]?.id ?? "",
      }));
    }
  }, [availableDepartments, values.department_id]);

  const handleChange = (field: keyof EmployeeFormValues, value: string | number) => {
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
      department_id: values.department_id || null,
      first_name: values.first_name.trim(),
      last_name: values.last_name.trim(),
      role: values.role.trim(),
      phone: values.phone.trim() || null,
      email: values.email.trim() || null,
      employment_type: values.employment_type,
      salary: Number(values.salary ?? 0),
      hire_date: values.hire_date || null,
      status: values.status,
      notes: values.notes.trim() || null,
    };

    const endpoint = mode === "create" ? "/api/employees" : `/api/employees/${values.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setBusy(false);

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || "Unable to save employee.");
      return;
    }

    router.push("/dashboard/employees");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:p-6 lg:space-y-8 lg:rounded-[36px] lg:p-8">
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
          <span className="font-semibold text-white">Primary location</span>
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
          <span className="font-semibold text-white">First name</span>
          <input
            required
            value={values.first_name}
            onChange={(event) => handleChange("first_name", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Amina"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Last name</span>
          <input
            required
            value={values.last_name}
            onChange={(event) => handleChange("last_name", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Saad"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Role</span>
          <input
            required
            value={values.role}
            onChange={(event) => handleChange("role", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Operations Manager"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Department</span>
          <select
            value={values.department_id}
            onChange={(event) => handleChange("department_id", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          >
            <option value="">No department</option>
            {availableDepartments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Employment type</span>
          <select
            value={values.employment_type}
            onChange={(event) => handleChange("employment_type", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          >
            {employmentOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Salary</span>
          <input
            required
            type="number"
            min={0}
            value={values.salary}
            onChange={(event) => handleChange("salary", Number(event.target.value))}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="0"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Hire date</span>
          <input
            type="date"
            value={values.hire_date}
            onChange={(event) => handleChange("hire_date", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          />
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

        <label className="space-y-3 text-sm text-slate-300 md:col-span-2">
          <span className="font-semibold text-white">Phone</span>
          <input
            value={values.phone}
            onChange={(event) => handleChange("phone", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="+1 555 123 4567"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300 md:col-span-2">
          <span className="font-semibold text-white">Email</span>
          <input
            type="email"
            value={values.email}
            onChange={(event) => handleChange("email", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="staff@example.com"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300 md:col-span-2">
          <span className="font-semibold text-white">Notes</span>
          <textarea
            value={values.notes}
            onChange={(event) => handleChange("notes", event.target.value)}
            className="h-32 w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Optional notes, skills, certifications, or scheduling details."
          />
        </label>
      </div>

      {error ? <p className="rounded-3xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p> : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm text-slate-400">Employees are linked to a company and an optional location.</p>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Team profile</p>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 px-6 py-3 text-sm font-semibold text-black transition duration-300 disabled:cursor-not-allowed disabled:opacity-60 hover:-translate-y-0.5"
        >
          {busy ? "Saving…" : mode === "create" ? "Create employee" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
