'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
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
      { href: '/dashboard/operations', label: 'Operations' },
      { href: '/dashboard/tasks', label: 'Tasks' },
      { href: '/dashboard/shifts', label: 'Shifts' },
      { href: '/dashboard/maintenance', label: 'Maintenance' },
      { href: '/dashboard/inventory', label: 'Inventory' },
      { href: '/dashboard/incidents', label: 'Incidents' },
      { href: '/dashboard/announcements', label: 'Announcements' },
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
      { href: '/dashboard/analytics', label: 'Analytics' },
      { href: '/dashboard/cameras', label: 'Cameras' },
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const scrollY = window.scrollY;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    const previousTop = document.body.style.top;
    const previousWidth = document.body.style.width;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowMenu(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key === 'Tab' && drawerRef.current) {
        const focusable = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.top = previousTop;
      document.body.style.width = previousWidth;
      document.removeEventListener('keydown', handleKeyDown);
      window.scrollTo(0, scrollY);
    };
  }, [showMenu]);

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

  const brand = (
    <div className="flex items-center gap-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/20">
        <span className="text-2xl font-black tracking-[0.25em]">B</span>
      </div>
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Brain</p>
        <p className="text-xs text-slate-400">Hospitality OS</p>
      </div>
    </div>
  );

  const navigationLinks = (
    <>
      {navSections.map((section) => (
        <div key={section.title}>
          <p className="mb-1 px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-gray-500 lg:mb-2 lg:text-xs">
            {section.title}
          </p>
          <div className="space-y-0.5 lg:space-y-1">
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setShowMenu(false)}
                className={`flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium transition-all lg:px-4 lg:py-2.5 ${
                  isActive(item.href)
                    ? 'border border-cyan-500/20 bg-cyan-500/10 text-cyan-300'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </>
  );

  const mobileAccount = profile ? (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60 p-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white">
            {profile.full_name || 'User'}
          </div>
          {userName && <div className="truncate text-xs text-slate-400">{userName}</div>}
        </div>
        <span
          className={`inline-flex shrink-0 rounded-full px-2 py-1 text-[0.65rem] font-semibold ring-1 ${
            roleColors[profile.role] || roleColors.employee
          }`}
        >
          {roleLabel[profile.role] || 'Employee'}
        </span>
      </div>
      <button
        onClick={handleLogout}
        disabled={isPending}
        className="mt-2 min-h-11 w-full rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Signing out...' : 'Sign out'}
      </button>
    </div>
  ) : null;

  const desktopAccount = profile ? (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60 p-4">
      <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Your Account</p>
      <div className="mt-3 space-y-2">
        <div className="truncate text-sm font-medium text-white">
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
        className="mt-3 min-h-11 w-full rounded-2xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Signing out...' : 'Sign out'}
      </button>
    </div>
  ) : null;

  const desktopNavigation = (
    <>
      <div className="mb-8">{brand}</div>
      <nav className="flex-1 space-y-4 overflow-y-auto">
        {navigationLinks}
      </nav>
      <div className="mt-4">{desktopAccount}</div>
    </>
  );

  return (
    <>
      <header className="safe-area-x safe-area-top fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#050505]/95 backdrop-blur-xl lg:hidden">
        <div className="flex min-h-16 items-center justify-between gap-3">
          <Link href="/dashboard" className="flex min-h-11 items-center gap-3 rounded-xl" aria-label="Brain dashboard">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-400/10 font-black tracking-[0.2em] text-cyan-300 ring-1 ring-cyan-400/20">B</span>
            <span>
              <span className="block text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Brain</span>
              <span className="block text-xs text-slate-400">Hospitality OS</span>
            </span>
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setShowMenu(true)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white"
            aria-label="Open navigation"
            aria-expanded={showMenu}
            aria-controls="mobile-dashboard-navigation"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
      </header>

      {showMenu && (
        <div className="fixed inset-0 z-50 h-[100dvh] overflow-hidden lg:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 h-full w-full bg-black/70 backdrop-blur-sm"
            onClick={() => setShowMenu(false)}
            aria-label="Close navigation"
          />
          <aside
            ref={drawerRef}
            id="mobile-dashboard-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Dashboard navigation"
            className="absolute inset-y-0 left-0 flex h-[100dvh] max-h-[100dvh] w-[min(88vw,380px)] flex-col overflow-hidden border-r border-white/10 bg-[#080b12] shadow-2xl"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <Link
                href="/dashboard"
                onClick={() => setShowMenu(false)}
                className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl"
                aria-label="Brain dashboard"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/10 font-black tracking-[0.2em] text-cyan-300 ring-1 ring-cyan-400/20">B</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Brain</span>
                  <span className="block truncate text-xs text-slate-400">Hospitality OS</span>
                </span>
              </Link>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => {
                  setShowMenu(false);
                  menuButtonRef.current?.focus();
                }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-slate-200"
                aria-label="Close navigation"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </header>
            <nav
              className="mobile-scroll-region min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3"
              aria-label="Mobile dashboard navigation"
            >
              {navigationLinks}
            </nav>
            {mobileAccount && (
              <footer className="shrink-0 border-t border-white/10 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
                {mobileAccount}
              </footer>
            )}
          </aside>
        </div>
      )}

      <aside className="hidden w-full max-w-[300px] shrink-0 flex-col rounded-[36px] border border-white/10 bg-white/5 p-6 shadow-[0_40px_120px_rgba(0,0,0,0.45)] backdrop-blur-xl lg:flex">
        {desktopNavigation}
      </aside>
    </>
  );
}
