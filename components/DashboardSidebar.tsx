'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { logoutUser } from '@/lib/auth';
import type { Profile } from '@/lib/types';

interface NavSection {
  title: string;
  items: Array<{
    href: string;
    label: string;
  }>;
}

const navSections: NavSection[] = [
  {
    title: 'DASHBOARD',
    items: [
      { href: '/dashboard', label: 'Dashboard' },
    ],
  },
  {
    title: 'BRAIN',
    items: [
      { href: '/dashboard/ai-assistant', label: 'AI Assistant' },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { href: '/dashboard/tasks', label: 'Tasks' },
      { href: '/dashboard/inventory', label: 'Inventory' },
    ],
  },
  {
    title: 'PEOPLE',
    items: [
      { href: '/dashboard/employees', label: 'Employees' },
      { href: '/dashboard/customers', label: 'Customers' },
    ],
  },
  {
    title: 'ORGANIZATION',
    items: [
      { href: '/dashboard/companies', label: 'Companies' },
      { href: '/dashboard/locations', label: 'Locations' },
      { href: '/dashboard/departments', label: 'Departments' },
    ],
  },
  {
    title: 'SYSTEM',
    items: [
      { href: '/dashboard/settings', label: 'Settings' },
    ],
  },
];

type DashboardSidebarProps = {
  profile: Profile | null;
  userName: string | null;
};

export function DashboardSidebar({ profile, userName }: DashboardSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
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

  const isActive = (href: string): boolean => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname.startsWith(href);
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

      <nav className="flex-1 space-y-4 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.title}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-2">
              {section.title}
            </p>
            <div className="space-y-1">
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                    isActive(item.href)
                      ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
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
      </div>
    </aside>
  );
}
