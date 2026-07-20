import Link from "next/link";
import { createSupabaseServerAuth } from "../../../lib/supabaseServer";
import type { Company } from "../../../lib/company";

export const dynamic = "force-dynamic";

async function getCompanies() {
  const supabase = await createSupabaseServerAuth();
  
  // Verify authenticated user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!user || userError) {
    throw new Error('User not authenticated');
  }
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, logo_url, industry, country, currency, timezone, locations, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Company[];
}

export default async function CompaniesPage() {
  const companies = await getCompanies();
  const totalLocations = companies.reduce((sum, company) => sum + company.locations, 0);

  return (
    <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:p-6 lg:space-y-8 lg:rounded-[36px] lg:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Companies</p>
          <h1 className="mt-4 text-4xl font-black text-white">Business profiles</h1>
          <p className="mt-3 max-w-2xl text-slate-300">
            Manage the hospitality brands that depend on Brain to run every venue flawlessly.
          </p>
        </div>
        <Link
          href="/dashboard/companies/new"
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 px-6 py-3 text-sm font-semibold text-black transition duration-300 hover:-translate-y-0.5"
        >
          New company
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Companies</p>
          <p className="mt-4 text-3xl font-semibold text-white">{companies.length}</p>
          <p className="mt-2 text-sm text-slate-400">Profiles stored in Brain.</p>
        </article>
        <article className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Locations</p>
          <p className="mt-4 text-3xl font-semibold text-white">{totalLocations}</p>
          <p className="mt-2 text-sm text-slate-400">Active venue locations across your portfolio.</p>
        </article>
        <article className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Latest company</p>
          <p className="mt-4 text-3xl font-semibold text-white">
            {companies[0]?.name ?? "No companies yet"}
          </p>
          <p className="mt-2 text-sm text-slate-400">Most recently added company profile.</p>
        </article>
      </div>

      <div className="mobile-scroll-region overflow-x-auto rounded-3xl border border-white/10 bg-slate-950/80 text-slate-200 shadow-[0_20px_80px_rgba(0,0,0,0.35)]" role="region" aria-label="Companies table" tabIndex={0}>
        <table className="min-w-[760px] border-separate border-spacing-0 text-left lg:min-w-full">
          <thead className="bg-white/5 text-sm uppercase tracking-[0.27em] text-slate-400">
            <tr>
              <th className="px-6 py-4">Company</th>
              <th className="px-6 py-4">Industry</th>
              <th className="px-6 py-4">Country</th>
              <th className="px-6 py-4">Currency</th>
              <th className="px-6 py-4">Timezone</th>
              <th className="px-6 py-4">Locations</th>
              <th className="px-6 py-4">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 bg-slate-950/80">
            {companies.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-16 text-center text-slate-400">
                  No companies found. Create a company to begin using Brain.
                </td>
              </tr>
            ) : (
              companies.map((company) => (
                <tr key={company.id} className="transition hover:bg-white/5">
                  <td className="px-6 py-5 align-middle">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5">
                        {company.logo_url ? (
                          <img
                            src={company.logo_url}
                            alt={`${company.name} logo`}
                            className="h-10 w-10 rounded-2xl object-cover"
                          />
                        ) : (
                          <span className="text-sm font-bold text-cyan-300">{company.name.slice(0, 2).toUpperCase()}</span>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-white">{company.name}</p>
                        <p className="text-sm text-slate-500">{new Date(company.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{company.industry}</td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{company.country}</td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{company.currency}</td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{company.timezone}</td>
                  <td className="px-6 py-5 align-middle text-sm text-slate-300">{company.locations}</td>
                  <td className="px-6 py-5 align-middle text-sm">
                    <Link
                      href={`/dashboard/companies/${company.id}`}
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
