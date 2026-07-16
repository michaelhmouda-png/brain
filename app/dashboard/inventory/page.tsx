export default function InventoryPage() {
  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Inventory</p>
        <h1 className="mt-4 text-4xl font-black text-white">Stock intelligence</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Maintain perfect stock balance and reduce spoilage with predictive replenishment.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { item: "Premium spirits", level: "78%" },
          { item: "Perishables", level: "62%" },
          { item: "Cleaning supplies", level: "91%" },
        ].map((entry) => (
          <article key={entry.item} className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-slate-300 transition hover:-translate-y-1 hover:bg-slate-900/90">
            <p className="text-lg font-semibold text-white">{entry.item}</p>
            <p className="mt-4 text-3xl font-semibold text-cyan-300">{entry.level}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
