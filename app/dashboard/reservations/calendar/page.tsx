'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type View = 'day' | 'week' | 'month';
type CalendarReservation = {
  id: string;
  reservation_date: string;
  reservation_time: string;
  guest_count: number;
  purpose: string;
  status: string;
  source: string;
  seating_preference: string;
  hasNotes: boolean;
  guest: { name: string; phone: string } | null;
};
type Waitlist = {
  id: string;
  requested_date: string;
  preferred_time: string;
  guest_count: number;
  purpose: string;
  status: string;
  seating_preference: string;
};
type Location = { id: string; name: string };

const localDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const dateFromIso = (value: string) => new Date(`${value}T12:00:00`);
const title = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const shortTime = (value: string) => String(value).slice(0, 5);
const formatDay = (value: string, long = false) => new Intl.DateTimeFormat(undefined, {
  weekday: long ? 'long' : 'short',
  month: long ? 'long' : 'short',
  day: 'numeric',
  ...(long ? { year: 'numeric' } : {}),
}).format(dateFromIso(value));
const statusTone: Record<string, string> = {
  pending: 'bg-amber-300/10 text-amber-200',
  confirmed: 'bg-emerald-300/10 text-emerald-200',
  waitlisted: 'bg-violet-300/10 text-violet-200',
  seated: 'bg-cyan-300/10 text-cyan-200',
  completed: 'bg-slate-300/5 text-slate-300',
  cancelled: 'bg-rose-300/10 text-rose-200',
  no_show: 'bg-orange-300/10 text-orange-200',
};

function rangeFor(date: string, view: View) {
  const selected = dateFromIso(date);
  const from = new Date(selected);
  const to = new Date(selected);
  if (view === 'week') {
    const mondayOffset = (selected.getDay() + 6) % 7;
    from.setDate(selected.getDate() - mondayOffset);
    to.setTime(from.getTime());
    to.setDate(from.getDate() + 6);
  }
  if (view === 'month') {
    from.setDate(1);
    to.setMonth(from.getMonth() + 1, 0);
  }
  return { from: localDate(from), to: localDate(to) };
}

