'use client';

import Link from 'next/link';
import {
  Armchair,
  CalendarDays,
  Check,
  ChevronDown,
  History,
  ListFilter,
  LoaderCircle,
  MapPin,
  Minus,
  NotebookPen,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizePhone } from '@/lib/reservations/phone';

const PURPOSES = ['regular', 'birthday', 'anniversary', 'business', 'engagement', 'bachelor', 'bachelorette', 'family', 'event', 'other'] as const;
const QUICK_PURPOSES = ['regular', 'birthday', 'business', 'event'] as const;
const SOURCES = ['manual', 'phone', 'whatsapp', 'instagram', 'website', 'google', 'walk_in', 'other'] as const;
const SEATING = ['no_preference', 'indoor', 'outdoor', 'bar', 'vip'] as const;
const COUNTRY_CODES = [
  ['Lebanon', '+961'],
  ['United Arab Emirates', '+971'],
  ['Saudi Arabia', '+966'],
  ['Qatar', '+974'],
  ['Kuwait', '+965'],
  ['Jordan', '+962'],
  ['France', '+33'],
  ['United Kingdom', '+44'],
  ['United States / Canada', '+1'],
] as const;
const TABS = ['Today', 'Upcoming', 'Waiting List', 'Seated', 'Completed', 'Cancelled', 'No-shows'] as const;
const QUICK_TIMES = ['18:00', '19:00', '20:00', '21:00'];
const QUICK_PARTIES = [2, 4, 6, 8];

type Tab = typeof TABS[number];
type ReservationRow = {
  id: string;
  reservation_date: string;
  reservation_time: string;
  guest_count: number;
  purpose: string;
  seating_preference: string;
  status: string;
  source: string;
  notes: string | null;
  guest: { first_name: string; last_name: string; phone_e164: string } | null;
  creator: { full_name: string } | null;
};
type Location = { id: string; name: string };
type WaitlistRow = {
  id: string;
  requested_date: string;
  preferred_time: string;
  guest_count: number;
  purpose: string;
  status: string;
  seating_preference: string;
};
type GuestMemory = {
  name: string;
  phoneE164: string;
  reservationCount: number;
  latestDate: string;
  usualPartySize: number;
  seatingPreference: string | null;
};
type Comparison = {
  sufficientHistoricalData: boolean;
  current: { reservationCount: number; expectedGuestCount: number; cancellationCount: number; noShowCount: number };
  comparable: { reservationCount: number; expectedGuestCount: number; cancellationCount: number; noShowCount: number };
};

const localDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const offsetDate = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDate(date);
};
const title = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const shortTime = (value: string) => String(value).slice(0, 5);
const formatDay = (value: string) => new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
}).format(new Date(`${value}T12:00:00`));
const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.055] px-3.5 text-[15px] text-white transition placeholder:text-slate-600 hover:border-white/20 focus:border-cyan-400/60 focus:bg-white/[0.075] focus:outline-none';
const labelClass = 'text-xs font-semibold uppercase tracking-[0.12em] text-slate-400';

function createInitialForm(locationId = '') {
  return {
    firstName: '',
    lastName: '',
    countryCallingCode: '+961',
    phoneNumber: '',
    guestCount: 2,
    purpose: 'regular',
    purposeDetails: '',
    date: localDate(),
    time: '19:00',
    expectedDurationMinutes: 120,
    notes: '',
    seatingPreference: 'no_preference',
    source: 'phone',
    locationId,
    waitlist: false,
    earliestTime: '',
    latestTime: '',
  };
}

const statusTone: Record<string, string> = {
  pending: 'border-amber-300/20 bg-amber-300/10 text-amber-200',
  confirmed: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200',
  waitlisted: 'border-violet-300/20 bg-violet-300/10 text-violet-200',
  seated: 'border-cyan-300/20 bg-cyan-300/10 text-cyan-200',
  completed: 'border-slate-300/15 bg-slate-300/5 text-slate-300',
  cancelled: 'border-rose-300/20 bg-rose-300/10 text-rose-200',
  no_show: 'border-orange-300/20 bg-orange-300/10 text-orange-200',
};

