import Link from "next/link";
import { createSupabaseServerAuth } from "../../../lib/supabaseServer";
import type { Location } from "../../../lib/location";

export const dynamic = "force-dynamic";

async function getLocations() {
  const supabase = await createSupabaseServerAuth();
  
  // Verify authenticated user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!user || userError) {
    throw new Error('User not authenticated');
  }
  const { data, error } = await supabase
    .from("locations")
    .select(`id, company_id, name, type, country, city, address, timezone, phone, email, capacity, status, created_at, updated_at, company:companies(id, name)`)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as any[]).map((item) => ({
    ...item,
    company: Array.isArray(item.company) ? item.company[0] ?? null : item.company ?? null,
  })) as Location[];
}

export default async function LocationsPage() {
  const locations = await getLocations();

  return (
    <section className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Locations</p>
          <h1 className="mt-4 text-4xl font-black text-white">Venue locations</h1>
          <p className="mt-3 max-w-2xl text-slate-300">
            Manage company locations and venue profiles powering Brain operations.
          </p>
        </div>
        <Link
          href="/dashboard/locations/new"
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 px-6 py-3 text-sm font-semibold text-black transition duration-300 hover:-translate-y-0.5"
        >
          New location
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Locations</p>
          <p className="mt-4 text-3xl font-semibold text-white">{locations.length}</p>
          <p className="mt-2 text-sm text-slate-400">Total venue locations in the system.</p>
        </article>
        <article className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Active venues</p>
          <p className="mt-4 text-3xl font-semibold text-white">{locations.filter((location) => location.status === "active").length}</p>
          <p className="mt-2 text-sm text-slate-400">Locations currently marked active.</p>
        </article>
        <article className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Latest location</p>
          <p className="mt-4 text-3xl font-semibold text-white">{locations[0]?.name ?? "No locations yet"}</p>
          <p className="mt-2 text-sm text-slate-400">Most recently added venue profile.</p>
        </article>
      </div>

      <div className="overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/80 text-slate-200 shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
        <table className="min-w-full border-separate border-spacing-0 text-left">
          <thead className="bg-white/5 text-sm uppercase tracking-[0.27em] text-slate-400">
            <tr>
              <th className="px-6 py-4">Location</th>
              <th className="px-6 py-4">Company</th>
              <th className="px-6 py-4">Type</th>
              <th className="px-6 py-4">City</th>
              <th className="px-6 py-4">Timezone</th>
              <th className="px-6 py-4">Capacity</th>
              <th className="px-6 py-4">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 bg-slate-950/80">
            {locations.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-16 text-center text-slate-400">
                  No locations found. Create a location to start building your venue network.
                </td>
              </tr>
            ) : (
              locations.map((location) => (
                <tr key={location.id} className="transition hover:bg-white/5">
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">
                    <div className="font-semibold text-white">{location.name}</div>
                    <div className="text-xs text-slate-500">{location.address || `${location.city}, ${location.country}`}</div>
                  </td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">
                    {location.company?.name ?? "Unknown"}
                  </td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{location.type}</td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{location.city}</td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{location.timezone}</td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{location.capacity}</td>
                  <td className="px-6 py-5 align-middle text-sm">
                    <Link
                      href={`/dashboard/locations/${location.id}`}
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
    </section>
  );
}
