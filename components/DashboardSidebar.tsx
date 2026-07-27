'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Camera,
  CheckSquare2,
  ChevronDown,
  CircleUserRound,
  ClipboardCheck,
  Clock3,
  Home,
  Hotel,
  LayoutGrid,
  LogOut,
  Megaphone,
  Menu,
  PackageOpen,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { logoutUser } from '@/lib/auth';
import type { Profile } from '@/lib/types';
import { useLocale } from '@/components/LocaleProvider';
import { BrainMark } from '@/components/brain-experience/BrainMark';

type Role = Profile['role'];

export type DashboardDestination = {
  href: string;
  label: string;
  description: string;
  keywords: string[];
  icon: LucideIcon;
  group: 'primary' | 'operations' | 'organization';
  roles: Role[];
};

const managementRoles: Role[] = ['manager', 'owner', 'super_admin'];
const everyRole: Role[] = ['employee', ...managementRoles];

export const dashboardDestinations: DashboardDestination[] = [
  { href: '/dashboard', label: 'Home', description: 'Today’s briefing and priorities', keywords: ['briefing', 'score', 'today'], icon: Home, group: 'primary', roles: everyRole },
  { href: '/dashboard/operations', label: 'Operations', description: 'Live operational work', keywords: ['overview', 'command center'], icon: LayoutGrid, group: 'primary', roles: managementRoles },
  { href: '/dashboard/reservations', label: 'Reservations', description: 'Bookings, waitlist, and service calendar', keywords: ['booking', 'calendar', 'waiting list', 'calls'], icon: CalendarDays, group: 'primary', roles: managementRoles },
  { href: '/dashboard/customers', label: 'Guests', description: 'Guest profiles and memory', keywords: ['customers', 'people', 'profiles'], icon: CircleUserRound, group: 'primary', roles: managementRoles },
  { href: '/dashboard/tasks', label: 'Tasks', description: 'Assigned and overdue work', keywords: ['to do', 'overdue', 'work'], icon: CheckSquare2, group: 'operations', roles: everyRole },
  { href: '/dashboard/shifts', label: 'Schedule', description: 'Team shifts and coverage', keywords: ['roster', 'employees', 'hours'], icon: Clock3, group: 'operations', roles: everyRole },
  { href: '/dashboard/notifications', label: 'Notifications', description: 'Updates that need your attention', keywords: ['alerts', 'inbox'], icon: Bell, group: 'operations', roles: everyRole },
  { href: '/dashboard/evidence-review', label: 'Evidence review', description: 'Manager review queue', keywords: ['task proof', 'approvals'], icon: ClipboardCheck, group: 'operations', roles: managementRoles },
  { href: '/dashboard/inventory', label: 'Inventory', description: 'Stock health and alerts', keywords: ['stock', 'supplies', 'low stock'], icon: PackageOpen, group: 'operations', roles: managementRoles },
  { href: '/dashboard/maintenance', label: 'Maintenance', description: 'Issues, repairs, and equipment', keywords: ['tickets', 'repair'], icon: Wrench, group: 'operations', roles: managementRoles },
  { href: '/dashboard/incidents', label: 'Incidents', description: 'Operational incident records', keywords: ['reports', 'safety'], icon: ShieldAlert, group: 'operations', roles: managementRoles },
  { href: '/dashboard/cameras', label: 'Cameras', description: 'Camera Manager and inspections', keywords: ['nvr', 'vision', 'agent'], icon: Camera, group: 'operations', roles: managementRoles },
  { href: '/dashboard/timeline', label: 'Timeline', description: 'Durable operational history', keywords: ['events', 'history'], icon: Sparkles, group: 'operations', roles: managementRoles },
  { href: '/dashboard/employees', label: 'Team', description: 'Employees and profiles', keywords: ['staff', 'employees', 'people'], icon: Users, group: 'organization', roles: managementRoles },
  { href: '/dashboard/announcements', label: 'Announcements', description: 'Company updates', keywords: ['news', 'posts'], icon: Megaphone, group: 'organization', roles: managementRoles },
  { href: '/dashboard/companies', label: 'Companies', description: 'Hospitality business profiles', keywords: ['brands', 'tenant'], icon: Building2, group: 'organization', roles: ['owner', 'super_admin'] },
  { href: '/dashboard/locations', label: 'Locations', description: 'Venues and service settings', keywords: ['venues', 'branches'], icon: Hotel, group: 'organization', roles: managementRoles },
  { href: '/dashboard/departments', label: 'Departments', description: 'Team structure', keywords: ['areas', 'organization'], icon: LayoutGrid, group: 'organization', roles: managementRoles },
  { href: '/dashboard/analytics', label: 'Analytics', description: 'Performance overview', keywords: ['reports', 'metrics'], icon: BarChart3, group: 'organization', roles: managementRoles },
  { href: '/dashboard/settings', label: 'Settings', description: 'Preferences and notifications', keywords: ['account', 'language'], icon: Settings, group: 'organization', roles: everyRole },
];

function dispatch(name: 'brain:open' | 'brain:search') {
  window.dispatchEvent(new Event(name));
}

