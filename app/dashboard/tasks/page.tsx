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
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { title: "Restock bar", due: "Today", priority: "High" },
          { title: "Floor review", due: "2h", priority: "Medium" },
          { title: "Guest feedback", due: "Tonight", priority: "Low" },
        ].map((task) => (
          <article key={task.title} className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-slate-300 transition hover:-translate-y-1 hover:bg-slate-900/90">
            <div className="flex items-center justify-between gap-4">
              <p className="text-lg font-semibold text-white">{task.title}</p>
              <span className="rounded-3xl bg-slate-800/70 px-3 py-1 text-xs uppercase tracking-[0.28em] text-slate-300">
                {task.due}
              </span>
            </div>
            <p className="mt-4 text-sm text-slate-400">Priority: {task.priority}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
