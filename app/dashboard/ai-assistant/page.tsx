export default function AIAssistantPage() {
  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">AI Assistant</p>
        <h1 className="mt-4 text-4xl font-black text-white">Command the room</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Interact with AI for operational recommendations, service improvements, and shift adjustments.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-slate-300 transition hover:-translate-y-1 hover:bg-slate-900/90">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">AI briefing</p>
          <p className="mt-5 text-lg text-white">
            Brain recommends the best staffing mix and next-level guest experiences.
          </p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-slate-300 transition hover:-translate-y-1 hover:bg-slate-900/90">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Response engine</p>
          <p className="mt-5 text-lg text-white">
            Ask Brain about inventory, bookings, service readiness, or nightly trends.
          </p>
        </div>
      </div>
    </div>
  );
}
