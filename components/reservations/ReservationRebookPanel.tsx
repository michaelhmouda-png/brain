'use client';

import { CalendarClock, History, LoaderCircle, RefreshCw, UserRound, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/components/LocaleProvider';
import {
  GuestCountInput,
  ReservationDatePicker,
  ReservationTimeInput,
} from '@/components/reservations/ReservationInputs';

const PURPOSES = ['regular', 'birthday', 'anniversary', 'business', 'engagement', 'bachelor', 'bachelorette', 'family', 'event', 'other'] as const;
const SOURCES = ['manual', 'phone', 'whatsapp', 'instagram', 'website', 'google', 'walk_in', 'ai_concierge', 'other'] as const;
const SEATING = ['no_preference', 'indoor', 'outdoor', 'bar', 'vip'] as const;
const COUNTRY_CODES = ['+961', '+971', '+966', '+974', '+965', '+962', '+33', '+44', '+1'] as const;

export type RebookableReservation = {
  id: string;
  location_id: string;
  reservation_date: string;
  reservation_time: string;
  starts_at: string;
  expected_end_at: string | null;
  guest_count: number;
  purpose: string;
  purpose_details: string | null;
  seating_preference: string;
  status: 'cancelled' | 'no_show';
  source: string;
  notes: string | null;
  cancellation_reason: string | null;
  guest: {
    first_name: string;
    last_name: string;
    phone_e164: string;
    notes?: string | null;
  } | null;
};

type Location = { id: string; name: string };

const labelClass = 'text-xs font-bold uppercase tracking-[0.12em] text-slate-600';
const inputClass = 'mt-1.5 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[15px] text-slate-950 transition focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/20';

function durationMinutes(row: RebookableReservation) {
  if (!row.expected_end_at) return 120;
  const duration = Math.round((Date.parse(row.expected_end_at) - Date.parse(row.starts_at)) / 60_000);
  return Number.isFinite(duration) && duration >= 15 && duration <= 720 ? duration : 120;
}

function splitPhone(phone: string) {
  const countryCallingCode = [...COUNTRY_CODES]
    .sort((left, right) => right.length - left.length)
    .find((code) => phone.startsWith(code)) ?? '';
  return {
    countryCallingCode,
    phoneNumber: countryCallingCode ? phone.slice(countryCallingCode.length) : phone,
  };
}

function initialForm(row: RebookableReservation) {
  return {
    locationId: row.location_id,
    guestCount: row.guest_count as number | '',
    date: '',
    time: '',
    expectedDurationMinutes: durationMinutes(row),
    purpose: row.purpose,
    purposeDetails: row.purpose_details ?? '',
    seatingPreference: row.seating_preference,
    notes: row.notes ?? '',
    source: row.source,
  };
}

export function ReservationRebookPanel({
  row,
  locations,
  timezone,
  onClose,
  onCreated,
}: {
  row: RebookableReservation;
  locations: Location[];
  timezone?: string;
  onClose(): void;
  onCreated(result: { reservationId: string; date: string; locationId: string; replayed: boolean }): Promise<void>;
}) {
  const { language, messages } = useLocale();
  const t = messages.reservationRebook;
  const baseline = useMemo(() => initialForm(row), [row]);
  const phone = useMemo(() => splitPhone(row.guest?.phone_e164 ?? ''), [row.guest?.phone_e164]);
  const [form, setForm] = useState(baseline);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => globalThis.crypto.randomUUID());
  const submittingRef = useRef(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const selectedLocation = locations.find((location) => location.id === form.locationId);
  const set = (key: keyof typeof form, value: string | number) =>
    setForm((current) => ({ ...current, [key]: value }));

  const closeSafely = () => {
    if (dirty && !saving && !window.confirm(t.discard)) return;
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (form.guestCount === '' || form.guestCount < 1 || form.guestCount > 100 || !form.date || !form.time) {
      setError(t.required);
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/reservations/${row.id}/rebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          locationId: form.locationId,
          guestCount: Number(form.guestCount),
          date: form.date,
          time: form.time,
          expectedDurationMinutes: Number(form.expectedDurationMinutes),
          purpose: form.purpose,
          purposeDetails: form.purposeDetails || undefined,
          seatingPreference: form.seatingPreference,
          notes: form.notes || undefined,
          source: form.source,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.data?.reservation_id !== 'string') {
        const code = typeof payload?.error === 'string' ? payload.error : '';
        throw new Error(
          ['RESERVATION_ALREADY_REBOOKED', 'RESERVATION_REBOOK_IDEMPOTENCY_CONFLICT'].includes(code)
            ? t.conflict
            : code === 'RESERVATION_REBOOK_INPUT_INVALID' || code === 'RESERVATION_REBOOK_SOURCE_INVALID'
              ? t.required
              : t.failed,
        );
      }
      await onCreated({
        reservationId: payload.data.reservation_id,
        date: form.date,
        locationId: form.locationId,
        replayed: Boolean(payload.data.replayed),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t.failed);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  const originalWhen = new Intl.DateTimeFormat(language === 'ar' ? 'ar-LB' : 'en', {
    dateStyle: 'medium',
  }).format(new Date(`${row.reservation_date}T12:00:00`));

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-slate-950/55 backdrop-blur-sm sm:items-stretch sm:justify-end rtl:sm:justify-start" role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="reservation-rebook-title"
        className="flex max-h-[94dvh] w-full flex-col rounded-t-[28px] border border-slate-200 bg-[#fbfbf8] text-slate-950 shadow-[0_28px_90px_rgba(15,23,42,0.24)] sm:max-h-none sm:w-[min(600px,calc(100vw-2rem))] sm:rounded-none sm:border-y-0 sm:border-r-0 rtl:sm:border-l-0 rtl:sm:border-r"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-700">
              {row.status === 'cancelled' ? t.cancelledContext : t.noShowContext}
            </p>
            <h2 id="reservation-rebook-title" className="mt-1 text-xl font-black tracking-tight text-slate-950">{t.title}</h2>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-600">{t.description}</p>
          </div>
          <button
            type="button"
            onClick={closeSafely}
            disabled={saving}
            className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            aria-label={t.close}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form id="reservation-rebook-form" onSubmit={submit} className="mobile-scroll-region flex-1 overflow-y-auto">
          <div className="space-y-5 p-4 pb-8 sm:p-6 sm:pb-8">
            {error ? (
              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-900">{error}</p>
            ) : null}

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <History className="h-4 w-4 text-cyan-700" /> {t.originalBooking}
              </h3>
              <p className="mt-2 font-semibold text-slate-800">{originalWhen} · <bdi>{String(row.reservation_time).slice(0, 5)}</bdi></p>
              <p className="mt-1 text-sm text-slate-600">
                {t.cancellationReason}: {row.cancellation_reason || t.noCancellationReason}
              </p>
            </section>

            <section>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <UserRound className="h-4 w-4 text-cyan-700" /> {t.guest}
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-3">
                  <span className={labelClass}>{t.firstName}</span>
                  <bdi className="mt-1 block font-semibold text-slate-900">{row.guest?.first_name ?? '—'}</bdi>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-3">
                  <span className={labelClass}>{t.lastName}</span>
                  <bdi className="mt-1 block font-semibold text-slate-900">{row.guest?.last_name ?? '—'}</bdi>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-[100px_minmax(0,1fr)] gap-2" dir="ltr">
                <div className="rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-3">
                  <span className={labelClass}>{t.countryCode}</span>
                  <span className="mt-1 block font-semibold text-slate-800">{phone.countryCallingCode || '—'}</span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-3">
                  <span className={labelClass}>{t.phone}</span>
                  <span className="mt-1 block font-semibold text-slate-800">{phone.phoneNumber || '—'}</span>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-600">{t.identityReadOnly}</p>
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <p className={labelClass}>{t.guestNotes}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700" dir="auto">{row.guest?.notes || t.noGuestNotes}</p>
              </div>
            </section>

            <section className="border-t border-slate-200 pt-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
                <UsersRound className="h-4 w-4 text-cyan-700" /> {t.party}
              </h3>
              <GuestCountInput
                value={form.guestCount}
                onChange={(value) => setForm((current) => ({ ...current, guestCount: value }))}
                tone="light"
                copy={t.guestCountCopy}
              />
            </section>

            <section className="space-y-3 border-t border-slate-200 pt-5">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <CalendarClock className="h-4 w-4 text-cyan-700" /> {t.booking}
              </h3>
              <div>
                <span className={labelClass}>{t.location}</span>
                <p className="mt-1.5 min-h-12 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-3 font-semibold text-slate-900" dir="auto">
                  {selectedLocation?.name ?? '—'}
                </p>
              </div>
              <div>
                <span className={labelClass}>{t.newDate}</span>
                <div className="mt-1.5">
                  <ReservationDatePicker
                    value={form.date}
                    onChange={(value) => set('date', value)}
                    timezone={timezone}
                    label={t.newDate}
                    tone="light"
                    locale={language === 'ar' ? 'ar-LB' : 'en'}
                    copy={t.dateCopy}
                  />
                </div>
              </div>
              <ReservationTimeInput
                value={form.time}
                onChange={(value) => set('time', value)}
                timezone={timezone}
                label={t.newTime}
                tone="light"
                hint={`${timezone ? `${timezone} · ` : ''}${t.timeHint}`}
              />
              <label>
                <span className={labelClass}>{t.duration}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={15}
                  max={720}
                  step={15}
                  required
                  value={form.expectedDurationMinutes}
                  onChange={(event) => set('expectedDurationMinutes', Number(event.target.value))}
                  className={inputClass}
                />
              </label>
            </section>

            <section className="space-y-3 border-t border-slate-200 pt-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label>
                  <span className={labelClass}>{t.purpose}</span>
                  <select value={form.purpose} onChange={(event) => set('purpose', event.target.value)} className={inputClass}>
                    {PURPOSES.map((purpose) => <option value={purpose} key={purpose}>{t.purposeLabels[purpose]}</option>)}
                  </select>
                </label>
                <label>
                  <span className={labelClass}>{t.seating}</span>
                  <select value={form.seatingPreference} onChange={(event) => set('seatingPreference', event.target.value)} className={inputClass}>
                    {SEATING.map((preference) => <option value={preference} key={preference}>{t.seatingLabels[preference]}</option>)}
                  </select>
                </label>
              </div>
              {form.purpose !== 'regular' ? (
                <label className="block">
                  <span className={labelClass}>{t.purposeDetails}</span>
                  <input maxLength={500} value={form.purposeDetails} onChange={(event) => set('purposeDetails', event.target.value)} className={inputClass} />
                </label>
              ) : null}
              <label className="block">
                <span className={labelClass}>{t.notes}</span>
                <textarea rows={3} maxLength={2000} value={form.notes} onChange={(event) => set('notes', event.target.value)} className={`${inputClass} resize-none py-3`} />
              </label>
              <label className="block">
                <span className={labelClass}>{t.source}</span>
                <select value={form.source} onChange={(event) => set('source', event.target.value)} className={inputClass}>
                  {SOURCES.map((source) => <option value={source} key={source}>{t.sourceLabels[source]}</option>)}
                </select>
              </label>
            </section>

            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <p className="font-bold">{t.availabilityUnknown}</p>
              <p className="mt-1 text-sm">{t.availabilityHelp}</p>
            </section>
          </div>
        </form>

        <footer className="shrink-0 border-t border-slate-200 bg-[#fbfbf8]/95 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6">
          <div className="flex gap-2">
            <button type="button" onClick={closeSafely} disabled={saving} className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white font-bold text-slate-800 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500">
              {t.cancel}
            </button>
            <button
              type="submit"
              form="reservation-rebook-form"
              disabled={saving || form.guestCount === '' || !form.date || !form.time}
              className="flex min-h-12 flex-[1.5] items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 font-black text-white transition hover:bg-cyan-800 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
            >
              {saving
                ? <><LoaderCircle className="h-4 w-4 animate-spin" /> {t.confirming}</>
                : <><RefreshCw className="h-4 w-4" /> {t.confirm}</>}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
