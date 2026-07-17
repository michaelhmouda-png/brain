import { createSupabaseServerAuth } from "../../../../lib/supabaseServer";
import type { LocationCompany } from "../../../../lib/location";
import LocationForm from "../../../../components/LocationForm";

export const dynamic = "force-dynamic";

async function getCompanies() {
  const supabase = await createSupabaseServerAuth();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as LocationCompany[];
}

export default async function NewLocationPage() {
  const companies = await getCompanies();

  const defaultValues = {
    company_id: companies[0]?.id ?? "",
    name: "",
    type: "",
    country: "",
    city: "",
    address: "",
    timezone: "UTC",
    phone: "",
    email: "",
    capacity: 0,
    status: "active",
  };

  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <LocationForm mode="create" initialData={defaultValues} companies={companies} />
    </div>
  );
}