const statusActions: Record<string, { label: string; status: string; primary?: boolean }[]> = {
  pending: [
    { label: 'Confirm', status: 'confirmed', primary: true },
    { label: 'Waitlist', status: 'waitlisted' },
    { label: 'Cancel', status: 'cancelled' },
  ],
  confirmed: [
    { label: 'Seat', status: 'seated', primary: true },
    { label: 'No-show', status: 'no_show' },
    { label: 'Cancel', status: 'cancelled' },
  ],
  waitlisted: [
    { label: 'Confirm', status: 'confirmed', primary: true },
    { label: 'Cancel', status: 'cancelled' },
  ],
  seated: [{ label: 'Complete', status: 'completed', primary: true }],
};

function Choice({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-10 rounded-xl border px-3 text-sm font-semibold transition ${
        active
          ? 'border-cyan-300/50 bg-cyan-300 text-slate-950 shadow-[0_8px_24px_rgba(34,211,238,0.16)]'
          : 'border-white/10 bg-white/[0.035] text-slate-300 hover:border-white/20 hover:bg-white/[0.07]'
      }`}
    >
      {children}
    </button>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="min-w-[126px] flex-1 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xl font-black tracking-tight text-white">{value}</span>
        <span className="text-[11px] text-slate-500">{hint}</span>
      </div>
      <p className="mt-0.5 text-xs font-medium text-slate-400">{label}</p>
    </div>
  );
}

export function ReservationConsole() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [form, setForm] = useState(() => createInitialForm());
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [waitlistRows, setWaitlistRows] = useState<WaitlistRow[]>([]);
  const [tab, setTab] = useState<Tab>('Today');
  const [search, setSearch] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [guestMemory, setGuestMemory] = useState<GuestMemory | null>(null);
  const [guestLookupLoading, setGuestLookupLoading] = useState(false);
  const submittingRef = useRef(false);
  const phoneRef = useRef<HTMLInputElement>(null);

  const set = (key: keyof ReturnType<typeof createInitialForm>, value: string | number | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const loadReservations = useCallback(async () => {
    if (!locationId) return;
    setListLoading(true);
    try {
      if (tab === 'Waiting List') {
        const calendarParams = new URLSearchParams({
          locationId,
          from: localDate(),
          to: offsetDate(30),
          view: 'month',
        });
        const response = await fetch(`/api/reservations/calendar?${calendarParams}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.data?.waitlist)) throw new Error('load');
        setRows([]);
        setWaitlistRows(payload.data.waitlist);
        return;
      }
      const params = new URLSearchParams({ limit: '100', locationId });
      if (tab === 'Today') params.set('date', localDate());
      if (['Seated', 'Completed', 'Cancelled'].includes(tab)) params.set('status', tab.toLowerCase());
      if (tab === 'No-shows') params.set('status', 'no_show');
      const response = await fetch(`/api/reservations?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.data?.reservations)) throw new Error('load');
      let next = payload.data.reservations as ReservationRow[];
      if (tab === 'Upcoming') next = next.filter((row) => row.reservation_date >= localDate());
      setRows(next);
      setWaitlistRows([]);
    } catch {
      setRows([]);
      setWaitlistRows([]);
      setMessage({ kind: 'error', text: 'The reservation list could not be loaded. Try again.' });
    } finally {
      setListLoading(false);
    }
  }, [locationId, tab]);

  useEffect(() => {
    let active = true;
    void fetch('/api/locations', { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json().catch(() => null);
      const list = response.ok && Array.isArray(payload?.data?.locations) ? payload.data.locations as Location[] : [];
      if (!active) return;
      setLocations(list);
      if (list[0]?.id) {
        setLocationId(list[0].id);
        setForm((current) => ({ ...current, locationId: current.locationId || list[0].id }));
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReservations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReservations]);

  useEffect(() => {
    if (!form.locationId || !form.date) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ locationId: form.locationId, date: form.date });
      void fetch(`/api/reservations/history?${params}`, { cache: 'no-store', signal: controller.signal })
        .then((response) => response.json())
        .then((payload) => setComparison(payload?.data ?? null))
        .catch(() => undefined);
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [form.locationId, form.date]);

  useEffect(() => {
    let phoneE164 = '';
    try {
      phoneE164 = normalizePhone(form.countryCallingCode, form.phoneNumber).phoneE164;
    } catch {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setGuestLookupLoading(true);
      const params = new URLSearchParams({ phone: phoneE164, limit: '20' });
      void fetch(`/api/reservations?${params}`, { cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          if (!response.ok || !Array.isArray(payload?.data?.reservations)) return;
          const matches = (payload.data.reservations as ReservationRow[])
            .filter((row) => row.guest?.phone_e164 === phoneE164)
            .sort((a, b) => b.reservation_date.localeCompare(a.reservation_date));
          const latest = matches[0];
          if (!latest?.guest) return;
          const average = Math.round(matches.reduce((sum, row) => sum + row.guest_count, 0) / matches.length);
          setGuestMemory({
            name: `${latest.guest.first_name} ${latest.guest.last_name}`.trim(),
            phoneE164,
            reservationCount: matches.length,
            latestDate: latest.reservation_date,
            usualPartySize: average,
            seatingPreference: latest.seating_preference || null,
          });
          setForm((current) => ({
            ...current,
            firstName: current.firstName || latest.guest!.first_name,
            lastName: current.lastName || latest.guest!.last_name,
          }));
        })
        .finally(() => setGuestLookupLoading(false));
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [form.countryCallingCode, form.phoneNumber]);

  useEffect(() => {
    if (!composerOpen) return;
    const timer = window.setTimeout(() => phoneRef.current?.focus(), 80);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setComposerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [composerOpen, saving]);

  useEffect(() => {
    const openTimer = new URLSearchParams(window.location.search).get('new') === '1'
      ? window.setTimeout(() => setComposerOpen(true), 0)
      : undefined;
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setComposerOpen(true);
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => {
      if (openTimer !== undefined) window.clearTimeout(openTimer);
      window.removeEventListener('keydown', onShortcut);
    };
  }, []);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const guest = row.guest ? `${row.guest.first_name} ${row.guest.last_name} ${row.guest.phone_e164}` : '';
      return `${guest} ${row.purpose} ${row.status} ${row.source}`.toLowerCase().includes(needle);
    });
  }, [rows, search]);

  const visibleWaitlistRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return waitlistRows;
    return waitlistRows.filter((row) => `${row.requested_date} ${row.preferred_time} ${row.purpose} ${row.status} ${row.seating_preference}`.toLowerCase().includes(needle));
  }, [search, waitlistRows]);

  const metrics = useMemo(() => ({
    reservations: tab === 'Waiting List' ? waitlistRows.length : rows.length,
    guests: tab === 'Waiting List'
      ? waitlistRows.reduce((sum, row) => sum + row.guest_count, 0)
      : rows.reduce((sum, row) => sum + row.guest_count, 0),
    confirmed: rows.filter((row) => row.status === 'confirmed').length,
    pending: tab === 'Waiting List' ? waitlistRows.length : rows.filter((row) => row.status === 'pending').length,
  }), [rows, tab, waitlistRows]);

  function openComposer() {
    setForm((current) => ({ ...current, locationId: locationId || current.locationId }));
    setMessage(null);
    setComposerOpen(true);
  }

  function clearComposer() {
    setForm(createInitialForm(locationId));
    setGuestMemory(null);
    setMessage(null);
    window.setTimeout(() => phoneRef.current?.focus(), 0);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const body = {
        ...form,
        purposeDetails: form.purposeDetails || undefined,
        notes: form.notes || undefined,
        earliestTime: form.waitlist && form.earliestTime || undefined,
        latestTime: form.waitlist && form.latestTime || undefined,
      };
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? 'Reservation could not be saved.');
      setMessage({
        kind: 'success',
        text: form.waitlist ? 'Added to the waiting list.' : `Reservation saved for ${form.firstName} ${form.lastName}.`,
      });
      setComposerOpen(false);
      setForm(createInitialForm(locationId));
      setGuestMemory(null);
      await loadReservations();
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? title(error.message) : 'Reservation could not be saved.',
      });
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  async function transition(row: ReservationRow, nextStatus: string) {
    if (['cancelled', 'no_show'].includes(nextStatus)
      && !window.confirm(`${title(nextStatus)} ${row.guest ? `${row.guest.first_name} ${row.guest.last_name}` : 'this reservation'}?`)) return;
    setUpdatingId(row.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/reservations/${row.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? 'Status update failed.');
      setMessage({ kind: 'success', text: `Reservation marked ${title(nextStatus).toLowerCase()}.` });
      await loadReservations();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? title(error.message) : 'Status update failed.' });
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <main className="min-h-[calc(100dvh-6rem)] px-3 pb-24 sm:px-5 lg:px-0 lg:pb-10">
      <div className="overflow-hidden rounded-[28px] border border-white/[0.09] bg-[#080c12]/95 shadow-[0_32px_100px_rgba(0,0,0,0.42)]">
        <header className="border-b border-white/[0.07] px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]" />
                Reservation desk
              </div>
              <h1 className="mt-1.5 truncate text-2xl font-black tracking-tight sm:text-3xl">Today at a glance</h1>
              <p className="mt-1 text-sm text-slate-400">{formatDay(localDate())} · Availability stays staff-confirmed</p>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <label className="relative min-w-0 flex-1 sm:w-56">
                <span className="sr-only">Active location</span>
                <MapPin aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300" />
                <select
                  value={locationId}
                  onChange={(event) => {
                    setLocationId(event.target.value);
                    setForm((current) => ({ ...current, locationId: event.target.value }));
                  }}
                  className="min-h-11 w-full appearance-none rounded-xl border border-white/10 bg-white/[0.055] pl-9 pr-9 text-sm font-semibold"
                >
                  {!locations.length ? <option value="">No active location</option> : null}
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              </label>
              <Link
                href="/dashboard/reservations/calendar"
                className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08]"
                aria-label="Open calendar"
              >
                <CalendarDays className="h-5 w-5" />
              </Link>
              <button
                type="button"
                onClick={openComposer}
                className="hidden min-h-11 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 shadow-[0_10px_30px_rgba(34,211,238,0.18)] transition hover:bg-cyan-200 sm:flex"
              >
                <Plus className="h-4 w-4" /> New booking
                <kbd className="rounded bg-slate-950/10 px-1.5 py-0.5 text-[10px]">N</kbd>
              </button>
            </div>
          </div>
        </header>

        <section className="flex gap-2 overflow-x-auto border-b border-white/[0.07] px-4 py-3 sm:px-6">
          <Metric label="On the books" value={metrics.reservations} hint={tab} />
          <Metric label="Expected guests" value={metrics.guests} hint="covers" />
          <Metric label="Confirmed" value={metrics.confirmed} hint="ready" />
          <Metric label="Needs attention" value={metrics.pending} hint="pending" />
        </section>

        <div className="grid min-h-[600px] lg:grid-cols-[minmax(0,1fr)_310px]">
          <section className="min-w-0 border-white/[0.07] lg:border-r">
            <div className="border-b border-white/[0.07] px-4 py-3 sm:px-6">
              <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2" aria-label="Reservation views">
                {TABS.map((item) => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => setTab(item)}
                    className={`min-h-9 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition ${
                      tab === item ? 'bg-white text-slate-950' : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </nav>
              <div className="mt-1 flex items-center gap-2">
                <label className="relative flex-1">
                  <span className="sr-only">Search reservations</span>
                  <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Guest or phone"
                    className="min-h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.035] pl-9 pr-3 text-sm placeholder:text-slate-600 focus:border-cyan-300/40 focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void loadReservations()}
                  disabled={listLoading}
                  className="grid min-h-10 min-w-10 place-items-center rounded-xl border border-white/[0.08] text-slate-400 hover:bg-white/[0.05]"
                  aria-label="Refresh reservations"
                >
                  <RefreshCw className={`h-4 w-4 ${listLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {message ? (
              <div
                role="status"
                className={`mx-4 mt-4 flex items-center gap-2 rounded-xl border px-3.5 py-3 text-sm sm:mx-6 ${
                  message.kind === 'success'
                    ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100'
                    : 'border-rose-300/20 bg-rose-300/10 text-rose-100'
                }`}
              >
                {message.kind === 'success' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                {message.text}
              </div>
            ) : null}

            <div className="mobile-scroll-region divide-y divide-white/[0.065]">
              {listLoading ? (
                <div className="grid min-h-72 place-items-center text-slate-500">
                  <div className="text-center"><LoaderCircle className="mx-auto h-6 w-6 animate-spin" /><p className="mt-3 text-sm">Loading the desk…</p></div>
                </div>
              ) : tab === 'Waiting List' && visibleWaitlistRows.length ? visibleWaitlistRows.map((row) => (
                <article key={row.id} className="px-4 py-4 transition hover:bg-white/[0.025] sm:px-6">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="w-[58px] shrink-0 pt-0.5 text-center sm:w-[72px]">
                      <p className="text-xl font-black tracking-tight text-white">{shortTime(row.preferred_time)}</p>
                      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{formatDay(row.requested_date)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h2 className="font-bold text-white">Waiting-list party</h2>
                          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
                            <span className="inline-flex items-center gap-1"><UsersRound className="h-3.5 w-3.5" />{row.guest_count}</span>
                            <span>{title(row.purpose)}</span>
                            <span>{title(row.seating_preference)}</span>
                          </p>
                        </div>
                        <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-violet-200">{title(row.status)}</span>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">Guest details remain protected in the reservation record. Conversion controls are not yet available.</p>
                    </div>
                  </div>
                </article>
              )) : visibleRows.length ? visibleRows.map((row) => {
                const guestName = row.guest ? `${row.guest.first_name} ${row.guest.last_name}` : 'Guest';
                const actions = statusActions[row.status] ?? [];
                return (
                  <article key={row.id} className="group px-4 py-4 transition hover:bg-white/[0.025] sm:px-6">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="w-[58px] shrink-0 pt-0.5 text-center sm:w-[72px]">
                        <p className="text-xl font-black tracking-tight text-white">{shortTime(row.reservation_time)}</p>
                        <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          {row.reservation_date === localDate() ? 'Today' : formatDay(row.reservation_date)}
                        </p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h2 className="truncate text-base font-bold text-white sm:text-lg">{guestName}</h2>
                              {row.notes ? <NotebookPen className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-label="Has notes" /> : null}
                            </div>
                            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
                              <span className="inline-flex items-center gap-1"><UsersRound className="h-3.5 w-3.5" />{row.guest_count}</span>
                              <span>{title(row.purpose)}</span>
                              <span>{title(row.seating_preference)}</span>
                              <span className="hidden sm:inline">{title(row.source)}</span>
                            </p>
                          </div>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusTone[row.status] ?? statusTone.completed}`}>
                            {title(row.status)}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <a href={`tel:${row.guest?.phone_e164 ?? ''}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg text-sm text-slate-400 hover:text-cyan-200">
                            <Phone className="h-3.5 w-3.5" /> {row.guest?.phone_e164 ?? 'No phone'}
                          </a>
                          {actions.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {actions.map((action) => (
                                <button
                                  type="button"
                                  key={action.status}
                                  onClick={() => void transition(row, action.status)}
                                  disabled={updatingId === row.id}
                                  className={`min-h-9 rounded-lg px-3 text-xs font-bold transition disabled:opacity-50 ${
                                    action.primary
                                      ? 'bg-cyan-300 text-slate-950 hover:bg-cyan-200'
                                      : 'border border-white/10 text-slate-300 hover:bg-white/[0.07]'
                                  }`}
                                >
                                  {updatingId === row.id ? 'Saving…' : action.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              }) : (
                <div className="grid min-h-72 place-items-center px-6 text-center">
                  <div>
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-white/15 text-slate-500">
                      <ListFilter className="h-5 w-5" />
                    </div>
                    <h2 className="mt-4 font-bold text-white">Nothing in this view</h2>
                    <p className="mt-1 max-w-xs text-sm text-slate-500">Change the view or add a booking. No availability assumption is made.</p>
                    <button type="button" onClick={openComposer} className="mt-4 min-h-10 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950">New booking</button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="hidden bg-white/[0.018] p-5 lg:block">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-300" />
              <h2 className="text-sm font-bold">Brain context</h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">Facts from reservation history only. No AI decision or automatic availability.</p>

            <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <History className="h-3.5 w-3.5" />
                Same weekday last year
              </div>
              {comparison?.sufficientHistoricalData ? (
                <div className="mt-4 space-y-3">
                  {[
                    ['Reservations', comparison.current.reservationCount, comparison.comparable.reservationCount],
                    ['Expected guests', comparison.current.expectedGuestCount, comparison.comparable.expectedGuestCount],
                    ['Cancellations', comparison.current.cancellationCount, comparison.comparable.cancellationCount],
                    ['No-shows', comparison.current.noShowCount, comparison.comparable.noShowCount],
                  ].map(([label, current, previous]) => {
                    const change = Number(current) - Number(previous);
                    return (
                      <div key={String(label)} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-400">{label}</span>
                        <strong className={change > 0 ? 'text-cyan-200' : change < 0 ? 'text-amber-200' : 'text-slate-300'}>
                          {change > 0 ? '+' : ''}{change}
                        </strong>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4">
                  <p className="text-sm font-semibold text-slate-300">History is still building</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">There is not enough comparable data for a factual trend yet.</p>
                </div>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-amber-300/10 bg-amber-300/[0.045] p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-100"><Armchair className="h-4 w-4" /> Availability unknown</p>
              <p className="mt-2 text-xs leading-relaxed text-amber-100/55">Capacity and table rules are not configured. Confirm or waitlist using staff judgment.</p>
            </div>

            <Link href="/dashboard/reservations/calendar" className="mt-4 flex min-h-11 items-center justify-between rounded-xl border border-white/[0.08] px-3.5 text-sm font-semibold text-slate-300 hover:bg-white/[0.05]">
              Open calendar <CalendarDays className="h-4 w-4" />
            </Link>
          </aside>
        </div>
      </div>

      <button
        type="button"
        onClick={openComposer}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 flex min-h-13 -translate-x-1/2 items-center gap-2 rounded-2xl bg-cyan-300 px-6 font-black text-slate-950 shadow-[0_18px_50px_rgba(0,0,0,0.55)] sm:hidden"
      >
        <Plus className="h-5 w-5" /> New booking
      </button>

      {composerOpen ? (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" role="presentation">
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="New reservation"
            className="absolute inset-0 flex flex-col border-white/10 bg-[#0a0e14] shadow-2xl sm:inset-y-3 sm:left-auto sm:right-3 sm:w-[min(560px,calc(100vw-1.5rem))] sm:rounded-[28px] sm:border"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-4 py-3.5 sm:px-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Call mode</p>
                <h2 className="mt-0.5 text-xl font-black">Quick booking</h2>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={clearComposer} disabled={saving} className="min-h-10 rounded-xl px-3 text-xs font-semibold text-slate-400 hover:bg-white/[0.05]">Clear</button>
                <button type="button" onClick={() => setComposerOpen(false)} disabled={saving} className="grid min-h-10 min-w-10 place-items-center rounded-xl border border-white/[0.08] text-slate-400 hover:bg-white/[0.05]" aria-label="Close booking form">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <form
              id="reservation-quick-form"
              onSubmit={submit}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.currentTarget.requestSubmit();
              }}
              className="mobile-scroll-region flex-1 overflow-y-auto"
            >
              <div className="space-y-6 px-4 py-5 sm:px-5">
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-bold"><Phone className="h-4 w-4 text-cyan-300" /> Caller</h3>
                    {guestLookupLoading ? <span className="flex items-center gap-1 text-[11px] text-slate-500"><LoaderCircle className="h-3 w-3 animate-spin" /> Checking history</span> : null}
                  </div>
                  <div className="grid grid-cols-[116px_minmax(0,1fr)] gap-2">
                    <label>
                      <span className={labelClass}>Code</span>
                      <input
                        list="reservation-country-codes"
                        required
                        value={form.countryCallingCode}
                        onChange={(event) => {
                          setGuestMemory(null);
                          set('countryCallingCode', event.target.value);
                        }}
                        className={inputClass}
                        aria-label="Country calling code"
                      />
                      <datalist id="reservation-country-codes">
                        {COUNTRY_CODES.map(([name, code]) => <option key={code} value={code}>{name}</option>)}
                      </datalist>
                    </label>
                    <label>
                      <span className={labelClass}>Phone number</span>
                      <input
                        ref={phoneRef}
                        required
                        inputMode="tel"
                        autoComplete="tel-national"
                        placeholder="03 123 456"
                        value={form.phoneNumber}
                        onChange={(event) => {
                          setGuestMemory(null);
                          set('phoneNumber', event.target.value);
                        }}
                        className={inputClass}
                      />
                    </label>
                  </div>

                  {guestMemory ? (
                    <div className="mt-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.07] p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="flex items-center gap-1.5 text-sm font-bold text-cyan-100"><UserRound className="h-4 w-4" /> Returning guest · {guestMemory.name}</p>
                          <p className="mt-1 text-xs text-cyan-100/60">{guestMemory.reservationCount} prior reservation{guestMemory.reservationCount === 1 ? '' : 's'} · latest {formatDay(guestMemory.latestDate)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            set('guestCount', guestMemory.usualPartySize);
                            if (guestMemory.seatingPreference) set('seatingPreference', guestMemory.seatingPreference);
                          }}
                          className="min-h-9 shrink-0 rounded-lg bg-cyan-200 px-2.5 text-xs font-black text-slate-950"
                        >
                          Use usual
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label>
                      <span className={labelClass}>First name</span>
                      <input required maxLength={80} autoComplete="given-name" value={form.firstName} onChange={(event) => set('firstName', event.target.value)} className={inputClass} />
                    </label>
                    <label>
                      <span className={labelClass}>Last name</span>
                      <input required maxLength={80} autoComplete="family-name" value={form.lastName} onChange={(event) => set('lastName', event.target.value)} className={inputClass} />
                    </label>
                  </div>
                </section>

                <section className="border-t border-white/[0.07] pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-bold"><UsersRound className="h-4 w-4 text-cyan-300" /> Party</h3>
                  <div className="mt-3 flex items-center gap-2">
                    <button type="button" aria-label="Remove one guest" onClick={() => set('guestCount', Math.max(1, form.guestCount - 1))} className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.04]"><Minus className="h-4 w-4" /></button>
                    <div className="min-w-[68px] text-center"><strong className="text-2xl font-black">{form.guestCount}</strong><p className="text-[10px] uppercase tracking-wide text-slate-500">guests</p></div>
                    <button type="button" aria-label="Add one guest" onClick={() => set('guestCount', Math.min(100, form.guestCount + 1))} className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.04]"><Plus className="h-4 w-4" /></button>
                    <div className="ml-1 flex min-w-0 gap-1.5 overflow-x-auto">
                      {QUICK_PARTIES.map((count) => <Choice key={count} active={form.guestCount === count} onClick={() => set('guestCount', count)}>{count}</Choice>)}
                    </div>
                  </div>
                </section>

                <section className="border-t border-white/[0.07] pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-bold"><CalendarDays className="h-4 w-4 text-cyan-300" /> When</h3>
                  <div className="mt-3 flex gap-2">
                    <Choice active={form.date === localDate()} onClick={() => set('date', localDate())}>Today</Choice>
                    <Choice active={form.date === offsetDate(1)} onClick={() => set('date', offsetDate(1))}>Tomorrow</Choice>
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Reservation date</span>
                      <input type="date" required value={form.date} onChange={(event) => set('date', event.target.value)} className="min-h-10 w-full rounded-xl border border-white/10 bg-white/[0.055] px-2 text-sm" />
                    </label>
                  </div>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {QUICK_TIMES.map((time) => <Choice key={time} active={form.time === time} onClick={() => set('time', time)}>{time}</Choice>)}
                    <label className="min-w-[118px]">
                      <span className="sr-only">Reservation time</span>
                      <input type="time" required value={form.time} onChange={(event) => set('time', event.target.value)} className="min-h-10 w-full rounded-xl border border-white/10 bg-white/[0.055] px-2 text-sm" />
                    </label>
                  </div>
                  <div className="mt-3">
                    <span className={labelClass}>Duration</span>
                    <div className="mt-1.5 flex gap-2">
                      {[90, 120, 150].map((minutes) => <Choice key={minutes} active={form.expectedDurationMinutes === minutes} onClick={() => set('expectedDurationMinutes', minutes)}>{minutes / 60 % 1 ? `${minutes / 60} hr` : `${minutes / 60} hrs`}</Choice>)}
                      <select value={form.expectedDurationMinutes} onChange={(event) => set('expectedDurationMinutes', Number(event.target.value))} className="min-h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.055] px-2 text-sm">
                        {[60, 90, 120, 150, 180, 240].map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
                      </select>
                    </div>
                  </div>
                </section>

                <section className="border-t border-white/[0.07] pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4 text-cyan-300" /> Occasion & seating</h3>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {QUICK_PURPOSES.map((purpose) => <Choice key={purpose} active={form.purpose === purpose} onClick={() => set('purpose', purpose)}>{title(purpose)}</Choice>)}
                    <select value={form.purpose} onChange={(event) => set('purpose', event.target.value)} className="min-h-10 min-w-[105px] rounded-xl border border-white/10 bg-white/[0.055] px-2 text-sm">
                      {PURPOSES.map((purpose) => <option key={purpose} value={purpose}>{title(purpose)}</option>)}
                    </select>
                  </div>
                  {form.purpose !== 'regular' ? (
                    <label className="mt-3 block">
                      <span className={labelClass}>Occasion details</span>
                      <input maxLength={500} value={form.purposeDetails} onChange={(event) => set('purposeDetails', event.target.value)} placeholder="Cake, surprise, special setup…" className={inputClass} />
                    </label>
                  ) : null}
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {SEATING.map((preference) => <Choice key={preference} active={form.seatingPreference === preference} onClick={() => set('seatingPreference', preference)}>{title(preference)}</Choice>)}
                  </div>
                </section>

                <section className="border-t border-white/[0.07] pt-5">
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span className={labelClass}>Location</span>
                      <select required value={form.locationId} onChange={(event) => set('locationId', event.target.value)} className={inputClass}>
                        <option value="">Select location</option>
                        {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className={labelClass}>Source</span>
                      <select value={form.source} onChange={(event) => set('source', event.target.value)} className={inputClass}>
                        {SOURCES.map((source) => <option key={source} value={source}>{title(source)}</option>)}
                      </select>
                    </label>
                  </div>
                  <details className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.025]">
                    <summary className="cursor-pointer list-none px-3.5 py-3 text-sm font-semibold text-slate-300">Add internal notes</summary>
                    <div className="border-t border-white/[0.06] p-3">
                      <textarea maxLength={2000} rows={3} value={form.notes} onChange={(event) => set('notes', event.target.value)} placeholder="Allergies, accessibility, service notes…" className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.045] p-3 text-sm placeholder:text-slate-600 focus:border-cyan-300/40 focus:outline-none" />
                    </div>
                  </details>
                </section>

                <section className="border-t border-white/[0.07] pt-5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.waitlist}
                    onClick={() => set('waitlist', !form.waitlist)}
                    className={`flex w-full items-center justify-between rounded-2xl border p-3.5 text-left transition ${
                      form.waitlist ? 'border-violet-300/30 bg-violet-300/[0.08]' : 'border-white/[0.08] bg-white/[0.025]'
                    }`}
                  >
                    <span><strong className="block text-sm">Add to waiting list</strong><span className="mt-0.5 block text-xs text-slate-500">Use when staff cannot confirm availability.</span></span>
                    <span className={`relative h-6 w-11 rounded-full transition ${form.waitlist ? 'bg-violet-300' : 'bg-slate-700'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-slate-950 transition ${form.waitlist ? 'left-6' : 'left-1'}`} /></span>
                  </button>
                  {form.waitlist ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label><span className={labelClass}>Earliest</span><input type="time" value={form.earliestTime} onChange={(event) => set('earliestTime', event.target.value)} className={inputClass} /></label>
                      <label><span className={labelClass}>Latest</span><input type="time" value={form.latestTime} onChange={(event) => set('latestTime', event.target.value)} className={inputClass} /></label>
                    </div>
                  ) : null}
                </section>
              </div>
            </form>

            <footer className="shrink-0 border-t border-white/[0.08] bg-[#0a0e14]/95 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] backdrop-blur sm:rounded-b-[28px] sm:px-5">
              <div className="mb-3 flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-slate-400">{form.guestCount} guests · {formatDay(form.date)} at {form.time}</span>
                <span className="shrink-0 text-amber-200/70">Availability unknown</span>
              </div>
              <button
                type="submit"
                form="reservation-quick-form"
                disabled={saving || !form.locationId}
                className={`flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl font-black text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  form.waitlist ? 'bg-violet-300 hover:bg-violet-200' : 'bg-cyan-300 hover:bg-cyan-200'
                }`}
              >
                {saving ? <><LoaderCircle className="h-5 w-5 animate-spin" /> Saving once…</> : form.waitlist ? 'Add to waiting list' : 'Save reservation'}
              </button>
              <p className="mt-2 text-center text-[10px] text-slate-600">Ctrl / ⌘ + Enter to save · one submission only</p>
            </footer>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
