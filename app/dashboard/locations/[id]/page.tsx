import { createSupabase } from "../../../../lib/supabaseClient";
import type { Location, LocationCompany } from "../../../../lib/location";
import LocationForm from "../../../../components/LocationForm";
import LocationDeleteButton from "../../../../components/LocationDeleteButton";

export const dynamic = "force-dynamic";

async function getLocation(id: string) {
  const supabase = createSupabase();
  const { data, error } = await supabase
    .from("locations")
    .select(`id, company_id, name, type, country, city, address, timezone, phone, email, capacity, status, created_at, updated_at`)
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Location not found.");
  }

  return data as Location;
}

async function getCompanies() {
  const supabase = createSupabase();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as LocationCompany[];
}

export default async function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [location, companies] = await Promise.all([getLocation(id), getCompanies()]);

  const initialValues = {
    id: location.id,
    company_id: location.company_id,
    name: location.name,
    type: location.type,
    country: location.country,
    city: location.city,
    address: location.address ?? "",
    timezone: location.timezone,
    phone: location.phone ?? "",
    email: location.email ?? "",
    capacity: location.capacity,
    status: location.status,
  };

  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Edit location</p>
          <h1 className="mt-4 text-4xl font-black text-white">{location.name}</h1>
          <p className="mt-3 text-slate-300">Update the venue details or change its parent company.</p>
        </div>
        <LocationDeleteButton locationId={location.id} />
      </div>

      <LocationForm mode="edit" initialData={initialValues} companies={companies} />
    </div>
  );
}
