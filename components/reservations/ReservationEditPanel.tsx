'use client';

import { CalendarDays, LoaderCircle, Save, UserRound, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
const inputClass = 'ui-field mt-1.5 min-h-11 w-full rounded-xl px-3.5 text-[15px] transition';
const labelClass = 'text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ui-text-secondary)]';
const title = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

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
}: {
  row: EditableReservation;
  timezone?: string;
  onClose(): void;
  onSaved(): Promise<void>;
}) {
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
    if (dirty && !window.confirm('Discard your unsaved reservation changes?')) return;
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
      if (!response.ok) throw new Error(payload?.error ?? 'Reservation update failed.');
      await onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? title(failure.message) : 'Reservation update failed.');
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="ui-overlay fixed inset-0 z-[60] flex items-end backdrop-blur-sm sm:items-stretch sm:justify-end" role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Edit reservation"
        className="ui-management-surface flex max-h-[92dvh] w-full flex-col rounded-t-[28px] border sm:max-h-none sm:w-[min(560px,calc(100vw-2rem))] sm:rounded-none sm:border-y-0 sm:border-e-0"
      >
        <header className="ui-management-divider flex shrink-0 items-start justify-between gap-3 border-b px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Reservation summary</p>
            <h2 className="mt-1 truncate text-xl font-black text-[var(--ui-text-primary)]">
              {row.guest ? `${row.guest.first_name} ${row.guest.last_name}` : 'Guest'}
            </h2>
            <p className="ui-muted mt-1 text-xs">{row.reservation_date} · {String(row.reservation_time).slice(0, 5)} · {row.guest_count} guests</p>
          </div>
          <button type="button" onClick={closeSafely} disabled={saving} className="ui-button-secondary min-h-11 min-w-11 p-0" aria-label="Close reservation editor">
            <X className="h-4 w-4" />
          </button>
        </header>

        <form id="reservation-edit-form" onSubmit={save} className="mobile-scroll-region flex-1 overflow-y-auto">
          <div className="space-y-5 p-4 sm:p-5">
            {error ? <p role="alert" className="ui-alert ui-alert-error text-sm">{error}</p> : null}

            <section>
              <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--ui-text-primary)]"><UserRound className="h-4 w-4 text-[var(--ui-action-primary)]" /> Guest</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label><span className={labelClass}>First name</span><input required maxLength={80} value={form.firstName} onChange={(event) => set('firstName', event.target.value)} className={inputClass} /></label>
                <label><span className={labelClass}>Last name</span><input required maxLength={80} value={form.lastName} onChange={(event) => set('lastName', event.target.value)} className={inputClass} /></label>
              </div>
              <div className="mt-3 grid grid-cols-[110px_minmax(0,1fr)] gap-2">
                <label><span className={labelClass}>Code</span><input required list="reservation-edit-codes" value={form.countryCallingCode} onChange={(event) => set('countryCallingCode', event.target.value)} className={inputClass} /></label>
                <label><span className={labelClass}>Phone</span><input required inputMode="tel" value={form.phoneNumber} onChange={(event) => set('phoneNumber', event.target.value)} className={inputClass} /></label>
                <datalist id="reservation-edit-codes">{COUNTRY_CODES.map((code) => <option value={code} key={code} />)}</datalist>
              </div>
            </section>

            <section className="ui-management-divider border-t pt-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--ui-text-primary)]"><UsersRound className="h-4 w-4 text-[var(--ui-action-primary)]" /> Party</h3>
              <GuestCountInput value={form.guestCount} onChange={(value) => setForm((current) => ({ ...current, guestCount: value }))} />
            </section>

            <section className="ui-management-divider space-y-3 border-t pt-5">
              <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--ui-text-primary)]"><CalendarDays className="h-4 w-4 text-[var(--ui-action-primary)]" /> Date and time</h3>
              <ReservationDatePicker value={form.date} onChange={(value) => set('date', value)} timezone={timezone} />
              <ReservationTimeInput value={form.time} onChange={(value) => set('time', value)} timezone={timezone} />
              <label><span className={labelClass}>Expected duration</span><input type="number" inputMode="numeric" min={15} max={720} step={15} required value={form.expectedDurationMinutes} onChange={(event) => set('expectedDurationMinutes', Number(event.target.value))} className={inputClass} /></label>
            </section>

            <section className="ui-management-divider border-t pt-5">
              <div className="grid grid-cols-2 gap-2">
                <label><span className={labelClass}>Occasion</span><select value={form.purpose} onChange={(event) => set('purpose', event.target.value)} className={inputClass}>{PURPOSES.map((purpose) => <option value={purpose} key={purpose}>{title(purpose)}</option>)}</select></label>
                <label><span className={labelClass}>Seating</span><select value={form.seatingPreference} onChange={(event) => set('seatingPreference', event.target.value)} className={inputClass}>{SEATING.map((preference) => <option value={preference} key={preference}>{title(preference)}</option>)}</select></label>
              </div>
              {form.purpose !== 'regular' ? <label className="mt-3 block"><span className={labelClass}>Occasion details</span><input maxLength={500} value={form.purposeDetails} onChange={(event) => set('purposeDetails', event.target.value)} className={inputClass} /></label> : null}
              <label className="mt-3 block"><span className={labelClass}>Notes</span><textarea rows={3} maxLength={2000} value={form.notes} onChange={(event) => set('notes', event.target.value)} className={`${inputClass} resize-none py-3`} /></label>
            </section>

            <section className="ui-management-divider border-t pt-5">
              <label><span className={labelClass}>Status</span><select value={form.status} onChange={(event) => set('status', event.target.value)} className={inputClass}>{allowedStatuses.map((status) => <option value={status} key={status}>{title(status)}</option>)}</select></label>
              <p className="ui-muted mt-2 text-xs">Only valid next statuses are offered. Source remains {title(row.source)} and cannot be changed.</p>
            </section>
          </div>
        </form>

        <footer className="ui-management-divider shrink-0 border-t bg-[var(--ui-surface-elevated)] p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-5">
          <div className="flex gap-2">
            <button type="button" onClick={closeSafely} disabled={saving} className="ui-button-secondary min-h-12 flex-1">Cancel</button>
            <button type="submit" form="reservation-edit-form" disabled={saving || !dirty || form.guestCount === '' || !form.date || !form.time} className="ui-button-primary min-h-12 flex-[1.4]">
              {saving ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Saving once…</> : <><Save className="h-4 w-4" /> Save changes</>}
            </button>
          </div>
          <p className="ui-muted mt-2 text-center text-[10px]">{dirty ? 'Unsaved changes are protected.' : 'No changes yet.'}</p>
        </footer>
      </aside>
    </div>
  );
}
