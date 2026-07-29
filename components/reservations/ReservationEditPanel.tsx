'use client';

import { CalendarDays, LoaderCircle, Save, UserRound, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/components/LocaleProvider';
import { GuestCountInput, ReservationDatePicker, ReservationTimeInput } from './ReservationInputs';

const PURPOSES = ['regular', 'birthday', 'anniversary', 'business', 'engagement', 'bachelor', 'bachelorette', 'family', 'event', 'other'] as const;
const SEATING = ['no_preference', 'indoor', 'outdoor', 'bar', 'vip'] as const;
const COUNTRY_CODES = ['+961', '+971', '+966', '+974', '+965', '+962', '+33', '+44', '+1'] as const;
const TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'waitlisted', 'cancelled'],
  confirmed: ['seated', 'cancelled', 'no_show'],
  waitlisted: ['confirmed', 'cancelled'],
  seated: ['completed'],
};
const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.055] px-3.5 text-[15px] text-white transition focus:border-cyan-400/60 focus:outline-none';
const labelClass = 'text-xs font-semibold uppercase tracking-[0.12em] text-slate-400';

export type EditableReservation = {
  id: string;
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
  history?: {
    id: string;
    previous_status: string | null;
    new_status: string;
    reason: string | null;
    changed_at: string;
  }[];
};

function splitPhone(phone: string) {
  const callingCode = [...COUNTRY_CODES]
    .sort((left, right) => right.length - left.length)
    .find((code) => phone.startsWith(code)) ?? '+961';
  return { countryCallingCode: callingCode, phoneNumber: phone.slice(callingCode.length) };
}

function durationMinutes(row: EditableReservation) {
  if (!row.expected_end_at) return 120;
  const duration = Math.round((Date.parse(row.expected_end_at) - Date.parse(row.starts_at)) / 60_000);
  return Number.isFinite(duration) && duration >= 15 && duration <= 720 ? duration : 120;
}

function initialForm(row: EditableReservation) {
  const phone = splitPhone(row.guest?.phone_e164 ?? '');
  return {
    firstName: row.guest?.first_name ?? '',
    lastName: row.guest?.last_name ?? '',
    countryCallingCode: phone.countryCallingCode,
    phoneNumber: phone.phoneNumber,
    guestCount: row.guest_count as number | '',
    date: row.reservation_date,
    time: String(row.reservation_time).slice(0, 5),
    expectedDurationMinutes: durationMinutes(row),
    purpose: row.purpose,
    purposeDetails: row.purpose_details ?? '',
    seatingPreference: row.seating_preference,
    notes: row.notes ?? '',
    status: row.status,
  };
}

