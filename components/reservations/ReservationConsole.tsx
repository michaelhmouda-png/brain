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
import { ReservationEditPanel, type EditableReservation } from '@/components/reservations/ReservationEditPanel';
import {
  GuestCountInput,
  ReservationDatePicker,
  ReservationTimeInput,
} from '@/components/reservations/ReservationInputs';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import type { ReservationDailyMetrics } from '@/lib/reservations/metrics';
import { normalizePhone } from '@/lib/reservations/phone';
import { venueDate } from '@/lib/reservations/time';

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

type Tab = typeof TABS[number];
type ReservationRow = {
  id: string;
  location_id: string;
  guest_id: string;
  reservation_date: string;
  reservation_time: string;
  starts_at: string;
  expected_end_at: string | null;
  guest_count: number;
  purpose: string;
  purpose_details: string | null;
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
type DailyArrival = {
  id: string;
  time: string;
  guestName: string;
  guestCount: number;
};
type DailyReservation = {
  id: string;
  reservation_time: string;
  guest_count: number;
  status: string;
  guest: { name: string; phone: string } | null;
};

const EMPTY_METRICS: ReservationDailyMetrics = {
  activeReservations: 0,
  expectedGuests: 0,
  confirmedReservations: 0,
  pendingReservations: 0,
  waitingListCount: 0,
  waitingListGuests: 0,
  seatedReservations: 0,
  seatedGuests: 0,
  cancelledReservations: 0,
  noShowReservations: 0,
  completedReservations: 0,
};

const localDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const offsetDate = (days: number, base = localDate()) => {
  const date = new Date(`${base}T12:00:00`);
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
const inputClass = 'ui-field mt-1.5 min-h-11 w-full rounded-xl px-3.5 text-[15px] transition';
const labelClass = 'text-xs font-semibold uppercase tracking-[0.12em] text-white';

function createInitialForm(locationId = ''): {
  firstName: string;
  lastName: string;
  countryCallingCode: string;
  phoneNumber: string;
  guestCount: number | '';
  purpose: string;
  purposeDetails: string;
  date: string;
  time: string;
  expectedDurationMinutes: number;
  notes: string;
  seatingPreference: string;
  source: string;
  locationId: string;
  waitlist: boolean;
  earliestTime: string;
  latestTime: string;
} {
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

const statusTone: Record<string, StatusTone> = {
  pending: 'pending',
  confirmed: 'success',
  waitlisted: 'review',
  seated: 'processing',
  completed: 'approved',
  cancelled: 'rejected',
  no_show: 'warning',
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
          ? 'border-white bg-white text-black'
          : 'border-white bg-black text-white hover:bg-slate-900'
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
    <div className="min-w-[126px] flex-1 rounded-2xl border border-black bg-white px-4 py-3 text-black">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xl font-black tracking-tight text-black">{value}</span>
        <span className="text-[11px] text-zinc-700">{hint}</span>
      </div>
      <p className="mt-0.5 text-xs font-medium text-zinc-800">{label}</p>
    </div>
  );
}

export function ReservationConsole() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => localDate());
  const [timezone, setTimezone] = useState('');
  const [form, setForm] = useState(() => createInitialForm());
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [waitlistRows, setWaitlistRows] = useState<WaitlistRow[]>([]);
  const [dailyReservations, setDailyReservations] = useState<DailyReservation[]>([]);
  const [dailyMetrics, setDailyMetrics] = useState<ReservationDailyMetrics>(EMPTY_METRICS);
  const [nextArrival, setNextArrival] = useState<DailyArrival | null>(null);
  const [tab, setTab] = useState<Tab>('Today');
  const [search, setSearch] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<ReservationRow | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [guestMemory, setGuestMemory] = useState<GuestMemory | null>(null);
  const [guestLookupLoading, setGuestLookupLoading] = useState(false);
  const submittingRef = useRef(false);
  const phoneRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const selectedLocation = locations.find((item) => item.id === locationId);
    window.dispatchEvent(new CustomEvent('brain:context', {
      detail: {
        view: tab === 'Today' ? `Today · ${selectedDate}` : tab,
        location: selectedLocation?.name || 'All authorized locations',
      },
    }));
  }, [locationId, locations, selectedDate, tab]);

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
          from: selectedDate,
          to: offsetDate(30, selectedDate),
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
      if (tab === 'Today') params.set('date', selectedDate);
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
  }, [locationId, selectedDate, tab]);

  const loadDailySummary = useCallback(async () => {
    if (!locationId || !selectedDate) return;
    try {
      const params = new URLSearchParams({
        locationId,
        from: selectedDate,
        to: selectedDate,
        view: 'day',
      });
      const response = await fetch(`/api/reservations/calendar?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.data) throw new Error('summary');
      setDailyMetrics(payload.data.summary ?? EMPTY_METRICS);
      setDailyReservations(Array.isArray(payload.data.reservations) ? payload.data.reservations : []);
      setNextArrival(payload.data.nextArrival ?? null);
      const nextTimezone = typeof payload.data.timezone === 'string' ? payload.data.timezone : '';
      setTimezone(nextTimezone);
      const todayAtVenue = venueDate(nextTimezone);
      if (nextTimezone && selectedDate === localDate() && todayAtVenue !== selectedDate) {
        setSelectedDate(todayAtVenue);
        setForm((current) => ({
          ...current,
          date: current.date === localDate() ? todayAtVenue : current.date,
        }));
      }
    } catch {
      setDailyMetrics(EMPTY_METRICS);
      setDailyReservations([]);
      setNextArrival(null);
    }
  }, [locationId, selectedDate]);

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
    const timer = window.setTimeout(() => void loadDailySummary(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDailySummary]);

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

  const upcomingDaily = useMemo(
    () => dailyReservations
      .filter((row) => row.status === 'pending' || row.status === 'confirmed')
      .slice(0, 4),
    [dailyReservations],
  );

  function openComposer() {
    setForm((current) => ({
      ...current,
      date: selectedDate || current.date,
      locationId: locationId || current.locationId,
    }));
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
    if (form.guestCount === '' || form.guestCount < 1 || form.guestCount > 100 || !form.date || !form.time) {
      setMessage({ kind: 'error', text: 'Enter a valid date, time, and guest count from 1 to 100.' });
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const body = {
        ...form,
        guestCount: Number(form.guestCount),
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
      await Promise.all([loadReservations(), loadDailySummary()]);
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
      await Promise.all([loadReservations(), loadDailySummary()]);
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? title(error.message) : 'Status update failed.' });
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <main className="min-h-[calc(100dvh-6rem)] px-3 pb-24 sm:px-5 lg:px-0 lg:pb-10">
      <div className="overflow-hidden rounded-[28px] border border-black bg-white text-black shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
        <header className="border-b border-black px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-black">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]" />
                Reservation desk
              </div>
              <h1 className="mt-1.5 truncate text-2xl font-black tracking-tight sm:text-3xl">Reception overview</h1>
              <p className="mt-1 text-sm text-slate-400">{timezone || 'Venue local time'} · Availability stays staff-confirmed</p>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <label className="relative min-w-0 flex-1 sm:w-56">
                <span className="sr-only">Active location</span>
                <MapPin aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black" />
                <select
                  value={locationId}
                  onChange={(event) => {
                    setLocationId(event.target.value);
                    setForm((current) => ({ ...current, locationId: event.target.value }));
                  }}
                  className="ui-field min-h-11 w-full appearance-none rounded-xl pl-9 pr-9 text-sm font-semibold"
                >
                  {!locations.length ? <option value="">No active location</option> : null}
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              </label>
              <Link
                href="/dashboard/reservations/calendar"
                className="ui-button-secondary grid min-h-11 min-w-11 place-items-center rounded-xl p-0"
                aria-label="Open calendar"
              >
                <CalendarDays className="h-5 w-5" />
              </Link>
              <button
                type="button"
                onClick={openComposer}
                className="ui-button-primary hidden min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-black sm:flex"
              >
                <Plus className="h-4 w-4" /> New booking
                <kbd className="rounded bg-slate-950/10 px-1.5 py-0.5 text-[10px]">N</kbd>
              </button>
            </div>
          </div>
          <div className="mt-4 max-w-md">
            <ReservationDatePicker
              value={selectedDate}
              onChange={(value) => {
                if (!value) return;
                setSelectedDate(value);
                setTab('Today');
              }}
              timezone={timezone}
              allowClear={false}
              label="Dashboard date"
            />
          </div>
        </header>

        <section className="flex gap-2 overflow-x-auto border-b border-black px-4 py-3 sm:grid sm:grid-cols-4 sm:px-6 xl:grid-cols-8">
          <Metric label="Active reservations" value={dailyMetrics.activeReservations} hint="arrivals" />
          <Metric label="Expected guests" value={dailyMetrics.expectedGuests} hint="active covers" />
          <Metric label="Confirmed" value={dailyMetrics.confirmedReservations} hint="ready" />
          <Metric label="Pending" value={dailyMetrics.pendingReservations} hint="attention" />
          <Metric label="Waiting list" value={dailyMetrics.waitingListCount} hint={`${dailyMetrics.waitingListGuests} guests`} />
          <Metric label="Seated guests" value={dailyMetrics.seatedGuests} hint="in venue" />
          <Metric label="Cancelled" value={dailyMetrics.cancelledReservations} hint="excluded" />
          <Metric label="No-shows" value={dailyMetrics.noShowReservations} hint="excluded" />
        </section>

        <section className="border-b border-black px-4 py-3 sm:px-6 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Next arrival</p>
              <strong className="mt-1 block text-sm">{nextArrival ? `${nextArrival.time} · ${nextArrival.guestName}` : 'No active arrival'}</strong>
            </div>
            {nextArrival ? <span className="text-xs text-slate-400">{nextArrival.guestCount} guests</span> : null}
          </div>
        </section>

        <div className="grid min-h-[600px] lg:grid-cols-[minmax(0,1fr)_310px]">
          <section className="min-w-0 border-black lg:border-r">
            <div className="border-b border-black px-4 py-3 sm:px-6">
              <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2" aria-label="Reservation views">
                {TABS.map((item) => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => setTab(item)}
                    className={`min-h-9 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition ${
                      tab === item ? 'bg-black text-white' : 'border border-black bg-white text-black hover:bg-zinc-100'
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
                    ref={searchRef}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Guest or phone"
                    className="ui-field min-h-10 w-full rounded-xl pl-9 pr-3 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void loadReservations()}
                  disabled={listLoading}
                  className="ui-button-secondary grid min-h-10 min-w-10 place-items-center rounded-xl p-0"
                  aria-label="Refresh reservations"
                >
                  <RefreshCw className={`h-4 w-4 ${listLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {message ? (
              <div
                role="status"
                className={`ui-alert mx-4 mt-4 flex items-center gap-2 rounded-xl px-3.5 py-3 text-sm sm:mx-6 ${
                  message.kind === 'success' ? 'ui-alert-success' : 'ui-alert-error'
                }`}
              >
                {message.kind === 'success' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                {message.text}
              </div>
            ) : null}

            <div className="mobile-scroll-region divide-y divide-black">
              {listLoading ? (
                <div className="grid min-h-72 place-items-center text-slate-500">
                  <div className="text-center"><LoaderCircle className="mx-auto h-6 w-6 animate-spin" /><p className="mt-3 text-sm">Loading the desk…</p></div>
                </div>
              ) : tab === 'Waiting List' && visibleWaitlistRows.length ? visibleWaitlistRows.map((row) => (
                <article key={row.id} className="px-4 py-4 transition hover:bg-zinc-100 sm:px-6">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="w-[58px] shrink-0 pt-0.5 text-center sm:w-[72px]">
                      <p className="text-xl font-black tracking-tight text-black">{shortTime(row.preferred_time)}</p>
                      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-700">{formatDay(row.requested_date)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h2 className="font-bold text-black">Waiting-list party</h2>
                          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-800">
                            <span className="inline-flex items-center gap-1"><UsersRound className="h-3.5 w-3.5" />{row.guest_count}</span>
                            <span>{title(row.purpose)}</span>
                            <span>{title(row.seating_preference)}</span>
                          </p>
                        </div>
                        <StatusBadge
                          className="uppercase tracking-wide"
                          label={title(row.status)}
                          tone={statusTone[row.status] ?? 'info'}
                        />
                      </div>
                      <p className="mt-3 text-xs text-zinc-700">Guest details remain protected in the reservation record. Conversion controls are not yet available.</p>
                    </div>
                  </div>
                </article>
              )) : visibleRows.length ? visibleRows.map((row) => {
                const guestName = row.guest ? `${row.guest.first_name} ${row.guest.last_name}` : 'Guest';
                const actions = statusActions[row.status] ?? [];
                return (
                  <article
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${guestName} reservation`}
                    onClick={() => setEditingRow(row)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setEditingRow(row);
                      }
                    }}
                    className="group cursor-pointer px-4 py-4 transition hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none sm:px-6"
                  >
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="w-[58px] shrink-0 pt-0.5 text-center sm:w-[72px]">
                        <p className="text-xl font-black tracking-tight text-black">{shortTime(row.reservation_time)}</p>
                        <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-700">
                          {row.reservation_date === localDate() ? 'Today' : formatDay(row.reservation_date)}
                        </p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h2 className="truncate text-base font-bold text-black sm:text-lg">{guestName}</h2>
                              {row.notes ? <NotebookPen className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-label="Has notes" /> : null}
                            </div>
                            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-800">
                              <span className="inline-flex items-center gap-1"><UsersRound className="h-3.5 w-3.5" />{row.guest_count}</span>
                              <span>{title(row.purpose)}</span>
                              <span>{title(row.seating_preference)}</span>
                              <span className="hidden sm:inline">{title(row.source)}</span>
                            </p>
                          </div>
                          <StatusBadge
                            className="uppercase tracking-wide"
                            label={title(row.status)}
                            tone={statusTone[row.status] ?? 'info'}
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <a onClick={(event) => event.stopPropagation()} href={`tel:${row.guest?.phone_e164 ?? ''}`} className="ui-link inline-flex min-h-9 items-center gap-1.5 rounded-lg text-sm">
                            <Phone className="h-3.5 w-3.5" /> {row.guest?.phone_e164 ?? 'No phone'}
                          </a>
                          {actions.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {actions.map((action) => (
                                <button
                                  type="button"
                                  key={action.status}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void transition(row, action.status);
                                  }}
                                  disabled={updatingId === row.id}
                                  className={`${action.primary ? 'ui-button-primary' : 'ui-button-secondary'} min-h-9 rounded-lg px-3 text-xs font-bold transition`}
                                >
                                  {updatingId === row.id ? 'Saving…' : action.label}
                                </button>
                              ))}
                            </div>
                          ) : <span className="text-xs text-zinc-700">Tap to view</span>}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              }) : (
                <div className="grid min-h-72 place-items-center px-6 text-center">
                  <div>
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-black text-zinc-700">
                      <ListFilter className="h-5 w-5" />
                    </div>
                    <h2 className="mt-4 font-bold text-black">Nothing in this view</h2>
                    <p className="mt-1 max-w-xs text-sm text-zinc-700">Change the view or add a booking. No availability assumption is made.</p>
                    <button type="button" onClick={openComposer} className="ui-button-primary mt-4 min-h-10 rounded-xl px-4 text-sm font-black">New booking</button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="hidden border-l border-black bg-white p-5 text-black lg:block">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-black" />
              <h2 className="text-sm font-bold">Brain context</h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-700">Facts from reservation history only. No AI decision or automatic availability.</p>

            <div className="mt-5 rounded-2xl border border-black bg-white p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-700">Next arrival</p>
              {nextArrival ? (
                <>
                  <strong className="mt-2 block text-lg text-black">{nextArrival.time} · {nextArrival.guestName}</strong>
                  <span className="mt-1 block text-xs text-zinc-700">{nextArrival.guestCount} guests</span>
                </>
              ) : <p className="mt-2 text-sm text-slate-500">No pending or confirmed arrival.</p>}
              {upcomingDaily.length ? (
                <div className="mt-4 space-y-2 border-t border-black pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Upcoming reservations</p>
                  {upcomingDaily.map((arrival) => (
                    <div key={arrival.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-zinc-800">{shortTime(arrival.reservation_time)} · {arrival.guest?.name ?? 'Guest'}</span>
                      <span className="shrink-0 text-zinc-700">{arrival.guest_count}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-5 rounded-2xl border border-black bg-white p-4">
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
                        <span className="text-zinc-800">{label}</span>
                        <strong className="text-black">
                          {change > 0 ? '+' : ''}{change}
                        </strong>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4">
                  <p className="text-sm font-semibold text-black">History is still building</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-700">There is not enough comparable data for a factual trend yet.</p>
                </div>
              )}
            </div>

            <div className="ui-alert ui-alert-warning mt-4 rounded-2xl p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-black"><Armchair className="h-4 w-4" /> Availability unknown</p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-800">Capacity and table rules are not configured. Confirm or waitlist using staff judgment.</p>
            </div>

            <Link href="/dashboard/reservations/calendar" className="ui-button-secondary mt-4 flex min-h-11 items-center justify-between rounded-xl px-3.5 text-sm font-semibold">
              Open calendar <CalendarDays className="h-4 w-4" />
            </Link>
          </aside>
        </div>
      </div>

      <button
        type="button"
        onClick={openComposer}
        className="ui-button-primary fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-1/2 z-30 min-h-13 -translate-x-1/2 rounded-2xl px-6 shadow-2xl sm:hidden"
      >
        <Plus className="h-5 w-5" /> New booking
      </button>

      {composerOpen ? (
        <div className="ui-overlay fixed inset-0 z-50 backdrop-blur-sm" role="presentation">
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="New reservation"
            className="ui-inverse absolute inset-0 flex w-full min-w-0 max-w-full flex-col border shadow-2xl sm:inset-y-3 sm:left-auto sm:right-3 sm:w-[min(560px,calc(100vw-1.5rem))] sm:rounded-[28px]"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-white px-4 py-3.5 sm:px-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">Call mode</p>
                <h2 className="mt-0.5 text-xl font-black">Quick booking</h2>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={clearComposer} disabled={saving} className="min-h-10 rounded-xl px-3 text-xs font-semibold text-white hover:bg-slate-900">Clear</button>
                <button type="button" onClick={() => setComposerOpen(false)} disabled={saving} className="grid min-h-10 min-w-10 place-items-center rounded-xl border border-white text-white hover:bg-slate-900" aria-label="Close booking form">
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
              className="mobile-scroll-region min-w-0 flex-1 overflow-y-auto"
            >
              <div className="space-y-6 px-4 py-5 sm:px-5">
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-bold"><Phone className="h-4 w-4 text-white" /> Caller</h3>
                    {guestLookupLoading ? <span className="flex items-center gap-1 text-[11px] text-slate-300"><LoaderCircle className="h-3 w-3 animate-spin" /> Checking history</span> : null}
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
                    <div className="mt-3 rounded-2xl border border-white bg-black p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="flex items-center gap-1.5 text-sm font-bold text-white"><UserRound className="h-4 w-4" /> Returning guest · {guestMemory.name}</p>
                          <p className="mt-1 text-xs text-slate-300">{guestMemory.reservationCount} prior reservation{guestMemory.reservationCount === 1 ? '' : 's'} · latest {formatDay(guestMemory.latestDate)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            set('guestCount', guestMemory.usualPartySize);
                            if (guestMemory.seatingPreference) set('seatingPreference', guestMemory.seatingPreference);
                          }}
                          className="ui-button-primary min-h-9 shrink-0 rounded-lg px-2.5 text-xs"
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

                <section className="border-t border-white pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-bold"><UsersRound className="h-4 w-4 text-white" /> Party</h3>
                  <div className="mt-3">
                    <GuestCountInput value={form.guestCount} onChange={(value) => set('guestCount', value)} />
                  </div>
                </section>

                <section className="border-t border-white pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-bold"><CalendarDays className="h-4 w-4 text-white" /> When</h3>
                  <div className="mt-3 space-y-3">
                    <ReservationDatePicker
                      value={form.date}
                      onChange={(value) => set('date', value)}
                      timezone={timezone}
                    />
                    <ReservationTimeInput
                      value={form.time}
                      onChange={(value) => set('time', value)}
                      timezone={timezone}
                    />
                  </div>
                  <div className="mt-3">
                    <span className={labelClass}>Duration</span>
                    <div className="mt-1.5 flex gap-2">
                      {[90, 120, 150].map((minutes) => <Choice key={minutes} active={form.expectedDurationMinutes === minutes} onClick={() => set('expectedDurationMinutes', minutes)}>{minutes / 60 % 1 ? `${minutes / 60} hr` : `${minutes / 60} hrs`}</Choice>)}
                      <select value={form.expectedDurationMinutes} onChange={(event) => set('expectedDurationMinutes', Number(event.target.value))} className="ui-field min-h-10 min-w-0 flex-1 rounded-xl px-2 text-sm">
                        {[60, 90, 120, 150, 180, 240].map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
                      </select>
                    </div>
                  </div>
                </section>

                <section className="border-t border-white pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4 text-white" /> Occasion & seating</h3>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {QUICK_PURPOSES.map((purpose) => <Choice key={purpose} active={form.purpose === purpose} onClick={() => set('purpose', purpose)}>{title(purpose)}</Choice>)}
                    <select value={form.purpose} onChange={(event) => set('purpose', event.target.value)} className="ui-field min-h-10 min-w-[105px] rounded-xl px-2 text-sm">
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

                <section className="border-t border-white pt-5">
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
                  <details className="mt-3 rounded-xl border border-white bg-black">
                    <summary className="cursor-pointer list-none px-3.5 py-3 text-sm font-semibold text-white">Add internal notes</summary>
                    <div className="border-t border-white p-3">
                      <textarea maxLength={2000} rows={3} value={form.notes} onChange={(event) => set('notes', event.target.value)} placeholder="Allergies, accessibility, service notes…" className="ui-field w-full resize-none rounded-xl p-3 text-sm" />
                    </div>
                  </details>
                </section>

                <section className="border-t border-white pt-5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.waitlist}
                    onClick={() => set('waitlist', !form.waitlist)}
                    className={`flex w-full items-center justify-between rounded-2xl border p-3.5 text-left transition ${
                      form.waitlist ? 'border-white bg-white text-black' : 'border-white bg-black text-white'
                    }`}
                  >
                    <span><strong className="block text-sm">Add to waiting list</strong><span className={`mt-0.5 block text-xs ${form.waitlist ? 'text-slate-700' : 'text-slate-300'}`}>Use when staff cannot confirm availability.</span></span>
                    <span className={`relative h-6 w-11 rounded-full border transition ${form.waitlist ? 'border-black bg-black' : 'border-white bg-white'}`}><span className={`absolute top-1 h-4 w-4 rounded-full transition ${form.waitlist ? 'left-6 bg-white' : 'left-1 bg-black'}`} /></span>
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

            <footer className="shrink-0 border-t border-white bg-black p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:rounded-b-[28px] sm:px-5">
              <div className="mb-3 flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-slate-300">{form.guestCount || '—'} guests · {form.date ? formatDay(form.date) : 'Choose date'} at {form.time || '—'}</span>
                <span className="shrink-0 text-white">Availability unknown</span>
              </div>
              <button
                type="submit"
                form="reservation-quick-form"
                disabled={saving || !form.locationId || form.guestCount === '' || !form.date || !form.time}
                className={`min-h-13 w-full rounded-2xl ${
                  form.waitlist ? 'ui-button-secondary' : 'ui-button-primary'
                }`}
              >
                {saving ? <><LoaderCircle className="h-5 w-5 animate-spin" /> Saving once…</> : form.waitlist ? 'Add to waiting list' : 'Save reservation'}
              </button>
              <p className="mt-2 text-center text-[10px] text-slate-300">Ctrl / ⌘ + Enter to save · one submission only</p>
            </footer>
          </aside>
        </div>
      ) : null}

      {editingRow ? (
        <ReservationEditPanel
          row={editingRow as EditableReservation}
          timezone={timezone}
          onClose={() => setEditingRow(null)}
          onSaved={async () => {
            setMessage({ kind: 'success', text: 'Reservation updated.' });
            await Promise.all([loadReservations(), loadDailySummary()]);
          }}
        />
      ) : null}
    </main>
  );
}
