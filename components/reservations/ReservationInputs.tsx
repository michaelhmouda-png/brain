'use client';

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { venueDate } from '@/lib/reservations/time';

const isoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateFromIso = (value: string) => new Date(`${value}T12:00:00`);

export function formatVenueDate(value: string, locale?: string, emptyLabel = 'Choose a date') {
  if (!value) return emptyLabel;
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(dateFromIso(value));
}

export function formatCompactVenueDate(value: string, locale?: string, emptyLabel = 'Choose a date') {
  if (!value) return emptyLabel;
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(dateFromIso(value));
}

function daysForMonth(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function ReservationDatePicker({
  value,
  onChange,
  timezone,
  allowClear = true,
  label = 'Reservation date',
  tone = 'dark',
  locale,
  copy,
  compactOnMobile = false,
}: {
  value: string;
  onChange(value: string): void;
  timezone?: string;
  allowClear?: boolean;
  label?: string;
  tone?: 'dark' | 'light';
  locale?: string;
  compactOnMobile?: boolean;
  copy?: {
    chooseDate: string;
    venueDate: string;
    previousMonth: string;
    nextMonth: string;
    weekdays: readonly string[];
    today: string;
    clear: string;
    cancel?: string;
    apply?: string;
    close: string;
  };
}) {
  const today = venueDate(timezone);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => dateFromIso(value || today));
  const [pendingValue, setPendingValue] = useState(value || today);
  const touchStart = useRef<number | null>(null);
  const days = useMemo(() => daysForMonth(month), [month]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const moveMonth = (offset: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1, 12));
  };
  const openPicker = () => {
    setMonth(dateFromIso(value || today));
    setPendingValue(value || today);
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className={`flex w-full items-center rounded-xl border transition focus:outline-none ${
          compactOnMobile ? 'min-h-11 gap-2 px-3 sm:min-h-12 sm:gap-3 sm:px-3.5' : 'min-h-12 gap-3 px-3.5'
        } ${
          tone === 'light'
            ? 'border-slate-300 bg-white text-start text-slate-950 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20'
            : 'border-white/10 bg-white/[0.055] text-start hover:border-white/20 focus:border-cyan-400/60'
        }`}
        aria-label={label}
      >
        <CalendarDays className={`h-4 w-4 shrink-0 ${tone === 'light' ? 'text-cyan-700' : 'text-cyan-300'}`} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-bold ${tone === 'light' ? 'text-slate-950' : 'text-white'}`}>
            {compactOnMobile ? (
              <>
                <span className="sm:hidden">{formatCompactVenueDate(value, locale, copy?.chooseDate)}</span>
                <span className="hidden sm:inline">{formatVenueDate(value, locale, copy?.chooseDate)}</span>
              </>
            ) : formatVenueDate(value, locale, copy?.chooseDate)}
          </span>
          <span className={`${compactOnMobile ? 'hidden sm:block' : 'block'} text-[11px] ${tone === 'light' ? 'text-slate-600' : 'text-slate-500'}`}>{timezone ? `${timezone} · ${copy?.venueDate ?? 'venue date'}` : copy?.venueDate ?? 'Venue-local date'}</span>
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={`w-full max-w-md rounded-t-[28px] border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[28px] sm:p-5 ${
              tone === 'light' ? 'border-slate-200 bg-[#fbfbf8] text-slate-950' : 'border-white/10 bg-[#0b1018]'
            }`}
            onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
            onTouchEnd={(event) => {
              const end = event.changedTouches[0]?.clientX;
              if (touchStart.current === null || end === undefined) return;
              const distance = end - touchStart.current;
              if (Math.abs(distance) > 55) moveMonth(distance < 0 ? 1 : -1);
              touchStart.current = null;
            }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15 sm:hidden" />
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => moveMonth(-1)} className={`grid min-h-11 min-w-11 place-items-center rounded-xl border ${tone === 'light' ? 'border-slate-300 hover:bg-slate-100' : 'border-white/10'}`} aria-label={copy?.previousMonth ?? 'Previous month'}>
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              </button>
              <strong className="text-base">
                {new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month)}
              </strong>
              <button type="button" onClick={() => moveMonth(1)} className={`grid min-h-11 min-w-11 place-items-center rounded-xl border ${tone === 'light' ? 'border-slate-300 hover:bg-slate-100' : 'border-white/10'}`} aria-label={copy?.nextMonth ?? 'Next month'}>
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-slate-500">
              {(copy?.weekdays ?? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((day) => <span key={day} className="py-1">{day}</span>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {days.map((day) => {
                const dayValue = isoDate(day);
                const selected = dayValue === pendingValue;
                const isToday = dayValue === today;
                const muted = day.getMonth() !== month.getMonth();
                return (
                  <button
                    type="button"
                    key={dayValue}
                    onClick={() => setPendingValue(dayValue)}
                    aria-pressed={selected}
                    className={`relative grid min-h-11 place-items-center rounded-xl text-sm font-bold transition ${
                      selected
                        ? 'bg-cyan-300 text-slate-950'
                        : muted
                          ? tone === 'light' ? 'text-slate-400 hover:bg-slate-100' : 'text-slate-700 hover:bg-white/[0.04]'
                          : tone === 'light' ? 'text-slate-800 hover:bg-slate-100' : 'text-slate-200 hover:bg-white/[0.08]'
                    }`}
                  >
                    {day.getDate()}
                    {isToday && !selected ? <span className="absolute bottom-1 h-1 w-1 rounded-full bg-cyan-300" /> : null}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingValue(today);
                  setMonth(dateFromIso(today));
                }}
                className={`min-h-11 rounded-xl border px-4 text-sm font-semibold ${tone === 'light' ? 'border-slate-300 text-slate-700' : 'border-white/10 text-slate-300'}`}
              >
                {copy?.today ?? 'Today'}
              </button>
              {allowClear ? (
                <button type="button" onClick={() => setPendingValue('')} className={`min-h-11 rounded-xl border px-4 text-sm font-semibold ${tone === 'light' ? 'border-slate-300 text-slate-700' : 'border-white/10 text-slate-300'}`}>
                  {copy?.clear ?? 'Clear'}
                </button>
              ) : null}
              <button type="button" onClick={() => setOpen(false)} className={`min-h-11 rounded-xl border px-4 text-sm font-semibold ${tone === 'light' ? 'border-slate-300 text-slate-700' : 'border-white/10 text-slate-300'}`}>
                {copy?.cancel ?? 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(pendingValue);
                  setOpen(false);
                }}
                className="min-h-11 flex-1 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950"
              >
                {copy?.apply ?? 'Apply'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function ReservationTimeInput({
  value,
  onChange,
  timezone,
  intervalMinutes = 15,
  label = 'Reservation time',
  tone = 'dark',
  hint,
}: {
  value: string;
  onChange(value: string): void;
  timezone?: string;
  intervalMinutes?: number;
  label?: string;
  tone?: 'dark' | 'light';
  hint?: string;
}) {
  const suggestions = useMemo(() => {
    const safeInterval = Math.max(5, Math.min(60, Math.round(intervalMinutes)));
    return Array.from({ length: Math.ceil(24 * 60 / safeInterval) }, (_, index) => {
      const minutes = index * safeInterval;
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    });
  }, [intervalMinutes]);
  const listId = `reservation-times-${intervalMinutes}`;

  return (
    <label>
      <span className={`text-xs font-semibold uppercase tracking-[0.12em] ${tone === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>{label}</span>
      <input
        type="time"
        inputMode="numeric"
        step={60}
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1.5 min-h-12 w-full rounded-xl border px-3.5 text-lg font-bold focus:outline-none ${
          tone === 'light'
            ? 'border-slate-300 bg-white text-slate-950 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20'
            : 'border-white/10 bg-white/[0.055] text-white focus:border-cyan-400/60'
        }`}
      />
      <datalist id={listId}>
        {suggestions.map((time) => <option value={time} key={time} />)}
      </datalist>
      <span className={`mt-1 block text-[11px] ${tone === 'light' ? 'text-slate-600' : 'text-slate-500'}`}>
        {hint ?? `${timezone ? `${timezone} · ` : 'Venue-local time · '}${intervalMinutes}-minute suggestions, any minute accepted`}
      </span>
    </label>
  );
}

export function GuestCountInput({
  value,
  onChange,
  minimum = 1,
  maximum = 100,
  tone = 'dark',
  copy,
  compactOnMobile = false,
}: {
  value: number | '';
  onChange(value: number | ''): void;
  minimum?: number;
  maximum?: number;
  tone?: 'dark' | 'light';
  compactOnMobile?: boolean;
  copy?: {
    label: string;
    remove: string;
    add: string;
    clear: string;
    hint: string;
  };
}) {
  const numeric = typeof value === 'number' ? value : minimum;
  return (
    <div>
      <span className={`text-xs font-semibold uppercase tracking-[0.12em] ${tone === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>{copy?.label ?? 'Number of guests'}</span>
      <div className="mt-1.5 flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(minimum, numeric - 1))}
          className={`grid place-items-center rounded-xl border ${compactOnMobile ? 'min-h-11 min-w-11 sm:min-h-14 sm:min-w-14' : 'min-h-14 min-w-14'} ${tone === 'light' ? 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100' : 'border-white/10 bg-white/[0.04]'}`}
          aria-label={copy?.remove ?? 'Remove one guest'}
        >
          <Minus className="h-5 w-5" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={minimum}
          max={maximum}
          required
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
          className={`${compactOnMobile ? 'min-h-11 sm:min-h-14' : 'min-h-14'} min-w-0 flex-1 rounded-xl border px-3 text-center text-2xl font-black focus:outline-none ${
            tone === 'light'
              ? 'border-slate-300 bg-white text-slate-950 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20'
              : 'border-white/10 bg-white/[0.055] text-white focus:border-cyan-400/60'
          }`}
          aria-label={copy?.label ?? 'Guest count'}
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(maximum, numeric + 1))}
          className={`grid place-items-center rounded-xl border ${compactOnMobile ? 'min-h-11 min-w-11 sm:min-h-14 sm:min-w-14' : 'min-h-14 min-w-14'} ${tone === 'light' ? 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100' : 'border-white/10 bg-white/[0.04]'}`}
          aria-label={copy?.add ?? 'Add one guest'}
        >
          <Plus className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => onChange('')} className={`${compactOnMobile ? 'min-h-11 sm:min-h-14' : 'min-h-14'} rounded-xl border px-3 text-xs font-semibold ${tone === 'light' ? 'border-slate-300 text-slate-700 hover:bg-slate-100' : 'border-white/10 text-slate-400'}`}>
          {copy?.clear ?? 'Clear'}
        </button>
      </div>
      <span className={`mt-1 block text-[11px] ${tone === 'light' ? 'text-slate-600' : 'text-slate-500'}`}>{copy?.hint ?? `Enter any whole number from ${minimum} to ${maximum}.`}</span>
    </div>
  );
}
