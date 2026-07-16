'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { logoutUser } from '@/lib/auth';
import type { Profile } from '@/lib/types';

const menuItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/companies', label: 'Companies' },
  { href: '/dashboard/locations', label: 'Locations' },
  { href: '/dashboard/departments', label: 'Departments' },
  { href: '/dashboard/employees', label: 'Employees' },
  { href: '/dashboard/tasks', label: 'Tasks' },
  { href: '/dashboard/inventory', label: 'Inventory' },
  { href: '/dashboard/customers', label: 'Customers' },
  { href: '/dashboard/cameras', label: 'Cameras' },
  { href: '/dashboard/ai-assistant', label: 'AI Assistant' },
  { href: '/dashboard/analytics', label: 'Analytics' },
  { href: '/dashboard/settings', label: 'Settings' },
];

type DashboardSidebarProps = {
  profile: Profile | null;
  userName: string | null;
};

export function DashboardSidebar({ profile, userName }: DashboardSidebarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showMenu, setShowMenu] = useState(false);

  const handleLogout = () => {
    startTransition(async () => {
      try {
        await logoutUser();
        router.push('/login');
        router.refresh();
      } catch (error) {
        console.error('Logout failed:', error);
      }
    });
  };

  const roleColors: Record<string, string> = {
    super_admin: 'bg-purple-500/20 text-purple-300 ring-purple-400/20',
    owner: 'bg-cyan-500/20 text-cyan-300 ring-cyan-400/20',
    manager: 'bg-blue-500/20 text-blue-300 ring-blue-400/20',
    employee: 'bg-slate-500/20 text-slate-300 ring-slate-400/20',
  };

  const roleLabel: Record<string, string> = {
    super_admin: 'Super Admin',
    owner: 'Owner',
    manager: 'Manager',
    employee: 'Employee',
  };

  return (
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

      <div className="mt-auto space-y-4">
        {/* User Info Section */}
        {profile && (
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Your Account</p>
            <div className="mt-3 space-y-2">
              <div className="text-sm font-medium text-white truncate">
                {userName || profile.full_name || 'User'}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                    roleColors[profile.role] || roleColors.employee
                  }`}
                >
                  {roleLabel[profile.role] || 'Employee'}
                </span>
              </div>
              {profile.status !== 'active' && (
                <div className="text-xs text-yellow-400">
                  Status: <span className="capitalize">{profile.status}</span>
                </div>
              )}
            </div>

            <button
              onClick={handleLogout}
              disabled={isPending}
              className="mt-3 w-full rounded-2xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        )}

        {/* Live Status Section */}
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60 p-5 text-sm text-slate-300">
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
      </div>
    </aside>
  );
}
