import Link from "next/link";

export default function Home() {
  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#020202] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.18),_transparent_28%),radial-gradient(circle_at_80%_20%,_rgba(59,130,246,0.16),_transparent_20%)]" />
      <div className="safe-area-x safe-area-bottom safe-area-top relative mx-auto flex min-h-[100dvh] w-full min-w-0 max-w-6xl flex-col items-center justify-center px-5 py-16 text-center sm:px-8 sm:py-24">
        <span className="mb-8 inline-flex w-full min-w-0 justify-center whitespace-normal rounded-full border border-cyan-400/25 bg-white/5 px-4 py-2 text-[0.65rem] uppercase leading-5 tracking-[0.16em] text-cyan-300 backdrop-blur-sm sm:w-auto sm:text-xs sm:tracking-[0.35em]">
          AI operating system for hospitality
        </span>
        <h1 className="max-w-full text-[3rem] font-black uppercase leading-[0.9] tracking-[0.12em] text-white min-[375px]:text-[3.5rem] sm:text-[7rem] sm:tracking-[0.3em]">
          BRAIN
        </h1>
        <p className="mx-auto mt-8 w-full max-w-3xl text-base leading-7 text-slate-300 sm:text-xl sm:leading-9">
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