export function ReservationEditPanel({
  row,
  timezone,
  onClose,
  onSaved,
  onRebook,
  rebooking = false,
}: {
  row: EditableReservation;
  timezone?: string;
  onClose(): void;
  onSaved(): Promise<void>;
  onRebook?(): void;
  rebooking?: boolean;
}) {
  const { language, messages } = useLocale();
  const copy = messages.reservationDesk;
  const detailCopy = copy.details;
  const rebookCopy = messages.reservationRebook;
  const locale = language === 'ar' ? 'ar-LB' : 'en';
  const baseline = useMemo(() => initialForm(row), [row]);
  const [form, setForm] = useState(baseline);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const allowedStatuses = [row.status, ...(TRANSITIONS[row.status] ?? [])];
  const set = (key: keyof typeof form, value: string | number) =>
    setForm((current) => ({ ...current, [key]: value }));

  const closeSafely = () => {
    if (dirty && !window.confirm(detailCopy.discard)) return;
    onClose();
  };

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || saving) return;
      event.preventDefault();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) closeSafely();
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('keydown', keydown);
    };
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    if (form.status === 'cancelled' && form.status !== row.status && !window.confirm(detailCopy.confirmCancel)) {
      submittingRef.current = false;
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        ...form,
        guestCount: Number(form.guestCount),
        purposeDetails: form.purposeDetails || undefined,
        notes: form.notes || undefined,
      };
      const response = await fetch(`/api/reservations/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? detailCopy.updateFailed);
      await onSaved();
      onClose();
    } catch {
      setError(detailCopy.updateFailed);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/75 backdrop-blur-sm sm:items-stretch sm:justify-end" role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={detailCopy.eyebrow}
        className="flex max-h-[92dvh] w-full flex-col rounded-t-[28px] border border-white/10 bg-[#0a0e14] shadow-2xl sm:max-h-none sm:w-[min(560px,calc(100vw-2rem))] sm:rounded-none sm:border-y-0 sm:border-e-0"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.08] px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">{detailCopy.eyebrow}</p>
            <h2 className="mt-1 truncate text-xl font-black">
              {row.guest ? `${row.guest.first_name} ${row.guest.last_name}` : copy.guest}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{row.reservation_date} · {String(row.reservation_time).slice(0, 5)} · {row.guest_count} {copy.guests}</p>
          </div>
          <button type="button" onClick={closeSafely} disabled={saving} className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/10" aria-label={detailCopy.close}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <form id="reservation-edit-form" onSubmit={save} className="mobile-scroll-region min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 p-4 sm:p-5">
            {error ? <p role="alert" className="rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{error}</p> : null}

            <section>
              <h3 className="flex items-center gap-2 text-sm font-bold"><UserRound className="h-4 w-4 text-cyan-300" /> {detailCopy.guest}</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label><span className={labelClass}>{copy.form.firstName}</span><input required maxLength={80} value={form.firstName} onChange={(event) => set('firstName', event.target.value)} className={inputClass} /></label>
                <label><span className={labelClass}>{copy.form.lastName}</span><input required maxLength={80} value={form.lastName} onChange={(event) => set('lastName', event.target.value)} className={inputClass} /></label>
              </div>
              <div className="mt-3 grid grid-cols-[110px_minmax(0,1fr)] gap-2">
                <label><span className={labelClass}>{copy.form.countryCode}</span><input required list="reservation-edit-codes" value={form.countryCallingCode} onChange={(event) => set('countryCallingCode', event.target.value)} className={inputClass} /></label>
                <label><span className={labelClass}>{copy.form.phone}</span><input required inputMode="tel" value={form.phoneNumber} onChange={(event) => set('phoneNumber', event.target.value)} className={inputClass} /></label>
                <datalist id="reservation-edit-codes">{COUNTRY_CODES.map((code) => <option value={code} key={code} />)}</datalist>
              </div>
            </section>

            <section className="border-t border-white/[0.07] pt-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><UsersRound className="h-4 w-4 text-cyan-300" /> {detailCopy.party}</h3>
              <GuestCountInput value={form.guestCount} onChange={(value) => setForm((current) => ({ ...current, guestCount: value }))} copy={copy.guestCountCopy} />
            </section>

            <section className="space-y-3 border-t border-white/[0.07] pt-5">
              <h3 className="flex items-center gap-2 text-sm font-bold"><CalendarDays className="h-4 w-4 text-cyan-300" /> {detailCopy.dateTime}</h3>
              <ReservationDatePicker value={form.date} onChange={(value) => set('date', value)} timezone={timezone} locale={locale} copy={copy.dateCopy} />
              <ReservationTimeInput value={form.time} onChange={(value) => set('time', value)} timezone={timezone} label={detailCopy.dateTime} hint={copy.timeHint} />
              <label><span className={labelClass}>{detailCopy.duration}</span><input type="number" inputMode="numeric" min={15} max={720} step={15} required value={form.expectedDurationMinutes} onChange={(event) => set('expectedDurationMinutes', Number(event.target.value))} className={inputClass} /></label>
            </section>

            <section className="border-t border-white/[0.07] pt-5">
              <div className="grid grid-cols-2 gap-2">
                <label><span className={labelClass}>{detailCopy.occasion}</span><select value={form.purpose} onChange={(event) => set('purpose', event.target.value)} className={inputClass}>{PURPOSES.map((purpose) => <option value={purpose} key={purpose}>{copy.purpose[purpose]}</option>)}</select></label>
                <label><span className={labelClass}>{detailCopy.seating}</span><select value={form.seatingPreference} onChange={(event) => set('seatingPreference', event.target.value)} className={inputClass}>{SEATING.map((preference) => <option value={preference} key={preference}>{copy.seating[preference]}</option>)}</select></label>
              </div>
              {form.purpose !== 'regular' ? <label className="mt-3 block"><span className={labelClass}>{copy.form.occasionDetails}</span><input maxLength={500} value={form.purposeDetails} onChange={(event) => set('purposeDetails', event.target.value)} className={inputClass} /></label> : null}
              <label className="mt-3 block"><span className={labelClass}>{detailCopy.notes}</span><textarea rows={3} maxLength={2000} value={form.notes} onChange={(event) => set('notes', event.target.value)} className={`${inputClass} resize-none py-3`} /></label>
            </section>

            <section className="border-t border-white/[0.07] pt-5">
              <label><span className={labelClass}>{detailCopy.status}</span><select value={form.status} onChange={(event) => set('status', event.target.value)} className={inputClass}>{allowedStatuses.map((status) => <option value={status} key={status}>{copy.status[status as keyof typeof copy.status] ?? status}</option>)}</select></label>
              <p className="mt-2 text-xs text-slate-500">{detailCopy.statusHelp}</p>
              {onRebook && ['cancelled', 'no_show'].includes(row.status) ? (
                <button
                  type="button"
                  onClick={onRebook}
                  disabled={saving || rebooking}
                  className="mt-3 min-h-11 rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-4 text-sm font-bold text-cyan-100 transition hover:bg-cyan-300/20 focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:opacity-50"
                >
                  {rebooking ? rebookCopy.preparing : rebookCopy.action}
                </button>
              ) : null}
            </section>

            <section className="border-t border-white/[0.07] pt-5">
              <h3 className="text-sm font-bold">{detailCopy.history}</h3>
              {row.history?.length ? <ol className="mt-3 space-y-2">{row.history.map((item) => <li key={item.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-xs text-slate-400"><strong className="text-slate-200">{copy.status[item.new_status as keyof typeof copy.status] ?? item.new_status}</strong><span className="ms-2"><bdi>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.changed_at))}</bdi></span>{item.reason ? <p className="mt-1 break-words">{item.reason}</p> : null}</li>)}</ol> : <p className="mt-2 text-xs text-slate-500">{detailCopy.noHistory}</p>}
            </section>
          </div>
        </form>

        <footer className="shrink-0 border-t border-white/[0.08] bg-[#0a0e14]/95 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-5">
          <div className="flex gap-2">
            <button type="button" onClick={closeSafely} disabled={saving} className="min-h-12 flex-1 rounded-xl border border-white/10 font-bold text-slate-300">{detailCopy.cancel}</button>
            <button type="submit" form="reservation-edit-form" disabled={saving || !dirty || form.guestCount === '' || !form.date || !form.time} className="flex min-h-12 flex-[1.4] items-center justify-center gap-2 rounded-xl bg-cyan-300 font-black text-slate-950 disabled:opacity-50">
              {saving ? <><LoaderCircle className="h-4 w-4 animate-spin" /> {detailCopy.saving}</> : <><Save className="h-4 w-4" /> {detailCopy.save}</>}
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] text-slate-600">{dirty ? detailCopy.protected : detailCopy.unchanged}</p>
        </footer>
      </aside>
    </div>
  );
}
