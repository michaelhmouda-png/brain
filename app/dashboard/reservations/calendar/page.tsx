'use client';

import { useEffect, useMemo, useState } from 'react';

type CalendarReservation = { id: string; reservation_date: string; reservation_time: string; guest_count: number; purpose: string; status: string; source: string; seating_preference: string; hasNotes: boolean; guest: { name: string; phone: string } | null };
type Waitlist = { id: string; requested_date: string; preferred_time: string; guest_count: number; purpose: string; status: string };
type Location = { id: string; name: string };
const iso = (date: Date) => date.toISOString().slice(0, 10);

export default function ReservationCalendarPage() {
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [date, setDate] = useState(iso(new Date()));
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [reservations, setReservations] = useState<CalendarReservation[]>([]);
  const [waitlist, setWaitlist] = useState<Waitlist[]>([]);
  const [timezone, setTimezone] = useState('');
  const range = useMemo(() => {
    const selected = new Date(`${date}T12:00:00Z`); const from = new Date(selected); const to = new Date(selected);
    if (view === 'week') { from.setUTCDate(selected.getUTCDate() - selected.getUTCDay()); to.setUTCDate(from.getUTCDate() + 6); }
    if (view === 'month') { from.setUTCDate(1); to.setUTCMonth(from.getUTCMonth() + 1, 0); }
    return { from: iso(from), to: iso(to) };
  }, [date, view]);
  useEffect(() => { void fetch('/api/locations', { cache: 'no-store' }).then(async (response) => {
    const payload = await response.json().catch(() => null);
    const rows = response.ok && Array.isArray(payload?.data?.locations) ? payload.data.locations : [];
    setLocations(rows); if (rows[0]?.id) setLocationId(rows[0].id);
  }); }, []);
  useEffect(() => {
    if (!locationId) return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ locationId, from: range.from, to: range.to, view });
      void fetch(`/api/reservations/calendar?${params}`, { cache: 'no-store' }).then((r) => r.json()).then((payload) => {
        setReservations(payload?.data?.reservations ?? []); setWaitlist(payload?.data?.waitlist ?? []); setTimezone(payload?.data?.timezone ?? '');
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [locationId, range, view]);
  const days = [...new Set([...reservations.map((row) => row.reservation_date), ...waitlist.map((row) => row.requested_date)])].sort();
  return <main className="space-y-5 px-4 pb-10 sm:px-6 lg:px-0">
    <header className="rounded-[28px] border border-white/10 bg-white/5 p-5 sm:p-7"><p className="text-sm uppercase tracking-[.24em] text-cyan-300">Reservation OS</p><h1 className="mt-2 text-3xl font-black">Calendar</h1><p className="mt-1 text-sm text-slate-300">Venue-local operational dates {timezone ? `· ${timezone}` : ''}</p></header>
    <section className="flex flex-wrap gap-3 rounded-2xl border border-white/10 p-4">
      <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="rounded-xl bg-slate-800 p-3">{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl bg-slate-800 p-3"/>
      {(['day','week','month'] as const).map((item) => <button key={item} onClick={() => setView(item)} className={`rounded-xl px-4 py-2 capitalize ${view === item ? 'bg-cyan-400 text-slate-950' : 'border border-white/10'}`}>{item}</button>)}
    </section>
    {!days.length ? <p className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">No reservations or waiting-list entries in this period.</p> : null}
    <section className={`grid gap-4 ${view === 'month' ? 'sm:grid-cols-2 xl:grid-cols-4' : ''}`}>{days.map((day) => {
      const rows = reservations.filter((row) => row.reservation_date === day); const waiting = waitlist.filter((row) => row.requested_date === day);
      return <article key={day} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"><h2 className="font-black">{day}</h2><p className="mt-1 text-xs text-slate-400">{rows.length} reservations · {rows.reduce((sum, row) => sum + row.guest_count, 0)} expected guests · {waiting.length} waiting</p>
        {view !== 'month' ? <div className="mt-3 space-y-2">{rows.map((row) => <div key={row.id} className="rounded-xl bg-white/5 p-3 text-sm"><strong>{String(row.reservation_time).slice(0,5)} · {row.guest?.name ?? 'Guest'}</strong><p>{row.guest_count} guests · {row.purpose} · {row.status} · {row.source}</p><p className="text-slate-400">{row.guest?.phone} · {row.seating_preference}{row.hasNotes ? ' · Notes available' : ''}</p></div>)}</div> : null}
      </article>;
    })}</section>
  </main>;
}
