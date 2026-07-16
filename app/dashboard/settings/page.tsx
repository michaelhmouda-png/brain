export default function SettingsPage() {
  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Settings</p>
        <h1 className="mt-4 text-4xl font-black text-white">System control</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Configure Brain, manage integrations, and tune your hospitality operating model.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { label: "Workspace", description: "Venue preferences and branding" },
          { label: "Notifications", description: "Alert thresholds and channels" },
          { label: "Security", description: "Access controls and audit" },
        ].map((item) => (
          <article key={item.label} className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-slate-300 transition hover:-translate-y-1 hover:bg-slate-900/90">
            <p className="text-lg font-semibold text-white">{item.label}</p>
            <p className="mt-4 text-sm text-slate-400">{item.description}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
