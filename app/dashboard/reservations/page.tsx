'use client';

import { useCallback, useEffect, useState } from 'react';

const purposes = ['regular','birthday','anniversary','business','engagement','bachelor','bachelorette','family','event','other'];
const sources = ['manual','phone','whatsapp','instagram','website','google','walk_in','other'];
const seating = ['no_preference','indoor','outdoor','bar','vip'];
const countryCodes = [
  ['Lebanon', '+961'], ['United Arab Emirates', '+971'], ['Saudi Arabia', '+966'],
  ['Qatar', '+974'], ['Kuwait', '+965'], ['Jordan', '+962'], ['France', '+33'],
  ['United Kingdom', '+44'], ['United States / Canada', '+1'],
];
type ReservationRow = {
  id: string; reservation_date: string; reservation_time: string; guest_count: number;
  purpose: string; seating_preference: string; status: string; source: string; notes: string | null;
  guest: { first_name: string; last_name: string; phone_e164: string } | null;
  creator: { full_name: string } | null;
};
type Location = { id: string; name: string };
const initial = {
  firstName: '', lastName: '', countryCallingCode: '+961', phoneNumber: '', guestCount: 2,
  purpose: 'regular', purposeDetails: '', date: new Date().toISOString().slice(0, 10), time: '19:00',
  expectedDurationMinutes: 120, notes: '', seatingPreference: 'no_preference', source: 'manual',
  locationId: '', waitlist: false, earliestTime: '', latestTime: '',
};

