"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LocationCompany } from "../lib/location";

type LocationFormValues = {
  id?: string;
  company_id: string;
  name: string;
  type: string;
  country: string;
  city: string;
  address: string;
  timezone: string;
  phone: string;
  email: string;
  capacity: number;
  status: string;
};

type LocationFormProps = {
  initialData: LocationFormValues;
  mode: "create" | "edit";
  companies: LocationCompany[];
};

const timezoneOptions = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Beirut",
  "Australia/Sydney",
];

const statusOptions = ["active", "inactive"];

export default function LocationForm({ initialData, mode, companies }: LocationFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<LocationFormValues>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleChange = (field: keyof LocationFormValues, value: string | number) => {
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
      name: values.name.trim(),
      type: values.type.trim(),
      country: values.country.trim(),
      city: values.city.trim(),
      address: values.address.trim() || null,
      timezone: values.timezone,
      phone: values.phone.trim() || null,
      email: values.email.trim() || null,
      capacity: Number(values.capacity),
      status: values.status,
    };

    const endpoint = mode === "create" ? "/api/locations" : `/api/locations/${values.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    const response = await fetch(endpoint, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    setBusy(false);

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || "Unable to save location.");
      return;
    }

    router.push("/dashboard/locations");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div className="grid gap-6 md:grid-cols-2">
        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Parent company</span>
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

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Location name</span>
          <input
            required
            value={values.name}
            onChange={(event) => handleChange("name", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Downtown Venue"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Location type</span>
          <input
            required
            value={values.type}
            onChange={(event) => handleChange("type", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Hotel, Restaurant, Office"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Country</span>
          <input
            required
            value={values.country}
            onChange={(event) => handleChange("country", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Lebanon"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">City</span>
          <input
            required
            value={values.city}
            onChange={(event) => handleChange("city", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Beirut"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Address</span>
          <input
            value={values.address}
            onChange={(event) => handleChange("address", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="123 Main St"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Timezone</span>
          <select
            required
            value={values.timezone}
            onChange={(event) => handleChange("timezone", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          >
            {timezoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Phone</span>
          <input
            value={values.phone}
            onChange={(event) => handleChange("phone", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="+961 1 234 567"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Email</span>
          <input
            type="email"
            value={values.email}
            onChange={(event) => handleChange("email", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="venue@example.com"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Capacity</span>
          <input
            required
            type="number"
            min={0}
            value={values.capacity}
            onChange={(event) => handleChange("capacity", Number(event.target.value))}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          />
        </label>
      </div>

      {error ? <p className="rounded-3xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p> : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm text-slate-400">All locations are stored in Supabase and linked to a company.</p>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Venue profile</p>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 px-6 py-3 text-sm font-semibold text-black transition duration-300 disabled:cursor-not-allowed disabled:opacity-60 hover:-translate-y-0.5"
        >
          {busy ? "Saving…" : mode === "create" ? "Create location" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