function daysBetween(from: string, to: string) {
  const rows: string[] = [];
  const cursor = dateFromIso(from);
  const end = dateFromIso(to);
  while (cursor <= end) {
    rows.push(localDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

export default function ReservationCalendarPage() {
  const [view, setView] = useState<View>('day');
  const [date, setDate] = useState(localDate());
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [reservations, setReservations] = useState<CalendarReservation[]>([]);
  const [waitlist, setWaitlist] = useState<Waitlist[]>([]);
  const [timezone, setTimezone] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => rangeFor(date, view), [date, view]);

  useEffect(() => {
    let active = true;
    void fetch('/api/locations', { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json().catch(() => null);
      const rows = response.ok && Array.isArray(payload?.data?.locations) ? payload.data.locations as Location[] : [];
      if (!active) return;
      setLocations(rows);
      if (rows[0]?.id) setLocationId(rows[0].id);
    });
    return () => { active = false; };
  }, []);

  const load = useCallback(async () => {
    if (!locationId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ locationId, from: range.from, to: range.to, view });
      const response = await fetch(`/api/reservations/calendar?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.data) throw new Error('Calendar unavailable');
      setReservations(Array.isArray(payload.data.reservations) ? payload.data.reservations : []);
      setWaitlist(Array.isArray(payload.data.waitlist) ? payload.data.waitlist : []);
      setTimezone(typeof payload.data.timezone === 'string' ? payload.data.timezone : '');
    } catch {
      setReservations([]);
      setWaitlist([]);
      setError('The calendar could not be loaded. Try again.');
    } finally {
      setLoading(false);
    }
  }, [locationId, range, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const totals = useMemo(() => ({
    reservations: reservations.length,
    guests: reservations.reduce((sum, row) => sum + row.guest_count, 0),
    confirmed: reservations.filter((row) => row.status === 'confirmed').length,
    waiting: waitlist.length,
  }), [reservations, waitlist]);

  const days = useMemo(() => {
    const all = daysBetween(range.from, range.to);
    if (view !== 'month') return all;
    const occupied = new Set([
      ...reservations.map((row) => row.reservation_date),
      ...waitlist.map((row) => row.requested_date),
    ]);
    return all.filter((day) => occupied.has(day));
  }, [range, reservations, view, waitlist]);

  function move(direction: -1 | 1) {
    const next = dateFromIso(date);
    if (view === 'month') next.setMonth(next.getMonth() + direction);
    else next.setDate(next.getDate() + direction * (view === 'week' ? 7 : 1));
    setDate(localDate(next));
  }

  const periodLabel = view === 'day'
    ? formatDay(date, true)
    : `${formatDay(range.from)} – ${formatDay(range.to, view === 'month')}`;

  return (
    <main className="min-h-[calc(100dvh-6rem)] px-3 pb-20 sm:px-5 lg:px-0">
      <div className="overflow-hidden rounded-[28px] border border-white/[0.09] bg-[#080c12]/95 shadow-[0_32px_100px_rgba(0,0,0,0.42)]">
        <header className="border-b border-white/[0.07] px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <Link href="/dashboard/reservations" className="inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white">
                <ArrowLeft className="h-3.5 w-3.5" /> Reservation desk
              </Link>
              <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Service calendar</h1>
              <p className="mt-1 text-sm text-slate-400">Venue-local schedule {timezone ? `· ${timezone}` : ''}</p>
            </div>
            <Link href="/dashboard/reservations?new=1" className="flex min-h-11 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 shadow-[0_10px_30px_rgba(34,211,238,0.16)]">
              <Plus className="h-4 w-4" /> New booking
            </Link>
          </div>
        </header>

        <section className="border-b border-white/[0.07] px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 sm:max-w-60">
              <span className="sr-only">Calendar location</span>
              <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300" />
              <select value={locationId} onChange={(event) => setLocationId(event.target.value)} className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.055] pl-9 pr-3 text-sm font-semibold">
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
            <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.025] p-1">
              {(['day', 'week', 'month'] as View[]).map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() => setView(item)}
                  className={`min-h-9 rounded-lg px-3 text-xs font-bold capitalize transition ${view === item ? 'bg-white text-slate-950' : 'text-slate-400 hover:text-white'}`}
                >
                  {item}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void load()} className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/[0.08] text-slate-400 hover:bg-white/[0.05]" aria-label="Refresh calendar">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <button type="button" onClick={() => move(-1)} className="grid min-h-10 min-w-10 place-items-center rounded-xl border border-white/[0.08] text-slate-400 hover:bg-white/[0.05]" aria-label={`Previous ${view}`}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setDate(localDate())} className="min-w-0 text-center">
              <strong className="block truncate text-base sm:text-lg">{periodLabel}</strong>
              <span className="text-[11px] uppercase tracking-wider text-cyan-300">Tap for today</span>
            </button>
            <button type="button" onClick={() => move(1)} className="grid min-h-10 min-w-10 place-items-center rounded-xl border border-white/[0.08] text-slate-400 hover:bg-white/[0.05]" aria-label={`Next ${view}`}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-px border-b border-white/[0.07] bg-white/[0.07] sm:grid-cols-4">
          {[
            ['Reservations', totals.reservations],
            ['Expected guests', totals.guests],
            ['Confirmed', totals.confirmed],
            ['Waiting', totals.waiting],
          ].map(([label, value]) => (
            <div key={String(label)} className="bg-[#080c12] px-4 py-3 text-center">
              <strong className="text-xl font-black">{value}</strong>
              <p className="mt-0.5 text-[11px] text-slate-500">{label}</p>
            </div>
          ))}
        </section>

        {error ? <p role="status" className="m-4 rounded-xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100 sm:m-6">{error}</p> : null}

        {loading ? (
          <div className="grid min-h-[430px] place-items-center text-slate-500">
            <div className="text-center"><LoaderCircle className="mx-auto h-6 w-6 animate-spin" /><p className="mt-3 text-sm">Loading schedule…</p></div>
          </div>
        ) : days.length ? (
          <section className={`grid gap-px bg-white/[0.07] ${view === 'month' ? 'sm:grid-cols-2 xl:grid-cols-3' : ''}`}>
            {days.map((day) => {
              const booked = reservations.filter((row) => row.reservation_date === day);
              const waiting = waitlist.filter((row) => row.requested_date === day);
              const expected = booked.reduce((sum, row) => sum + row.guest_count, 0);
              return (
                <article key={day} className="min-w-0 bg-[#080c12] p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-black">{formatDay(day, view === 'day')}</h2>
                      <p className="mt-0.5 text-xs text-slate-500">{booked.length} bookings · {expected} guests · {waiting.length} waiting</p>
                    </div>
                    {day === localDate() ? <span className="rounded-full bg-cyan-300/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-200">Today</span> : null}
                  </div>

                  {view !== 'month' ? (
                    <div className="mt-4 space-y-2">
                      {booked.map((row) => (
                        <div key={row.id} className="rounded-2xl border border-white/[0.075] bg-white/[0.03] p-3.5">
                          <div className="flex items-start gap-3">
                            <div className="w-12 shrink-0">
                              <strong className="text-base">{shortTime(row.reservation_time)}</strong>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <strong className="truncate">{row.guest?.name ?? 'Guest'}</strong>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusTone[row.status] ?? statusTone.completed}`}>{title(row.status)}</span>
                              </div>
                              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                                <span className="inline-flex items-center gap-1"><UsersRound className="h-3 w-3" />{row.guest_count}</span>
                                <span>{title(row.purpose)}</span>
                                <span>{title(row.seating_preference)}</span>
                                {row.hasNotes ? <span className="text-amber-200">Has notes</span> : null}
                              </p>
                              <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><Phone className="h-3 w-3" />{row.guest?.phone ?? 'No phone'}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                      {waiting.map((row) => (
                        <div key={row.id} className="rounded-2xl border border-dashed border-violet-300/20 bg-violet-300/[0.045] p-3.5">
                          <div className="flex items-center justify-between gap-3">
                            <strong className="text-sm text-violet-100">{shortTime(row.preferred_time)} · Waiting list</strong>
                            <span className="text-xs text-violet-200">{row.guest_count} guests</span>
                          </div>
                          <p className="mt-1 text-xs text-violet-100/55">{title(row.purpose)} · {title(row.seating_preference)}</p>
                        </div>
                      ))}
                      {!booked.length && !waiting.length ? (
                        <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-7 text-center text-sm text-slate-600">No bookings</div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-4 flex items-center gap-3 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{booked.length}</span>
                      <span className="inline-flex items-center gap-1"><UsersRound className="h-3.5 w-3.5" />{expected}</span>
                      <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{waiting.length} waiting</span>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        ) : (
          <div className="grid min-h-[430px] place-items-center px-6 text-center">
            <div>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-white/15 text-slate-500"><CalendarDays className="h-5 w-5" /></div>
              <h2 className="mt-4 font-bold">The schedule is clear</h2>
              <p className="mt-1 text-sm text-slate-500">No reservations or waiting-list entries in this period.</p>
              <Link href="/dashboard/reservations?new=1" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950"><Plus className="h-4 w-4" /> New booking</Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
