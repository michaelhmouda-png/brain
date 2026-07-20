"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CompanyFormValues = {
  id?: string;
  name: string;
  logo_url: string;
  industry: string;
  country: string;
  currency: string;
  timezone: string;
  locations: number;
};

type CompanyFormProps = {
  initialData?: CompanyFormValues;
  mode: "create" | "edit";
};

const defaultValues: CompanyFormValues = {
  name: "",
  logo_url: "",
  industry: "",
  country: "",
  currency: "USD",
  timezone: "UTC",
  locations: 1,
};

const currencyOptions = ["USD", "EUR", "GBP", "AUD", "CAD", "JPY"]; 
const timezoneOptions = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "America/New York" },
  { value: "America/Los_Angeles", label: "America/Los Angeles" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Europe/Paris", label: "Europe/Paris" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
  { value: "Asia/Beirut", label: "Beirut — Lebanon" },
];

export default function CompanyForm({ initialData, mode }: CompanyFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<CompanyFormValues>(initialData ?? defaultValues);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleChange = (field: keyof CompanyFormValues, value: string | number) => {
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
      name: values.name.trim(),
      logo_url: values.logo_url.trim() || null,
      industry: values.industry.trim(),
      country: values.country.trim(),
      currency: values.currency,
      timezone: values.timezone,
      locations: Number(values.locations),
    };

    const endpoint = mode === "create" ? "/api/companies" : `/api/companies/${values.id}`;
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
      setError(body?.message || "Unable to save company.");
      return;
    }

    router.push("/dashboard/companies");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-3xl border border-white/10 bg-slate-950/80 p-4 shadow-[0_40px_120px_rgba(0,0,0,0.35)] sm:p-6 lg:space-y-8 lg:rounded-[36px] lg:p-8">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">{mode === "create" ? "Create company" : "Edit company"}</p>
        <h1 className="mt-4 text-4xl font-black text-white">{mode === "create" ? "Add new brand" : "Update company profile"}</h1>
        <p className="mt-3 max-w-2xl text-slate-400">
          Define the company details that power Brain’s hospitality intelligence.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Name</span>
          <input
            required
            value={values.name}
            onChange={(event) => handleChange("name", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Brain Hospitality"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Logo URL</span>
          <input
            value={values.logo_url}
            onChange={(event) => handleChange("logo_url", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="https://example.com/logo.png"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Industry</span>
          <input
            required
            value={values.industry}
            onChange={(event) => handleChange("industry", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Hospitality"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Country</span>
          <input
            required
            value={values.country}
            onChange={(event) => handleChange("country", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="United States"
          />
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Currency</span>
          <select
            value={values.currency}
            onChange={(event) => handleChange("currency", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          >
            {currencyOptions.map((currency) => (
              <option key={currency} value={currency} className="bg-slate-950 text-white">
                {currency}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Timezone</span>
          <select
            value={values.timezone}
            onChange={(event) => handleChange("timezone", event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          >
            {timezoneOptions.map((zone) => (
              <option key={zone.value} value={zone.value} className="bg-slate-950 text-white">
                {zone.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-3 text-sm text-slate-300">
          <span className="font-semibold text-white">Number of locations</span>
          <input
            required
            type="number"
            min={1}
            value={values.locations}
            onChange={(event) => handleChange("locations", Number(event.target.value))}
            className="w-full rounded-3xl border border-white/10 bg-slate-950/90 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
          />
        </label>
      </div>

      {error ? <p className="rounded-3xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p> : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm text-slate-400">Brain stores company profiles in Supabase.</p>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Secure. Connected. Real-time.</p>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 px-6 py-3 text-sm font-semibold text-black transition duration-300 disabled:cursor-not-allowed disabled:opacity-60 hover:-translate-y-0.5"
        >
          {busy ? "Saving…" : mode === "create" ? "Create company" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
