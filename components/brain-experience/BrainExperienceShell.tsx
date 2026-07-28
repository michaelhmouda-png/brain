'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowRight,
  Command,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Profile } from '@/lib/types';
import { DashboardSidebar, dashboardDestinations } from '@/components/DashboardSidebar';
import { NotificationBell } from '@/components/NotificationBell';
import { useLocale } from '@/components/LocaleProvider';
import type { TranslationMessages } from '@/lib/i18n';
import { BrainAssistant, type BrainPageContext } from './BrainAssistant';
import { BrainMark } from './BrainMark';

const moduleNames: Array<[string, keyof TranslationMessages['shell']['modules']]> = [
  ['/dashboard/reservations', 'reservations'],
  ['/dashboard/timeline', 'timeline'],
  ['/dashboard/tasks', 'tasks'],
  ['/dashboard/cameras', 'cameras'],
  ['/dashboard/employees', 'employees'],
  ['/dashboard/inventory', 'inventory'],
  ['/dashboard/maintenance', 'maintenance'],
  ['/dashboard/incidents', 'incidents'],
  ['/dashboard/operations', 'operations'],
  ['/dashboard/shifts', 'schedule'],
  ['/dashboard/notifications', 'notifications'],
  ['/dashboard/settings', 'settings'],
  ['/dashboard', 'home'],
];

function resolveModuleKey(pathname: string): keyof TranslationMessages['shell']['modules'] {
  return moduleNames.find(([route]) => route === '/dashboard' ? pathname === route : pathname.startsWith(route))?.[1] ?? 'brain';
}

function resolveView(pathname: string, t: TranslationMessages) {
  const segments = pathname.split('/').filter(Boolean).slice(2);
  if (segments.length === 0) return t.shell.today;
  const exactModule = moduleNames.find(([route]) => route === pathname)?.[1];
  if (exactModule) return t.shell.modules[exactModule];
  const last = segments.at(-1) ?? '';
  if (/^[0-9a-f-]{36}$/i.test(last)) return t.shell.details;
  if (last === 'new') return t.shell.new;
  if (last === 'calendar') return t.shell.calendar;
  return t.shell.details;
}

function deriveEntity(pathname: string) {
  const last = pathname.split('/').filter(Boolean).at(-1) ?? '';
  return /^[0-9a-f-]{36}$/i.test(last) ? last : null;
}

type EntitySearchResult = {
  id: string;
  href: string;
  label: string;
  description: string;
  kind: string;
};

type PageContextOverride = {
  route: string;
  view?: string;
  location?: string;
  entity?: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayAt(value: unknown, keys: string[]): unknown[] {
  let current: unknown = value;
  for (const key of keys) current = record(current)?.[key];
  return Array.isArray(current) ? current : [];
}

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function projectEntityResults(
  payloads: unknown[],
  needle: string,
  t: TranslationMessages,
  language: 'en' | 'ar',
  companyTimezone: string,
): EntitySearchResult[] {
  const [taskPayload, reservationPayload, incidentPayload, maintenancePayload] = payloads;
  const normalized = needle.toLowerCase();
  const results: EntitySearchResult[] = [];

  for (const value of arrayAt(taskPayload, ['data'])) {
    const task = record(value);
    if (!task) continue;
    const label = text(task.displayTitle) || text(task.title);
    if (!`${label} ${text(task.description)}`.toLowerCase().includes(normalized)) continue;
    results.push({
      id: `task-${text(task.id)}`,
      href: '/dashboard/tasks',
      label,
      description: t.status[text(task.status) as keyof typeof t.status] ?? t.shell.task,
      kind: t.shell.task,
    });
  }
  for (const value of arrayAt(reservationPayload, ['data', 'reservations'])) {
    const reservation = record(value);
    const guest = record(reservation?.guest);
    if (!reservation || !guest) continue;
    const label = `${text(guest.first_name)} ${text(guest.last_name)}`.trim();
    if (!`${label} ${text(guest.phone_e164)} ${text(reservation.purpose)}`.toLowerCase().includes(normalized)) continue;
    let description: string = t.shell.reservation;
    const startsAt = text(reservation.starts_at);
    if (startsAt) {
      try {
        description = new Intl.DateTimeFormat(language === 'ar' ? 'ar-LB' : 'en', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: companyTimezone,
        }).format(new Date(startsAt));
      } catch {
        description = t.shell.reservation;
      }
    }
    results.push({
      id: `reservation-${text(reservation.id)}`,
      href: '/dashboard/reservations',
      label,
      description,
      kind: t.shell.reservation,
    });
  }
  for (const [payload, href, kind] of [
    [incidentPayload, '/dashboard/incidents', t.shell.incident],
    [maintenancePayload, '/dashboard/maintenance', t.shell.maintenance],
  ] as const) {
    for (const value of arrayAt(payload, ['data'])) {
      const item = record(value);
      if (!item) continue;
      const label = text(item.title);
      const description = text(item.description);
      if (!`${label} ${description}`.toLowerCase().includes(normalized)) continue;
      results.push({
        id: `${kind.toLowerCase()}-${text(item.id)}`,
        href,
        label,
        description: kind,
        kind,
      });
    }
  }
  return results.filter((item) => item.id && item.label).slice(0, 8);
}

