export default function TasksPage() {
  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Tasks</p>
        <h1 className="mt-4 text-4xl font-black text-white">Operational workflow</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Keep the venue running smoothly with task orchestration and AI-driven priority.
        </p>
      </div>
      <div className="rounded-3xl border border-dashed border-white/15 bg-slate-950/50 p-8 text-center">
        <p className="text-lg font-semibold text-white">No data yet</p>
        <p className="mt-2 text-sm text-slate-400">Task records will appear here when the production task-list API is available.</p>
      </div>
    </div>
  );
}
