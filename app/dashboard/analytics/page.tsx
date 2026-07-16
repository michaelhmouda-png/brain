export default function AnalyticsPage() {
  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Analytics</p>
        <h1 className="mt-4 text-4xl font-black text-white">Performance view</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Explore curated insights, revenue breakdowns, and trend signals with clarity.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {[
          { title: "Guest satisfaction", metric: "92%" },
          { title: "Table turns", metric: "3.8" },
          { title: "Forecast bias", metric: "+12%" },
        ].map((item) => (
          <article key={item.title} className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-slate-300 transition hover:-translate-y-1 hover:bg-slate-900/90">
            <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">{item.title}</p>
            <p className="mt-5 text-4xl font-semibold text-white">{item.metric}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