export function DashboardSidebar({
  profile,
  userName,
}: {
  profile: Profile;
  userName: string | null;
}) {
  const { messages: t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const closeRef = useRef<HTMLButtonElement>(null);

  const available = dashboardDestinations.filter((item) => item.roles.includes(profile.role));
  const primary = available.filter((item) => item.group === 'primary');
  const operations = available.filter((item) => item.group === 'operations');
  const organization = available.filter((item) => item.group === 'organization');
  const mobileQuick = profile.role === 'employee'
    ? available.filter((item) => ['/dashboard', '/dashboard/tasks', '/dashboard/shifts', '/dashboard/notifications'].includes(item.href))
    : primary.slice(0, 4);

  const active = (href: string) => href === '/dashboard'
    ? pathname === href
    : pathname.startsWith(href);

  useEffect(() => {
    if (!menuOpen) return;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [menuOpen]);

  const signOut = () => {
    startTransition(async () => {
      await logoutUser();
      router.push('/login');
      router.refresh();
    });
  };

  const navLink = (item: DashboardDestination, mobile = false) => {
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMenuOpen(false)}
        className={mobile ? `brain-mobile-nav-item ${active(item.href) ? 'is-active' : ''}` : `brain-nav-item ${active(item.href) ? 'is-active' : ''}`}
        aria-current={active(item.href) ? 'page' : undefined}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span>{item.href === '/dashboard/cameras' ? t.nav.cameras : item.label}</span>
      </Link>
    );
  };

  return (
    <>
      <aside className="brain-sidebar">
        <Link href="/dashboard" className="brain-brand" aria-label="Brain home">
          <span className="brain-logo-tile"><BrainMark className="h-7 w-7" /></span>
          <span>
            <span className="block text-[15px] font-semibold tracking-[-0.02em] text-slate-950">Brain</span>
            <span className="block text-[11px] text-slate-500">Hospitality OS</span>
          </span>
        </Link>

        <button type="button" onClick={() => dispatch('brain:search')} className="brain-sidebar-search">
          <Search className="h-4 w-4" />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>

        <nav className="mobile-scroll-region min-h-0 flex-1 overflow-y-auto" aria-label="Primary navigation">
          <div className="space-y-1">{primary.map((item) => navLink(item))}</div>
          <div className="brain-nav-section">
            <p className="brain-nav-label">Workspace</p>
            <div className="space-y-1">{operations.map((item) => navLink(item))}</div>
          </div>
          <div className="brain-nav-section">
            <button type="button" onClick={() => setMoreOpen((value) => !value)} className="brain-nav-section-toggle" aria-expanded={moreOpen}>
              <span>Organization</span>
              <ChevronDown className={`h-4 w-4 transition ${moreOpen ? 'rotate-180' : ''}`} />
            </button>
            {moreOpen ? <div className="mt-1 space-y-1">{organization.map((item) => navLink(item))}</div> : null}
          </div>
        </nav>

        <div className="brain-account">
          <div className="brain-account-avatar">{(profile.full_name || userName || 'B').charAt(0).toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{profile.full_name || userName || 'Brain operator'}</p>
            <p className="truncate text-xs capitalize text-slate-500">{profile.role.replaceAll('_', ' ')}</p>
          </div>
          <button type="button" disabled={pending} onClick={signOut} className="brain-account-action" aria-label={t.nav.signOut}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <header className="brain-mobile-header">
        <Link href="/dashboard" className="brain-brand" aria-label="Brain home">
          <span className="brain-logo-tile"><BrainMark className="h-6 w-6" /></span>
          <span className="text-sm font-semibold text-slate-950">Brain</span>
        </Link>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => dispatch('brain:search')} className="brain-icon-button" aria-label="Search Brain">
            <Search className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => setMenuOpen(true)} className="brain-icon-button" aria-label={t.nav.open} aria-expanded={menuOpen}>
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      <nav className="brain-mobile-nav" aria-label="Quick navigation">
        {mobileQuick.map((item) => navLink(item, true))}
        <button type="button" onClick={() => dispatch('brain:open')} className="brain-mobile-nav-item">
          <BrainMark className="h-[18px] w-[18px]" />
          <span>Brain</span>
        </button>
      </nav>

      {menuOpen ? (
        <div className="brain-overlay z-[80]" role="presentation">
          <button type="button" className="absolute inset-0 cursor-default" onClick={() => setMenuOpen(false)} aria-label={t.nav.close} />
          <aside className="brain-mobile-menu" role="dialog" aria-modal="true" aria-label="Navigation">
            <header className="flex items-center justify-between border-b border-slate-200 p-4">
              <span className="brain-brand">
                <span className="brain-logo-tile"><BrainMark className="h-6 w-6" /></span>
                <span className="font-semibold text-slate-950">Brain</span>
              </span>
              <button ref={closeRef} type="button" onClick={() => setMenuOpen(false)} className="brain-icon-button" aria-label={t.nav.close}>
                <X className="h-5 w-5" />
              </button>
            </header>
            <nav className="mobile-scroll-region min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
              <div>
                <p className="brain-nav-label">Navigate</p>
                <div className="mt-2 space-y-1">{primary.map((item) => navLink(item))}</div>
              </div>
              <div>
                <p className="brain-nav-label">Workspace</p>
                <div className="mt-2 space-y-1">{operations.map((item) => navLink(item))}</div>
              </div>
              <div>
                <p className="brain-nav-label">Organization</p>
                <div className="mt-2 space-y-1">{organization.map((item) => navLink(item))}</div>
              </div>
            </nav>
            <footer className="border-t border-slate-200 p-4">
              <button type="button" onClick={signOut} disabled={pending} className="brain-button-secondary w-full">
                <LogOut className="h-4 w-4" /> {pending ? t.nav.signingOut : t.nav.signOut}
              </button>
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  );
}