export default function ReservationsPage() {
  const [form, setForm] = useState(initial);
  const [locations, setLocations] = useState<Location[]>([]);
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [tab, setTab] = useState('Today');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{ sufficientHistoricalData: boolean; current: { reservationCount: number; expectedGuestCount: number; cancellationCount: number; noShowCount: number }; comparable: { reservationCount: number; expectedGuestCount: number; cancellationCount: number; noShowCount: number } } | null>(null);
  const set = (key: keyof typeof initial, value: string | number | boolean) => setForm((current) => ({ ...current, [key]: value }));

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' });
    if (tab === 'Today') params.set('date', new Date().toISOString().slice(0, 10));
    if (tab === 'Waiting List') params.set('status', 'waitlisted');
    if (['Seated','Completed','Cancelled'].includes(tab)) params.set('status', tab.toLowerCase());
    if (tab === 'No-shows') params.set('status', 'no_show');
    const response = await fetch(`/api/reservations?${params}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    setRows(response.ok && Array.isArray(payload?.data?.reservations) ? payload.data.reservations : []);
  }, [tab]);

  useEffect(() => {
    void fetch('/api/locations', { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json().catch(() => null);
      const list = response.ok && Array.isArray(payload?.data?.locations) ? payload.data.locations : [];
      setLocations(list); if (list[0]?.id) setForm((current) => ({ ...current, locationId: current.locationId || list[0].id }));
    });
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!form.locationId) return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ locationId: form.locationId, date: form.date });
      void fetch(`/api/reservations/history?${params}`, { cache: 'no-store' }).then((r) => r.json()).then((payload) => setComparison(payload?.data ?? null));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [form.locationId, form.date]);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setMessage(null);
    const body = { ...form, purposeDetails: form.purposeDetails || undefined, notes: form.notes || undefined, earliestTime: form.waitlist && form.earliestTime || undefined, latestTime: form.waitlist && form.latestTime || undefined };
    const response = await fetch('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    if (response.ok) { setMessage(form.waitlist ? 'Waiting-list entry created.' : 'Reservation created.'); setOpen(false); setForm((current) => ({ ...initial, locationId: current.locationId })); await load(); }
    else setMessage(payload?.error ?? 'Reservation could not be created.');
    setLoading(false);
  }

  return (
    <main className="space-y-5 px-4 pb-10 sm:px-6 lg:px-0">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-white/5 p-5 sm:p-7">
        <div><p className="text-sm uppercase tracking-[.24em] text-cyan-300">Reservation OS</p><h1 className="mt-2 text-3xl font-black">Reservations</h1><p className="mt-1 text-sm text-slate-300">Manual booking, guest history, calendar preparation, and waiting lists.</p></div>
        <div className="flex gap-2"><a href="/dashboard/reservations/calendar" className="min-h-11 rounded-xl border border-white/15 px-5 py-3 font-bold">Calendar</a><button className="min-h-11 rounded-xl bg-cyan-400 px-5 font-bold text-slate-950" onClick={() => setOpen(true)}>New Reservation</button></div>
      </header>
      <section className="grid gap-3 sm:grid-cols-4">
        {[
          ['Reservations', rows.length], ['Expected guests', rows.reduce((sum, row) => sum + row.guest_count, 0)],
          ['Confirmed', rows.filter((row) => row.status === 'confirmed').length], ['Next hour', '—'],
        ].map(([label, value]) => <article key={label} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></article>)}
      </section>
      <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
        <h2 className="font-bold">Comparable weekday last year</h2>
        {!comparison?.sufficientHistoricalData ? <p className="mt-2 text-sm text-slate-400">Insufficient historical data.</p> : (
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
            <p>Reservations <strong>{comparison.current.reservationCount - comparison.comparable.reservationCount >= 0 ? '+' : ''}{comparison.current.reservationCount - comparison.comparable.reservationCount}</strong></p>
            <p>Expected guests <strong>{comparison.current.expectedGuestCount - comparison.comparable.expectedGuestCount >= 0 ? '+' : ''}{comparison.current.expectedGuestCount - comparison.comparable.expectedGuestCount}</strong></p>
            <p>Cancellations <strong>{comparison.current.cancellationCount - comparison.comparable.cancellationCount}</strong></p>
            <p>No-shows <strong>{comparison.current.noShowCount - comparison.comparable.noShowCount}</strong></p>
          </div>
        )}
      </section>
      <nav className="flex gap-2 overflow-x-auto pb-1">{['Today','Upcoming','Waiting List','Seated','Completed','Cancelled','No-shows'].map((item) => <button key={item} onClick={() => setTab(item)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm ${tab === item ? 'bg-cyan-400 text-slate-950' : 'border border-white/10'}`}>{item}</button>)}</nav>
      {message ? <p role="status" className="rounded-xl border border-cyan-400/30 p-3 text-sm">{message}</p> : null}
      <section className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-white/5 text-slate-400"><tr>{['Guest','Phone','Guests','Date / time','Purpose','Seating','Status','Source','Notes','Created by'].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} className="border-t border-white/10"><td className="p-3 font-semibold">{row.guest ? `${row.guest.first_name} ${row.guest.last_name}` : 'Unknown'}</td><td className="p-3">{row.guest?.phone_e164}</td><td className="p-3">{row.guest_count}</td><td className="p-3">{row.reservation_date} · {String(row.reservation_time).slice(0,5)}</td><td className="p-3">{row.purpose}</td><td className="p-3">{row.seating_preference}</td><td className="p-3">{row.status}</td><td className="p-3">{row.source}</td><td className="p-3">{row.notes ? '●' : '—'}</td><td className="p-3">{row.creator?.full_name ?? 'System'}</td></tr>)}</tbody>
        </table>
        {!rows.length ? <p className="p-8 text-center text-slate-400">No reservations match this view.</p> : null}
      </section>
      {open ? <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/85 p-4 backdrop-blur"><form onSubmit={submit} className="mx-auto grid max-w-3xl gap-4 rounded-3xl border border-white/10 bg-slate-900 p-5 sm:grid-cols-2 sm:p-7">
        <div className="sm:col-span-2 flex items-center justify-between"><h2 className="text-2xl font-black">New Reservation</h2><button type="button" onClick={() => setOpen(false)}>Close</button></div>
        <label>First name<input required maxLength={80} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3"/></label>
        <label>Last name<input required maxLength={80} value={form.lastName} onChange={(e) => set('lastName', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3"/></label>
        <label>Country / calling code<select value={form.countryCallingCode} onChange={(e) => set('countryCallingCode', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3">{countryCodes.map(([name, code]) => <option key={code} value={code}>{name} ({code})</option>)}</select></label>
        <label>Phone number<input required inputMode="tel" value={form.phoneNumber} onChange={(e) => set('phoneNumber', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3"/></label>
        <label>Location<select required value={form.locationId} onChange={(e) => set('locationId', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3"><option value="">Select location</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Guests<input type="number" min={1} max={100} value={form.guestCount} onChange={(e) => set('guestCount', Number(e.target.value))} className="mt-1 w-full rounded-xl bg-slate-800 p-3"/></label>
        <label>Date<input type="date" required value={form.date} onChange={(e) => set('date', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3"/></label>
        <label>Time<input type="time" required value={form.time} onChange={(e) => set('time', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3"/></label>
        <label>Duration<select value={form.expectedDurationMinutes} onChange={(e) => set('expectedDurationMinutes', Number(e.target.value))} className="mt-1 w-full rounded-xl bg-slate-800 p-3">{[60,90,120,150,180].map((v) => <option key={v} value={v}>{v} minutes</option>)}</select></label>
        <label>Purpose<select value={form.purpose} onChange={(e) => set('purpose', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3">{purposes.map((v) => <option key={v}>{v}</option>)}</select></label>
        {(form.purpose !== 'regular') ? <label className="sm:col-span-2">Purpose details<input maxLength={500} value={form.purposeDetails} onChange={(e) => set('purposeDetails', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3"/></label> : null}
        <label>Seating<select value={form.seatingPreference} onChange={(e) => set('seatingPreference', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3">{seating.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>Source<select value={form.source} onChange={(e) => set('source', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3">{sources.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label className="sm:col-span-2">Notes<textarea maxLength={2000} value={form.notes} onChange={(e) => set('notes', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3"/></label>
        <label className="sm:col-span-2 flex items-center gap-3"><input type="checkbox" checked={form.waitlist} onChange={(e) => set('waitlist', e.target.checked)}/> Add to waiting list</label>
        {form.waitlist ? <><label>Earliest time<input type="time" value={form.earliestTime} onChange={(e) => set('earliestTime', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3"/></label><label>Latest time<input type="time" value={form.latestTime} onChange={(e) => set('latestTime', e.target.value)} className="mt-1 w-full rounded-xl bg-slate-800 p-3"/></label></> : null}
        <button disabled={loading} className="sm:col-span-2 min-h-12 rounded-xl bg-cyan-400 font-bold text-slate-950 disabled:opacity-50">{loading ? 'Saving…' : form.waitlist ? 'Add to Waiting List' : 'Create Reservation'}</button>
      </form></div> : null}
    </main>
  );
}
