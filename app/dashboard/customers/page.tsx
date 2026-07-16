export default function CustomersPage() {
  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Customers</p>
        <h1 className="mt-4 text-4xl font-black text-white">Guest profiles</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Personalize every experience with guest preferences, loyalty signals, and AI recommendations.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { name: "Eloise R.", visits: 18, status: "Loyal" },
          { name: "Jules K.", visits: 12, status: "VIP" },
          { name: "Nina S.", visits: 7, status: "Returning" },
        ].map((guest) => (
          <article key={guest.name} className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-slate-300 transition hover:-translate-y-1 hover:bg-slate-900/90">
            <div className="flex items-center justify-between gap-4">
              <p className="text-lg font-semibold text-white">{guest.name}</p>
              <span className="rounded-3xl bg-cyan-400/10 px-3 py-1 text-xs uppercase tracking-[0.28em] text-cyan-300">
                {guest.status}
              </span>
            </div>
            <p className="mt-4 text-sm text-slate-400">Visits: {guest.visits}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
