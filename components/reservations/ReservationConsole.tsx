'use client';

import Link from 'next/link';
import {
  ArrowDownUp,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  LoaderCircle,
  MapPin,
  NotebookPen,
  Phone,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/components/LocaleProvider';
import { ReservationEditPanel, type EditableReservation } from '@/components/reservations/ReservationEditPanel';
import {
  GuestCountInput,
  ReservationDatePicker,
  ReservationTimeInput,
} from '@/components/reservations/ReservationInputs';
import {
  ReservationRebookPanel,
  type RebookableReservation,
} from '@/components/reservations/ReservationRebookPanel';
import type { ReservationDailyMetrics } from '@/lib/reservations/metrics';
import {
  projectReservationDeskRows,
  shiftVenueDate,
  type ReservationDeskFilter,
  type ReservationDeskSort,
} from '@/lib/reservations/desk';
import { normalizePhone } from '@/lib/reservations/phone';
import { venueDate } from '@/lib/reservations/time';

const PURPOSES = ['regular', 'birthday', 'anniversary', 'business', 'engagement', 'bachelor', 'bachelorette', 'family', 'event', 'other'] as const;
const QUICK_PURPOSES = ['regular', 'birthday', 'business', 'event'] as const;
const SOURCES = ['manual', 'phone', 'whatsapp', 'instagram', 'website', 'google', 'walk_in', 'other'] as const;
const SEATING = ['no_preference', 'indoor', 'outdoor', 'bar', 'vip'] as const;
const COUNTRY_CODES = [
  '+961', '+971', '+966', '+974', '+965', '+962', '+33', '+44', '+1',
] as const;
const FILTERS = ['all', 'active', 'waiting', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'] as const;
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
  history?: {
    id: string;
    previous_status: string | null;
    new_status: string;
    reason: string | null;
    changed_at: string;
  }[];
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
const shortTime = (value: string) => String(value).slice(0, 5);
const formatDay = (value: string, locale?: string) => new Intl.DateTimeFormat(locale, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
}).format(new Date(`${value}T12:00:00`));
const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.055] px-3.5 text-[15px] text-white transition placeholder:text-slate-600 hover:border-white/20 focus:border-cyan-400/60 focus:bg-white/[0.075] focus:outline-none';
const labelClass = 'text-xs font-semibold uppercase tracking-[0.12em] text-slate-400';

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

const statusTone: Record<string, string> = {
  pending: 'border-amber-300/20 bg-amber-300/10 text-amber-200',
  confirmed: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200',
  waitlisted: 'border-violet-300/20 bg-violet-300/10 text-violet-200',
  seated: 'border-cyan-300/20 bg-cyan-300/10 text-cyan-200',
  completed: 'border-slate-300/15 bg-slate-300/5 text-slate-300',
  cancelled: 'border-rose-300/20 bg-rose-300/10 text-rose-200',
  no_show: 'border-orange-300/20 bg-orange-300/10 text-orange-200',
};

const statusActions: Record<string, { action: 'confirm' | 'waitlist' | 'seat' | 'complete' | 'cancel' | 'noShow'; status: string; primary?: boolean }[]> = {
  pending: [
    { action: 'confirm', status: 'confirmed', primary: true },
    { action: 'waitlist', status: 'waitlisted' },
    { action: 'cancel', status: 'cancelled' },
  ],
  confirmed: [
    { action: 'seat', status: 'seated', primary: true },
    { action: 'noShow', status: 'no_show' },
    { action: 'cancel', status: 'cancelled' },
  ],
  waitlisted: [
    { action: 'confirm', status: 'confirmed', primary: true },
    { action: 'cancel', status: 'cancelled' },
  ],
  seated: [{ action: 'complete', status: 'completed', primary: true }],
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
  mobileLabel,
  value,
  hint,
}: {
  label: string;
  mobileLabel?: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.035] px-1.5 py-1.5 sm:rounded-2xl sm:px-4 sm:py-3">
      <div className="flex items-baseline justify-between gap-2 sm:gap-3">
        <span className="text-lg font-black leading-none tracking-tight text-white sm:text-2xl sm:leading-normal">{value}</span>
        <span className="hidden text-[11px] text-slate-500 sm:inline">{hint}</span>
      </div>
      <p className="mt-1 truncate text-[10px] font-medium leading-none text-slate-400 sm:mt-0.5 sm:text-xs sm:leading-normal">
        <span className="sm:hidden">{mobileLabel ?? label}</span>
        <span className="hidden sm:inline">{label}</span>
      </p>
    </div>
  );
}

