import CompanyForm from "../../../../components/CompanyForm";
import { createSupabase } from "../../../../lib/supabaseClient";
import type { Company } from "../../../../lib/company";

export const dynamic = "force-dynamic";

async function getCompany(id: string) {
  const supabase = createSupabase();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, logo_url, industry, country, currency, timezone, locations")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Company not found.");
  }

  return data as Company;
}

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const company = await getCompany(resolvedParams.id);

  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <CompanyForm
        mode="edit"
        initialData={{
          id: company.id,
          name: company.name,
          logo_url: company.logo_url ?? "",
          industry: company.industry,
          country: company.country,
          currency: company.currency,
          timezone: company.timezone,
          locations: company.locations,
        }}
      />
    </div>
  );
}
