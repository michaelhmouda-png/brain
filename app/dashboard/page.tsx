export default function DashboardPage() {
  return (
    <section className="relative overflow-hidden rounded-[40px] border border-white/10 bg-white/5 p-8 shadow-[0_35px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Welcome back</p>
            <h1 className="text-4xl font-black tracking-tight text-white">Dashboard</h1>
            <p className="mt-3 max-w-2xl text-slate-300">
              A premium hospitality command center for restaurants, bars, clubs, and hotels.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl bg-slate-950/80 px-5 py-4 text-sm text-slate-300 ring-1 ring-white/5">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Revenue</p>
              <p className="mt-2 text-2xl font-semibold text-white">$1.2M</p>
            </div>
            <div className="rounded-3xl bg-slate-950/80 px-5 py-4 text-sm text-slate-300 ring-1 ring-white/5">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">AI score</p>
              <p className="mt-2 text-2xl font-semibold text-white">98.7%</p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <div className="grid gap-6 sm:grid-cols-2">
            <article className="transform rounded-[32px] border border-white/10 bg-gradient-to-br from-slate-950/80 to-slate-900/80 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)] transition duration-500 hover:-translate-y-1 hover:shadow-[0_30px_100px_rgba(0,0,0,0.4)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-cyan-300">Operations efficiency</p>
                  <h2 className="mt-4 text-2xl font-semibold text-white">Inventory stability</h2>
                </div>
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-3xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/20">
                  •
                </span>
              </div>
              <p className="mt-6 text-sm leading-7 text-slate-300">
                Predict staffing needs, reduce waste, and maintain peak performance with a single AI pulse.
              </p>
            </article>
            <article className="transform rounded-[32px] border border-white/10 bg-slate-950/80 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)] transition duration-500 hover:-translate-y-1 hover:shadow-[0_30px_100px_rgba(0,0,0,0.4)]">
              <p className="text-sm uppercase tracking-[0.3em] text-cyan-300">Live metrics</p>
              <div className="mt-5 grid gap-4">
                {[
                  { label: "Guest count", value: "432" },
                  { label: "Open tickets", value: "12" },
                ].map((item) => (
                  <div key={item.label} className="rounded-3xl bg-white/5 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-500">{item.label}</p>
                    <p className="mt-2 text-3xl font-semibold text-white">{item.value}</p>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <div className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
            <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Insights</p>
            <h2 className="mt-4 text-2xl font-semibold text-white">Demand pulse</h2>
            <div className="mt-6 space-y-4">
              {[
                { label: "Peak hour readiness", value: "Excellent" },
                { label: "Service quality", value: "A+" },
                { label: "AI recommendations", value: "45 pending" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
                  <span>{item.label}</span>
                  <span className="font-semibold text-white">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