export function ReservationConsole() {
  const { language, messages: translations } = useLocale();
  const copy = translations.reservationDesk;
  const rebookCopy = translations.reservationRebook;
  const locale = language === 'ar' ? 'ar-LB' : 'en';
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => localDate());
  const [timezone, setTimezone] = useState('');
  const [form, setForm] = useState(() => createInitialForm());
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [waitlistRows, setWaitlistRows] = useState<WaitlistRow[]>([]);
  const [dailyMetrics, setDailyMetrics] = useState<ReservationDailyMetrics>(EMPTY_METRICS);
  const [filter, setFilter] = useState<ReservationDeskFilter>('all');
  const [sort, setSort] = useState<ReservationDeskSort>('time_asc');
  const [mobileControls, setMobileControls] = useState<'search' | 'filters' | 'sort' | null>(null);
  const [search, setSearch] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<ReservationRow | null>(null);
  const [rebookingRow, setRebookingRow] = useState<RebookableReservation | null>(null);
  const [preparingRebookId, setPreparingRebookId] = useState<string | null>(null);
  const [preparingDetailsId, setPreparingDetailsId] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [guestMemory, setGuestMemory] = useState<GuestMemory | null>(null);
  const [guestLookupLoading, setGuestLookupLoading] = useState(false);
  const submittingRef = useRef(false);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const selectedLocation = locations.find((item) => item.id === locationId);
    window.dispatchEvent(new CustomEvent('brain:context', {
      detail: {
        view: `${copy.title} · ${selectedDate}`,
        location: selectedLocation?.name || copy.noActiveLocation,
      },
    }));
  }, [copy.noActiveLocation, copy.title, locationId, locations, selectedDate]);

  const set = (key: keyof ReturnType<typeof createInitialForm>, value: string | number | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const loadReservations = useCallback(async () => {
    if (!locationId) return;
    setListLoading(true);
    try {
      if (filter === 'waiting') {
        const calendarParams = new URLSearchParams({
          locationId,
          from: selectedDate,
          to: selectedDate,
          view: 'day',
        });
        const response = await fetch(`/api/reservations/calendar?${calendarParams}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.data?.waitlist)) throw new Error('load');
        setRows([]);
        setWaitlistRows(payload.data.waitlist);
        return;
      }
      const params = new URLSearchParams({ limit: '100', locationId, date: selectedDate });
      const response = await fetch(`/api/reservations?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.data?.reservations)) throw new Error('load');
      setRows(payload.data.reservations as ReservationRow[]);
      setWaitlistRows([]);
    } catch {
      setRows([]);
      setWaitlistRows([]);
      setMessage({ kind: 'error', text: copy.loadFailed });
    } finally {
      setListLoading(false);
    }
  }, [copy.loadFailed, filter, locationId, selectedDate]);

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
    const timer = window.setTimeout(() => firstNameRef.current?.focus(), 80);
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
    return projectReservationDeskRows(rows, search, filter, sort);
  }, [filter, rows, search, sort]);

  const visibleWaitlistRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? waitlistRows.filter((row) => `${row.requested_date} ${row.preferred_time} ${row.purpose} ${row.status} ${row.seating_preference}`.toLowerCase().includes(needle))
      : waitlistRows;
    return filtered.toSorted((left, right) =>
      sort === 'time_desc'
        ? right.preferred_time.localeCompare(left.preferred_time)
        : left.preferred_time.localeCompare(right.preferred_time));
  }, [search, sort, waitlistRows]);

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
    window.setTimeout(() => firstNameRef.current?.focus(), 0);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (form.guestCount === '' || form.guestCount < 1 || form.guestCount > 100 || !form.date || !form.time) {
      setMessage({ kind: 'error', text: copy.form.invalid });
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
        text: form.waitlist ? copy.form.waitlistSaved : copy.form.saved,
      });
      setComposerOpen(false);
      setForm(createInitialForm(locationId));
      setGuestMemory(null);
      await Promise.all([loadReservations(), loadDailySummary()]);
    } catch {
      setMessage({
        kind: 'error',
        text: copy.form.failed,
      });
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  async function transition(row: ReservationRow, nextStatus: string) {
    if (['cancelled', 'no_show'].includes(nextStatus)
      && !window.confirm(copy.details.confirmCancel)) return;
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
      setMessage({ kind: 'success', text: copy.status[nextStatus as keyof typeof copy.status] });
      await Promise.all([loadReservations(), loadDailySummary()]);
    } catch {
      setMessage({ kind: 'error', text: copy.form.failed });
    } finally {
      setUpdatingId(null);
    }
  }

  async function openDetails(row: ReservationRow) {
    if (preparingDetailsId) return;
    setPreparingDetailsId(row.id);
    try {
      const response = await fetch(`/api/reservations/${row.id}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      setEditingRow(response.ok && payload?.data ? payload.data as ReservationRow : row);
    } finally {
      setPreparingDetailsId(null);
    }
  }

  async function prepareRebook(row: ReservationRow) {
    if (!['cancelled', 'no_show'].includes(row.status) || preparingRebookId) return;
    setPreparingRebookId(row.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/reservations/${row.id}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.data || !['cancelled', 'no_show'].includes(payload.data.status)) {
        throw new Error(rebookCopy.failed);
      }
      setRebookingRow(payload.data as RebookableReservation);
    } catch (failure) {
      setMessage({ kind: 'error', text: failure instanceof Error ? failure.message : rebookCopy.failed });
    } finally {
      setPreparingRebookId(null);
    }
  }

  return (
    <main data-reservation-desk className="min-h-[calc(100dvh-6rem)] min-w-0 max-w-full overflow-x-clip pb-0 sm:px-5 sm:pb-24 lg:px-0 lg:pb-10">
      <div className="overflow-hidden bg-[var(--surface-nav)] sm:rounded-[28px] sm:border sm:border-white/[0.09] sm:shadow-[0_32px_100px_rgba(0,0,0,0.42)]">
        <header className="border-b border-white/[0.07] px-3 py-2 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
            <div className="min-w-0">
              <div className="hidden items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300 sm:flex">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]" />
                {copy.eyebrow}
              </div>
              <h1 className="truncate text-xl font-black tracking-tight sm:mt-1.5 sm:text-3xl">{copy.title}</h1>
              <p className="mt-0.5 text-[11px] text-slate-400 sm:mt-1 sm:text-sm">
                {timezone || copy.venueLocalTime}<span className="hidden sm:inline"> · {copy.availabilityStaffConfirmed}</span>
              </p>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <label className="relative min-w-0 flex-1 sm:w-56">
                <span className="sr-only">{copy.activeLocation}</span>
                <MapPin aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300" />
                <select
                  value={locationId}
                  onChange={(event) => {
                    setLocationId(event.target.value);
                    setForm((current) => ({ ...current, locationId: event.target.value }));
                  }}
                  className="min-h-11 w-full appearance-none rounded-xl border border-white/10 bg-white/[0.055] ps-9 pe-9 text-sm font-semibold"
                >
                  {!locations.length ? <option value="">{copy.noActiveLocation}</option> : null}
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              </label>
              <Link
                href="/dashboard/reservations/calendar"
                className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08]"
                aria-label={copy.openCalendar}
              >
                <CalendarDays className="h-5 w-5" />
              </Link>
              <button
                type="button"
                onClick={openComposer}
                className="hidden min-h-11 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 shadow-[0_10px_30px_rgba(34,211,238,0.18)] transition hover:bg-cyan-200 sm:flex"
              >
                <Plus className="h-4 w-4" /> {copy.newBooking}
                <kbd className="rounded bg-slate-950/10 px-1.5 py-0.5 text-[10px]">N</kbd>
              </button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5 sm:mt-4 sm:gap-2">
            <button
              type="button"
              onClick={() => setSelectedDate((current) => shiftVenueDate(current, -1))}
              className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/10 text-slate-300 hover:bg-white/[0.06] sm:min-h-12 sm:min-w-12"
              aria-label={copy.previousDate}
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
            </button>
            <div className="min-w-0 flex-1 sm:max-w-md">
              <ReservationDatePicker
                value={selectedDate}
                onChange={(value) => {
                  if (!value) return;
                  setSelectedDate(value);
                  setFilter('all');
                }}
                timezone={timezone}
                allowClear={false}
                label={copy.selectedDate}
                locale={locale}
                copy={copy.dateCopy}
                compactOnMobile
              />
            </div>
            <button
              type="button"
              onClick={() => setSelectedDate((current) => shiftVenueDate(current, 1))}
              className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/10 text-slate-300 hover:bg-white/[0.06] sm:min-h-12 sm:min-w-12"
              aria-label={copy.nextDate}
            >
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </button>
          </div>
        </header>

        <section className="grid grid-cols-3 gap-1 border-b border-white/[0.07] px-3 py-1.5 sm:gap-2 sm:px-6 sm:py-3">
          <Metric label={copy.reservationCount} value={dailyMetrics.activeReservations} hint={copy.today} />
          <Metric label={copy.guestCount} mobileLabel={copy.guests} value={dailyMetrics.expectedGuests} hint={copy.activeCovers} />
          <Metric label={copy.waitingCount} value={dailyMetrics.waitingListCount} hint={`${dailyMetrics.waitingListGuests} ${copy.guests}`} />
        </section>

        <div className="sm:min-h-[600px]">
          <section className="min-w-0">
            <div className={`border-b border-white/[0.07] px-3 py-2 sm:block sm:px-6 sm:py-3 ${mobileControls ? 'block' : 'hidden'}`}>
              <nav className={`-mx-1 gap-1 overflow-x-auto px-1 pb-2 sm:flex ${mobileControls === 'filters' ? 'flex' : 'hidden'}`} aria-label={copy.toolbar.filters}>
                {FILTERS.map((item) => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => {
                      setFilter(item);
                      setMobileControls(null);
                    }}
                    className={`min-h-9 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition ${
                      filter === item ? 'bg-cyan-300 text-slate-950' : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    {copy.filters[item]}
                  </button>
                ))}
              </nav>
              <div className={`mt-1 items-center gap-2 sm:flex ${mobileControls === 'search' || mobileControls === 'sort' ? 'flex' : 'hidden'}`}>
                <label className={`relative min-w-0 flex-1 sm:flex ${mobileControls === 'search' ? 'flex' : 'hidden'}`}>
                  <span className="sr-only">{copy.searchLabel}</span>
                  <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={copy.searchPlaceholder}
                    className="min-h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.035] ps-9 pe-3 text-sm placeholder:text-slate-600 focus:border-cyan-300/40 focus:outline-none"
                  />
                </label>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as ReservationDeskSort)}
                  className={`min-h-10 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-sm text-slate-300 sm:block sm:flex-none ${mobileControls === 'sort' ? 'block' : 'hidden'}`}
                  aria-label={copy.sort.label}
                >
                  {(['time_asc', 'time_desc', 'guest_name', 'party_size'] as const).map((item) => (
                    <option key={item} value={item}>{copy.sort[item]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void loadReservations()}
                  disabled={listLoading}
                  className="hidden min-h-10 min-w-10 place-items-center rounded-xl border border-white/[0.08] text-slate-400 hover:bg-white/[0.05] sm:grid"
                  aria-label={copy.refresh}
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

            <div data-reservation-list className="mobile-scroll-region scroll-pb-[calc(7.75rem+env(safe-area-inset-bottom))] divide-y divide-white/[0.065] pb-[calc(7.75rem+env(safe-area-inset-bottom))] sm:scroll-pb-0 sm:pb-0">
              {listLoading ? (
                <div className="grid place-items-center px-4 py-12 text-slate-500">
                  <div className="text-center"><LoaderCircle className="mx-auto h-6 w-6 animate-spin" /><p className="mt-3 text-sm">{copy.loading}</p></div>
                </div>
              ) : filter === 'waiting' && visibleWaitlistRows.length ? visibleWaitlistRows.map((row) => (
                <article key={row.id} className="px-3 py-2.5 transition hover:bg-white/[0.025] sm:px-6 sm:py-4">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="w-[52px] shrink-0 pt-0.5 text-start sm:w-[72px] sm:text-center">
                      <p className="whitespace-nowrap text-lg font-black tracking-tight text-white sm:text-xl">{shortTime(row.preferred_time)}</p>
                      <p className="mt-0.5 hidden whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:block">{formatDay(row.requested_date, locale)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h2 className="font-bold text-white">{copy.waitingParty}</h2>
                          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
                            <span className="inline-flex items-center gap-1"><UsersRound className="h-3.5 w-3.5" />{row.guest_count}</span>
                            <span>{copy.purpose[row.purpose as keyof typeof copy.purpose] ?? row.purpose}</span>
                            <span>{copy.seating[row.seating_preference as keyof typeof copy.seating] ?? row.seating_preference}</span>
                          </p>
                        </div>
                        <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-violet-200">{copy.status[row.status as keyof typeof copy.status] ?? row.status}</span>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">{copy.waitingProtected}</p>
                    </div>
                  </div>
                </article>
              )) : visibleRows.length ? visibleRows.map((row) => {
                const guestName = row.guest ? `${row.guest.first_name} ${row.guest.last_name}` : copy.guest;
                const actions = statusActions[row.status] ?? [];
                const mobilePrimaryAction = row.status === 'pending'
                  ? actions.find((action) => action.primary)
                  : undefined;
                return (
                  <article
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${guestName} reservation`}
                    onClick={() => void openDetails(row)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void openDetails(row);
                      }
                    }}
                    className="group scroll-mb-[calc(7.75rem+env(safe-area-inset-bottom))] cursor-pointer px-3 py-2.5 transition hover:bg-white/[0.04] focus:bg-white/[0.04] focus:outline-none sm:scroll-mb-0 sm:px-6 sm:py-4"
                  >
                    <div className="sm:hidden">
                      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                        <p className="whitespace-nowrap text-lg font-black leading-6 tracking-tight text-white">{shortTime(row.reservation_time)}</p>
                        <h2 className="line-clamp-2 min-w-0 text-sm font-bold leading-5 text-white">{guestName}</h2>
                        <span className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase leading-4 tracking-wide ${statusTone[row.status] ?? statusTone.completed}`}>
                          {copy.status[row.status as keyof typeof copy.status] ?? row.status}
                        </span>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-slate-400">
                        <span className="inline-flex shrink-0 items-center gap-1"><UsersRound className="h-3.5 w-3.5" />{row.guest_count}</span>
                        <span className="min-w-0 truncate">{copy.seating[row.seating_preference as keyof typeof copy.seating] ?? row.seating_preference}</span>
                        {row.purpose !== 'regular' ? <span className="min-w-0 truncate text-cyan-100/75">{copy.purpose[row.purpose as keyof typeof copy.purpose] ?? row.purpose}</span> : null}
                        {mobilePrimaryAction ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void transition(row, mobilePrimaryAction.status);
                            }}
                            disabled={updatingId === row.id}
                            className="ms-auto min-h-11 shrink-0 rounded-lg bg-cyan-300 px-3 text-xs font-bold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
                          >
                            {updatingId === row.id ? copy.actions.saving : copy.actions[mobilePrimaryAction.action]}
                          </button>
                        ) : null}
                      </div>
                      {row.notes ? (
                        <p className="mt-1 min-w-0 truncate text-xs text-amber-100/75">
                          <NotebookPen className="me-1 inline h-3.5 w-3.5 align-text-bottom text-amber-300" aria-hidden />
                          <span className="font-semibold">{copy.hasNotes}:</span> {row.notes}
                        </p>
                      ) : row.guest?.phone_e164 ? (
                        <a
                          onClick={(event) => event.stopPropagation()}
                          href={`tel:${row.guest.phone_e164}`}
                          dir="ltr"
                          className="mt-1 inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-xs text-slate-500 hover:text-cyan-200"
                        >
                          <Phone className="h-3.5 w-3.5" /> <bdi>{row.guest.phone_e164}</bdi>
                        </a>
                      ) : null}
                    </div>
                    <div className="hidden items-start gap-3 sm:flex sm:gap-4">
                      <div className="w-[58px] shrink-0 pt-0.5 text-center sm:w-[72px]">
                        <p className="text-xl font-black tracking-tight text-white">{shortTime(row.reservation_time)}</p>
                        <p className="mt-0.5 whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          {row.reservation_date === venueDate(timezone) ? copy.today : formatDay(row.reservation_date, locale)}
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
                              <span>{copy.purpose[row.purpose as keyof typeof copy.purpose] ?? row.purpose}</span>
                              <span>{copy.seating[row.seating_preference as keyof typeof copy.seating] ?? row.seating_preference}</span>
                              <span className="hidden sm:inline">{copy.source[row.source as keyof typeof copy.source] ?? row.source}</span>
                            </p>
                          </div>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusTone[row.status] ?? statusTone.completed}`}>
                            {copy.status[row.status as keyof typeof copy.status] ?? row.status}
                          </span>
                        </div>
                        {row.purpose_details ? <p className="mt-2 text-sm text-cyan-100/75">{row.purpose_details}</p> : null}
                        {row.notes ? (
                          <p className="mt-2 break-words rounded-lg border border-amber-300/10 bg-amber-300/[0.045] px-3 py-2 text-sm leading-relaxed text-amber-100/80">
                            <span className="font-bold">{copy.hasNotes}:</span> {row.notes}
                          </p>
                        ) : null}
                        {row.creator?.full_name ? <p className="mt-2 text-xs text-slate-500">{copy.createdBy} · {row.creator.full_name}</p> : null}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <a onClick={(event) => event.stopPropagation()} href={`tel:${row.guest?.phone_e164 ?? ''}`} dir="ltr" className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg text-sm text-slate-400 hover:text-cyan-200">
                            <Phone className="h-3.5 w-3.5" /> <bdi>{row.guest?.phone_e164 ?? copy.noPhone}</bdi>
                          </a>
                          {actions.length || ['cancelled', 'no_show'].includes(row.status) ? (
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
                                  className={`min-h-9 rounded-lg px-3 text-xs font-bold transition disabled:opacity-50 ${
                                    action.primary
                                      ? 'bg-cyan-300 text-slate-950 hover:bg-cyan-200'
                                      : 'border border-white/10 text-slate-300 hover:bg-white/[0.07]'
                                  }`}
                                >
                                  {updatingId === row.id ? copy.actions.saving : copy.actions[action.action]}
                                </button>
                              ))}
                              {['cancelled', 'no_show'].includes(row.status) ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void prepareRebook(row);
                                  }}
                                  disabled={preparingRebookId === row.id}
                                  className="min-h-9 rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 text-xs font-bold text-cyan-100 transition hover:bg-cyan-300/20 focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:opacity-50"
                                >
                                  {preparingRebookId === row.id ? rebookCopy.preparing : rebookCopy.action}
                                </button>
                              ) : null}
                            </div>
                          ) : <span className="text-xs text-slate-600">{preparingDetailsId === row.id ? copy.loading : copy.tapToView}</span>}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              }) : (
                <div className="grid place-items-center px-6 py-10 text-center sm:py-16">
                  <div>
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-white/15 text-slate-500">
                      <ListFilter className="h-5 w-5" />
                    </div>
                    <h2 className="mt-4 font-bold text-white">{copy.emptyTitle}</h2>
                    <p className="mt-1 max-w-xs text-sm text-slate-500">{copy.emptyHelp}</p>
                    <button type="button" onClick={openComposer} className="mt-4 min-h-10 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950">{copy.newBooking}</button>
                  </div>
                </div>
              )}
            </div>
          </section>

        </div>
      </div>

      <nav
        aria-label={copy.eyebrow}
        data-reservation-mobile-actions
        className="fixed inset-x-3 bottom-[calc(4.375rem+env(safe-area-inset-bottom))] z-40 flex min-w-0 items-stretch gap-1 sm:hidden"
      >
        <button
          type="button"
          onClick={() => {
            const opening = mobileControls !== 'search';
            setMobileControls(opening ? 'search' : null);
            if (opening) window.setTimeout(() => searchRef.current?.focus(), 0);
          }}
          aria-label={copy.toolbar.search}
          aria-pressed={mobileControls === 'search'}
          className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-[#101822] text-slate-300 shadow-lg aria-pressed:border-cyan-300/35 aria-pressed:text-cyan-200"
        >
          <Search className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setMobileControls((current) => current === 'filters' ? null : 'filters')} aria-label={copy.toolbar.filters} aria-pressed={mobileControls === 'filters'} className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-[#101822] text-slate-300 shadow-lg aria-pressed:border-cyan-300/35 aria-pressed:text-cyan-200">
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setMobileControls((current) => current === 'sort' ? null : 'sort')} aria-label={copy.toolbar.sort} aria-pressed={mobileControls === 'sort'} className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-[#101822] text-slate-300 shadow-lg aria-pressed:border-cyan-300/35 aria-pressed:text-cyan-200">
          <ArrowDownUp className="h-4 w-4" />
        </button>
        <button type="button" onClick={openComposer} className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-3 text-sm font-black text-slate-950 shadow-[0_10px_28px_rgba(34,211,238,0.22)]">
          <Plus className="h-4 w-4 shrink-0" /> <span className="truncate">{copy.newBooking}</span>
        </button>
      </nav>

      {composerOpen ? (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" role="presentation">
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={copy.form.title}
            className="absolute inset-0 flex max-h-dvh w-full min-w-0 max-w-full flex-col border-white/10 bg-[#0a0e14] shadow-2xl sm:inset-y-3 sm:start-auto sm:end-3 sm:w-[min(560px,calc(100vw-1.5rem))] sm:rounded-[28px] sm:border"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-4 py-3.5 sm:px-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">{copy.form.mode}</p>
                <h2 className="mt-0.5 text-xl font-black">{copy.form.title}</h2>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={clearComposer} disabled={saving} className="min-h-10 rounded-xl px-3 text-xs font-semibold text-slate-400 hover:bg-white/[0.05]">{copy.form.clear}</button>
                <button type="button" onClick={() => setComposerOpen(false)} disabled={saving} className="grid min-h-10 min-w-10 place-items-center rounded-xl border border-white/[0.08] text-slate-400 hover:bg-white/[0.05]" aria-label={copy.form.close}>
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
              className="mobile-scroll-region min-h-0 min-w-0 flex-1 overflow-y-auto"
            >
              <div className="space-y-6 px-4 py-5 sm:px-5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.source === 'walk_in'}
                  onClick={() => set('source', form.source === 'walk_in' ? 'phone' : 'walk_in')}
                  className={`flex w-full items-center justify-between rounded-2xl border p-3.5 text-start transition ${form.source === 'walk_in' ? 'border-cyan-300/35 bg-cyan-300/[0.08]' : 'border-white/[0.08] bg-white/[0.025]'}`}
                >
                  <span><strong className="block text-sm">{copy.form.walkIn}</strong><span className="mt-0.5 block text-xs text-slate-500">{copy.form.walkInHelp}</span></span>
                  <span className={`relative h-6 w-11 rounded-full transition ${form.source === 'walk_in' ? 'bg-cyan-300' : 'bg-slate-700'}`}><span className={`absolute top-1 start-1 h-4 w-4 rounded-full bg-slate-950 transition ${form.source === 'walk_in' ? 'translate-x-5 rtl:-translate-x-5' : ''}`} /></span>
                </button>

                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-bold"><UserRound className="h-4 w-4 text-cyan-300" /> {copy.form.guestDetails}</h3>
                    {guestLookupLoading ? <span className="flex items-center gap-1 text-[11px] text-slate-500"><LoaderCircle className="h-3 w-3 animate-spin" /> {copy.form.checkingHistory}</span> : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label><span className={labelClass}>{copy.form.firstName}</span><input ref={firstNameRef} required maxLength={80} autoComplete="given-name" value={form.firstName} onChange={(event) => set('firstName', event.target.value)} className={inputClass} /></label>
                    <label><span className={labelClass}>{copy.form.lastName}</span><input required maxLength={80} autoComplete="family-name" value={form.lastName} onChange={(event) => set('lastName', event.target.value)} className={inputClass} /></label>
                  </div>
                  <div className="mt-3 grid grid-cols-[116px_minmax(0,1fr)] gap-2">
                    <label>
                      <span className={labelClass}>{copy.form.countryCode}</span>
                      <input list="reservation-country-codes" required value={form.countryCallingCode} onChange={(event) => { setGuestMemory(null); set('countryCallingCode', event.target.value); }} className={inputClass} />
                      <datalist id="reservation-country-codes">{COUNTRY_CODES.map((code) => <option key={code} value={code} />)}</datalist>
                    </label>
                    <label><span className={labelClass}>{copy.form.phone}</span><input required inputMode="tel" autoComplete="tel-national" placeholder="03 123 456" value={form.phoneNumber} onChange={(event) => { setGuestMemory(null); set('phoneNumber', event.target.value); }} className={inputClass} /></label>
                  </div>
                  {guestMemory ? (
                    <div className="mt-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.07] p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="flex items-center gap-1.5 text-sm font-bold text-cyan-100"><UserRound className="h-4 w-4" /> {copy.form.returningGuest} · {guestMemory.name}</p><p className="mt-1 text-xs text-cyan-100/60">{guestMemory.reservationCount} {copy.form.priorReservations} · {copy.form.latest} {formatDay(guestMemory.latestDate, locale)}</p></div>
                        <button type="button" onClick={() => { set('guestCount', guestMemory.usualPartySize); if (guestMemory.seatingPreference) set('seatingPreference', guestMemory.seatingPreference); }} className="min-h-9 shrink-0 rounded-lg bg-cyan-200 px-2.5 text-xs font-black text-slate-950">{copy.form.useUsual}</button>
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="border-t border-white/[0.07] pt-5">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><UsersRound className="h-4 w-4 text-cyan-300" /> {copy.form.party}</h3>
                  <GuestCountInput value={form.guestCount} onChange={(value) => set('guestCount', value)} copy={copy.guestCountCopy} />
                </section>

                <label className="block border-t border-white/[0.07] pt-5"><span className={labelClass}>{copy.form.notes}</span><textarea maxLength={2000} rows={3} value={form.notes} onChange={(event) => set('notes', event.target.value)} placeholder={copy.form.notesPlaceholder} className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-white/[0.045] p-3 text-sm placeholder:text-slate-600 focus:border-cyan-300/40 focus:outline-none" /></label>

                <section className="border-t border-white/[0.07] pt-5">
                  <h3 className="text-sm font-bold">{copy.form.seating}</h3>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{SEATING.map((preference) => <Choice key={preference} active={form.seatingPreference === preference} onClick={() => set('seatingPreference', preference)}>{copy.seating[preference]}</Choice>)}</div>
                </section>

                <section className="border-t border-white/[0.07] pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4 text-cyan-300" /> {copy.form.occasion}</h3>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {QUICK_PURPOSES.map((purpose) => <Choice key={purpose} active={form.purpose === purpose} onClick={() => set('purpose', purpose)}>{copy.purpose[purpose]}</Choice>)}
                    <select value={form.purpose} onChange={(event) => set('purpose', event.target.value)} className="min-h-10 min-w-[105px] rounded-xl border border-white/10 bg-white/[0.055] px-2 text-sm">{PURPOSES.map((purpose) => <option key={purpose} value={purpose}>{copy.purpose[purpose]}</option>)}</select>
                  </div>
                  {form.purpose !== 'regular' ? <label className="mt-3 block"><span className={labelClass}>{copy.form.occasionDetails}</span><input maxLength={500} value={form.purposeDetails} onChange={(event) => set('purposeDetails', event.target.value)} placeholder={copy.form.occasionPlaceholder} className={inputClass} /></label> : null}
                </section>

                <section className="border-t border-white/[0.07] pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-bold"><CalendarDays className="h-4 w-4 text-cyan-300" /> {copy.form.when}</h3>
                  <div className="mt-3 space-y-3">
                    <ReservationDatePicker value={form.date} onChange={(value) => set('date', value)} timezone={timezone} locale={locale} copy={copy.dateCopy} />
                    <ReservationTimeInput value={form.time} onChange={(value) => set('time', value)} timezone={timezone} label={copy.form.when} hint={copy.timeHint} />
                  </div>
                  <label className="mt-3 block"><span className={labelClass}>{copy.form.duration}</span><select value={form.expectedDurationMinutes} onChange={(event) => set('expectedDurationMinutes', Number(event.target.value))} className={inputClass}>{[60, 90, 120, 150, 180, 240].map((minutes) => <option key={minutes} value={minutes}>{minutes} {copy.form.durationUnit}</option>)}</select></label>
                </section>

                <section className="grid grid-cols-2 gap-2 border-t border-white/[0.07] pt-5">
                  <label><span className={labelClass}>{copy.form.location}</span><select required value={form.locationId} onChange={(event) => set('locationId', event.target.value)} className={inputClass}><option value="">{copy.form.selectLocation}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                  <label><span className={labelClass}>{copy.form.source}</span><select value={form.source} onChange={(event) => set('source', event.target.value)} className={inputClass}>{SOURCES.map((source) => <option key={source} value={source}>{copy.source[source]}</option>)}</select></label>
                </section>

                <section className="border-t border-white/[0.07] pt-5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.waitlist}
                    onClick={() => set('waitlist', !form.waitlist)}
                    className={`flex w-full items-center justify-between rounded-2xl border p-3.5 text-start transition ${
                      form.waitlist ? 'border-violet-300/30 bg-violet-300/[0.08]' : 'border-white/[0.08] bg-white/[0.025]'
                    }`}
                  >
                    <span><strong className="block text-sm">{copy.form.waitlist}</strong><span className="mt-0.5 block text-xs text-slate-500">{copy.form.waitlistHelp}</span></span>
                    <span className={`relative h-6 w-11 rounded-full transition ${form.waitlist ? 'bg-violet-300' : 'bg-slate-700'}`}><span className={`absolute top-1 start-1 h-4 w-4 rounded-full bg-slate-950 transition ${form.waitlist ? 'translate-x-5 rtl:-translate-x-5' : ''}`} /></span>
                  </button>
                  {form.waitlist ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label><span className={labelClass}>{copy.form.waitlistEarliest}</span><input type="time" value={form.earliestTime} onChange={(event) => set('earliestTime', event.target.value)} className={inputClass} /></label>
                      <label><span className={labelClass}>{copy.form.waitlistLatest}</span><input type="time" value={form.latestTime} onChange={(event) => set('latestTime', event.target.value)} className={inputClass} /></label>
                    </div>
                  ) : null}
                </section>
              </div>
            </form>

            <footer className="shrink-0 border-t border-white/[0.08] bg-[#0a0e14]/95 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] backdrop-blur sm:rounded-b-[28px] sm:px-5">
              <div className="mb-3 flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-slate-400">{form.guestCount || '—'} {copy.guests} · {form.date ? formatDay(form.date, locale) : copy.dateCopy.chooseDate} · {form.time || '—'}</span>
                <span className="shrink-0 text-amber-200/70">{copy.form.availabilityUnknown}</span>
              </div>
              <button
                type="submit"
                form="reservation-quick-form"
                disabled={saving || !form.locationId || form.guestCount === '' || !form.date || !form.time}
                className={`flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl font-black text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  form.waitlist ? 'bg-violet-300 hover:bg-violet-200' : 'bg-cyan-300 hover:bg-cyan-200'
                }`}
              >
                {saving ? <><LoaderCircle className="h-5 w-5 animate-spin" /> {copy.form.saving}</> : form.waitlist ? copy.form.saveWaitlist : copy.form.save}
              </button>
              <p className="mt-2 text-center text-[10px] text-slate-600">{copy.form.submitHint}</p>
            </footer>
          </aside>
        </div>
      ) : null}

      {editingRow ? (
        <ReservationEditPanel
          row={editingRow as EditableReservation}
          timezone={timezone}
          onClose={() => setEditingRow(null)}
          onRebook={['cancelled', 'no_show'].includes(editingRow.status) ? () => {
            const row = editingRow;
            setEditingRow(null);
            void prepareRebook(row);
          } : undefined}
          rebooking={preparingRebookId === editingRow.id}
          onSaved={async () => {
            setMessage({ kind: 'success', text: copy.details.save });
            await Promise.all([loadReservations(), loadDailySummary()]);
          }}
        />
      ) : null}

      {rebookingRow ? (
        <ReservationRebookPanel
          row={rebookingRow}
          locations={locations}
          timezone={timezone}
          onClose={() => setRebookingRow(null)}
          onCreated={async ({ reservationId, date, locationId: replacementLocationId }) => {
            setRebookingRow(null);
            setLocationId(replacementLocationId);
            setSelectedDate(date);
            setFilter('all');
            setMessage({ kind: 'success', text: rebookCopy.success });
            const response = await fetch(`/api/reservations/${reservationId}`, { cache: 'no-store' });
            const payload = await response.json().catch(() => null);
            if (response.ok && payload?.data) setEditingRow(payload.data as ReservationRow);
            await Promise.all([loadReservations(), loadDailySummary()]);
          }}
        />
      ) : null}
    </main>
  );
}
