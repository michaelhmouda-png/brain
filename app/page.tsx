import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen relative overflow-hidden bg-[#020202] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.18),_transparent_28%),radial-gradient(circle_at_80%_20%,_rgba(59,130,246,0.16),_transparent_20%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-24 text-center">
        <span className="mb-8 inline-flex rounded-full border border-cyan-400/25 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.35em] text-cyan-300 backdrop-blur-sm">
          AI operating system for hospitality
        </span>
        <h1 className="text-[5rem] font-black uppercase tracking-[0.3em] leading-[0.9] text-white sm:text-[7rem]">
          BRAIN
        </h1>
        <p className="mx-auto mt-8 max-w-3xl text-lg leading-9 text-slate-300 sm:text-xl">
          Every operational decision should either be made by Brain or improved by Brain.
        </p>
        <Link
          href="/dashboard"
          className="group mt-14 inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 px-10 py-4 text-lg font-semibold text-black shadow-[0_25px_80px_rgba(34,211,238,0.23)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_35px_90px_rgba(34,211,238,0.28)]"
        >
          Enter Brain
        </Link>
      </div>
    </main>
  );
}
