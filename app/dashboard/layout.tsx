import Link from "next/link";
import type { ReactNode } from "react";

const menuItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/companies", label: "Companies" },
  { href: "/dashboard/locations", label: "Locations" },
  { href: "/dashboard/departments", label: "Departments" },
  { href: "/dashboard/employees", label: "Employees" },
  { href: "/dashboard/tasks", label: "Tasks" },
  { href: "/dashboard/inventory", label: "Inventory" },
  { href: "/dashboard/customers", label: "Customers" },
  { href: "/dashboard/cameras", label: "Cameras" },
  { href: "/dashboard/ai-assistant", label: "AI Assistant" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-hidden bg-[#020202] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_20%),radial-gradient(circle_at_80%_20%,_rgba(96,165,250,0.14),_transparent_18%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-[1700px] gap-6 px-4 py-6 lg:px-8">
        <aside className="hidden w-full max-w-[300px] shrink-0 flex-col rounded-[36px] border border-white/10 bg-white/5 p-6 shadow-[0_40px_120px_rgba(0,0,0,0.45)] backdrop-blur-xl lg:flex">
          <div className="mb-8 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/20">
              <span className="text-2xl font-black tracking-[0.25em]">B</span>
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Brain</p>
              <p className="text-xs text-slate-400">Hospitality OS</p>
            </div>
          </div>
          <nav className="space-y-2">
            {menuItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center rounded-3xl px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
              >
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
          <div className="mt-auto overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60 p-5 text-sm text-slate-300">
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Live status</p>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <span>Active venues</span>
                <span className="font-semibold text-white">18</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <span>AI alerts</span>
                <span className="font-semibold text-white">4</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <span>Uptime</span>
                <span className="font-semibold text-white">99.94%</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