function lockDocumentScroll(locked: boolean) {
  if (!locked) return () => undefined;
  const scrollY = window.scrollY;
  const prior = {
    bodyOverflow: document.body.style.overflow,
    bodyPosition: document.body.style.position,
    bodyTop: document.body.style.top,
    bodyWidth: document.body.style.width,
  };
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
  return () => {
    document.body.style.overflow = prior.bodyOverflow;
    document.body.style.position = prior.bodyPosition;
    document.body.style.top = prior.bodyTop;
    document.body.style.width = prior.bodyWidth;
    window.scrollTo(0, scrollY);
  };
}

export function BrainExperienceShell({
  children,
  profile,
  userName,
  companyName,
}: {
  children: ReactNode;
  profile: Profile;
  userName: string | null;
  companyName: string | null;
}) {
  const { companyTimezone, language, messages: t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [entityResults, setEntityResults] = useState<EntitySearchResult[]>([]);
  const [entitySearchLoading, setEntitySearchLoading] = useState(false);
  const [recentPrompts, setRecentPrompts] = useState<string[]>([]);
  const [pageContextOverride, setPageContextOverride] = useState<PageContextOverride | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const brainCloseRef = useRef<HTMLButtonElement>(null);
  const brainDrawerRef = useRef<HTMLElement>(null);
  const searchDialogRef = useRef<HTMLElement>(null);
  const currentModuleKey = resolveModuleKey(pathname);
  const currentModule = t.shell.modules[currentModuleKey];
  const activeContextOverride = pageContextOverride?.route === pathname ? pageContextOverride : null;
  const context: BrainPageContext = useMemo(() => ({
    route: pathname,
    module: currentModule,
    view: activeContextOverride?.view || resolveView(pathname, t),
    entity: activeContextOverride?.entity ?? deriveEntity(pathname),
    company: companyName || (profile.company_id ? t.shell.yourCompany : t.navigation.brain),
    location: activeContextOverride?.location || t.shell.currentAuthorizedView,
    user: profile.full_name || userName || t.shell.you,
    moduleKey: currentModuleKey,
  }), [activeContextOverride, companyName, currentModule, currentModuleKey, pathname, profile.company_id, profile.full_name, t, userName]);

  const visibleDestinations = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return dashboardDestinations.filter((item) => item.roles.includes(profile.role));
    return dashboardDestinations.filter((item) =>
      item.roles.includes(profile.role) &&
      `${t.navigation.destinations[item.translationKey].label} ${t.navigation.destinations[item.translationKey].description} ${t.navigation.destinations[item.translationKey].keywords}`.toLowerCase().includes(normalized)
    );
  }, [profile.role, search, t]);

  useEffect(() => {
    const needle = search.trim();
    if (!searchOpen || needle.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setEntitySearchLoading(true);
      const request = (url: string) => fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }).then(async (response) => response.ok ? response.json() as Promise<unknown> : null).catch(() => null);
      const management = profile.role !== 'employee';
      const payloads = await Promise.all([
        request('/api/tasks'),
        management ? request(`/api/reservations?guestName=${encodeURIComponent(needle)}&limit=8`) : Promise.resolve(null),
        management ? request(`/api/incidents?search=${encodeURIComponent(needle)}&pageSize=8`) : Promise.resolve(null),
        management ? request(`/api/maintenance?search=${encodeURIComponent(needle)}&pageSize=8`) : Promise.resolve(null),
      ]);
      if (!controller.signal.aborted) {
        setEntityResults(projectEntityResults(payloads, needle, t, language, companyTimezone));
        setEntitySearchLoading(false);
      }
    }, 260);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [companyTimezone, language, profile.role, search, searchOpen, t]);

  useEffect(() => {
    const openBrain = () => setBrainOpen(true);
    const openSearch = () => setSearchOpen(true);
    window.addEventListener('brain:open', openBrain);
    window.addEventListener('brain:search', openSearch);
    const params = new URLSearchParams(window.location.search);
    if (params.get('brain') === 'open') {
      window.setTimeout(() => setBrainOpen(true), 0);
      router.replace(pathname, { scroll: false });
    }
    return () => {
      window.removeEventListener('brain:open', openBrain);
      window.removeEventListener('brain:search', openSearch);
    };
  }, [pathname, router]);

  useEffect(() => {
    const receiveContext = (event: Event) => {
      const detail = record((event as CustomEvent<unknown>).detail);
      if (!detail) return;
      setPageContextOverride({
        route: pathname,
        view: typeof detail.view === 'string' ? detail.view.slice(0, 80) : undefined,
        location: typeof detail.location === 'string' ? detail.location.slice(0, 120) : undefined,
        entity: detail.entity === null || typeof detail.entity === 'string' ? detail.entity?.slice(0, 120) ?? null : undefined,
      });
    };
    window.addEventListener('brain:context', receiveContext);
    return () => window.removeEventListener('brain:context', receiveContext);
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        setSearchOpen(false);
        setBrainOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) window.setTimeout(() => searchInputRef.current?.focus(), 0);
    const unlock = lockDocumentScroll(searchOpen || brainOpen);
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const container = searchOpen ? searchDialogRef.current : brainOpen ? brainDrawerRef.current : null;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      unlock();
    };
  }, [brainOpen, searchOpen]);

  useEffect(() => {
    if (brainOpen) window.setTimeout(() => brainCloseRef.current?.focus(), 0);
  }, [brainOpen]);

  const recordPrompt = (prompt: string) => {
    setRecentPrompts((current) => [prompt, ...current.filter((item) => item !== prompt)].slice(0, 3));
  };

  return (
    <div className="brain-v3 min-h-[100dvh] bg-[var(--brain-canvas)] text-slate-950">
      <DashboardSidebar profile={profile} userName={userName} />
      <div className="brain-workspace">
        <header className="brain-topbar">
          <button type="button" onClick={() => setSearchOpen(true)} className="brain-search-trigger">
            <Search className="h-4 w-4" />
            <span>{t.navigation.searchBrain}</span>
            <kbd><Command className="h-3 w-3" />K</kbd>
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden text-end sm:block">
              <span className="block text-sm font-semibold text-slate-900" dir="auto">{profile.full_name || t.navigation.operator}</span>
              <span className="block text-xs text-slate-500">{t.role[profile.role]}</span>
            </span>
            <NotificationBell />
          </div>
        </header>
        <main className="dashboard-main brain-content" data-brain-module={currentModule}>
          {children}
        </main>
      </div>

      <button
        type="button"
        onClick={() => setBrainOpen(true)}
        className="brain-orb"
        aria-label={t.shell.openBrain}
        aria-haspopup="dialog"
        aria-expanded={brainOpen}
      >
        <BrainMark className="h-7 w-7" />
        <span className="brain-orb-label">{t.home.askBrain}</span>
      </button>

      {brainOpen ? (
        <div className="brain-overlay" role="presentation">
          <button type="button" className="absolute inset-0 cursor-default" onClick={() => setBrainOpen(false)} aria-label={t.shell.closeBrain} />
          <aside ref={brainDrawerRef} className="brain-drawer" role="dialog" aria-modal="true" aria-labelledby="brain-drawer-title">
            <header className="brain-drawer-header">
              <div className="flex items-center gap-3">
                <span className="brain-logo-tile"><BrainMark className="h-7 w-7" /></span>
                <div>
                  <h1 id="brain-drawer-title" className="text-base font-semibold text-slate-950">Brain</h1>
                  <p className="text-xs text-slate-500">{t.shell.operationalIntelligence}</p>
                </div>
              </div>
              <button ref={brainCloseRef} type="button" onClick={() => setBrainOpen(false)} className="brain-icon-button" aria-label={t.shell.closeBrain}>
                <X className="h-5 w-5" />
              </button>
            </header>
            <section className="brain-context-card" aria-label={t.shell.currentPageContext}>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{t.shell.viewing}</p>
                <p className="mt-1 font-semibold text-slate-950">{context.module} · {context.view}</p>
                <p className="mt-1 text-xs text-slate-500" dir="auto">{context.company}</p>
              </div>
              <Sparkles className="h-4 w-4 text-blue-600" />
            </section>
            {recentPrompts.length > 0 ? (
              <details className="brain-recent">
                <summary>{t.shell.recentConversation}</summary>
                <div className="mt-2 space-y-1">
                  {recentPrompts.map((prompt) => <p key={prompt} className="truncate text-xs text-slate-500" dir="auto">{prompt}</p>)}
                </div>
              </details>
            ) : null}
            <BrainAssistant context={context} onConversationActivity={recordPrompt} />
          </aside>
        </div>
      ) : null}

      {searchOpen ? (
        <div className="brain-overlay brain-search-overlay" role="presentation">
          <button type="button" className="absolute inset-0 cursor-default" onClick={() => setSearchOpen(false)} aria-label={t.shell.closeSearch} />
          <section ref={searchDialogRef} className="brain-command-menu" role="dialog" aria-modal="true" aria-labelledby="brain-search-title">
            <div className="flex items-center gap-3 border-b border-slate-200 px-4">
              <Search className="h-5 w-5 text-slate-400" />
              <label id="brain-search-title" className="sr-only" htmlFor="brain-global-search">{t.navigation.searchBrain}</label>
              <input
                ref={searchInputRef}
                id="brain-global-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t.shell.searchPlaceholder}
                className="h-14 min-w-0 flex-1 bg-transparent text-base text-slate-950 outline-none placeholder:text-slate-400"
              />
              <button type="button" onClick={() => setSearchOpen(false)} className="brain-key">{t.shell.escape}</button>
            </div>
            <div className="mobile-scroll-region max-h-[min(65dvh,34rem)] overflow-y-auto p-2">
              {search.trim().length >= 2 ? (
                <>
                  <p className="px-3 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    {t.shell.records}
                  </p>
                  {entitySearchLoading ? (
                    <p className="px-3 py-3 text-sm text-slate-500">{t.shell.searching}</p>
                  ) : entityResults.length ? entityResults.map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      onClick={() => setSearchOpen(false)}
                      className="brain-search-result"
                    >
                      <span className="brain-search-result-icon"><Search className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-slate-900" dir="auto">{item.label}</span>
                        <span className="block truncate text-xs text-slate-500"><span>{item.kind}</span> · <bdi>{item.description}</bdi></span>
                      </span>
                      <ArrowRight className="brain-directional-icon h-4 w-4 text-slate-300" />
                    </Link>
                  )) : (
                    <p className="px-3 py-3 text-sm text-slate-500">{t.shell.noRecords}</p>
                  )}
                </>
              ) : null}
              <p className="px-3 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                {search ? t.shell.modulesAndWorkflows : t.shell.goAnywhere}
              </p>
              {visibleDestinations.length ? visibleDestinations.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSearchOpen(false)}
                    className="brain-search-result"
                  >
                    <span className="brain-search-result-icon"><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-900">{t.navigation.destinations[item.translationKey].label}</span>
                      <span className="block truncate text-xs text-slate-500">{t.navigation.destinations[item.translationKey].description}</span>
                    </span>
                    <ArrowRight className="brain-directional-icon h-4 w-4 text-slate-300" />
                  </Link>
                );
              }) : entityResults.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="font-medium text-slate-700">{t.shell.noDestination}</p>
                  <p className="mt-1 text-sm text-slate-500">{t.shell.noDestinationHelp}</p>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
