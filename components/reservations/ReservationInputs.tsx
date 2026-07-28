'use client';

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  X,
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

export function formatVenueDate(value: string) {
  if (!value) return 'Choose a date';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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
}: {
  value: string;
  onChange(value: string): void;
  timezone?: string;
  allowClear?: boolean;
  label?: string;
}) {
  const today = venueDate(timezone);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => dateFromIso(value || today));
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
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="ui-field flex min-h-12 w-full items-center gap-3 rounded-xl px-3.5 text-left transition"
        aria-label={label}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-[var(--ui-action-primary)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-slate-950">{formatVenueDate(value)}</span>
          <span className="block text-[11px] text-slate-600">{timezone ? `${timezone} venue date` : 'Venue-local date'}</span>
        </span>
      </button>

      {open ? (
        <div className="ui-overlay fixed inset-0 z-[70] flex items-end justify-center p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="ui-management-surface w-full max-w-md rounded-t-[28px] border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-[28px] sm:p-5"
            onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
            onTouchEnd={(event) => {
              const end = event.changedTouches[0]?.clientX;
              if (touchStart.current === null || end === undefined) return;
              const distance = end - touchStart.current;
              if (Math.abs(distance) > 55) moveMonth(distance < 0 ? 1 : -1);
              touchStart.current = null;
            }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--brain-line)] sm:hidden" />
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => moveMonth(-1)} className="ui-button-secondary min-h-11 min-w-11 p-0" aria-label="Previous month">
                <ChevronLeft className="brain-directional-icon h-4 w-4" />
              </button>
              <strong className="text-base">
                {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month)}
              </strong>
              <button type="button" onClick={() => moveMonth(1)} className="ui-button-secondary min-h-11 min-w-11 p-0" aria-label="Next month">
                <ChevronRight className="brain-directional-icon h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-slate-500">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day} className="py-1">{day}</span>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {days.map((day) => {
                const dayValue = isoDate(day);
                const selected = dayValue === value;
                const isToday = dayValue === today;
                const muted = day.getMonth() !== month.getMonth();
                return (
                  <button
                    type="button"
                    key={dayValue}
                    onClick={() => { onChange(dayValue); setOpen(false); }}
                    aria-pressed={selected}
                    className={`relative grid min-h-11 place-items-center rounded-xl text-sm font-bold transition ${
                      selected
                        ? 'bg-cyan-300 text-slate-950'
                        : muted
                          ? 'text-slate-500 hover:bg-[var(--ui-action-secondary-hover)]'
                          : 'text-slate-800 hover:bg-[var(--ui-action-secondary-hover)]'
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
                onClick={() => { onChange(today); setOpen(false); }}
                className="ui-button-primary min-h-11 flex-1"
              >
                Today
              </button>
              {allowClear ? (
                <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="ui-button-secondary min-h-11">
                  Clear
                </button>
              ) : null}
              <button type="button" onClick={() => setOpen(false)} className="ui-button-secondary min-h-11 min-w-11 p-0" aria-label="Close date picker">
                <X className="h-4 w-4" />
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
}: {
  value: string;
  onChange(value: string): void;
  timezone?: string;
  intervalMinutes?: number;
  label?: string;
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
      <span className="ui-secondary text-xs font-semibold uppercase tracking-[0.12em]">{label}</span>
      <input
        type="time"
        inputMode="numeric"
        step={60}
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="ui-field mt-1.5 min-h-12 w-full rounded-xl px-3.5 text-lg font-bold"
      />
      <datalist id={listId}>
        {suggestions.map((time) => <option value={time} key={time} />)}
      </datalist>
      <span className="ui-muted mt-1 block text-[11px]">
        {timezone ? `${timezone} · ` : 'Venue-local time · '}{intervalMinutes}-minute suggestions, any minute accepted
      </span>
    </label>
  );
}

export function GuestCountInput({
  value,
  onChange,
  minimum = 1,
  maximum = 100,
}: {
  value: number | '';
  onChange(value: number | ''): void;
  minimum?: number;
  maximum?: number;
}) {
  const numeric = typeof value === 'number' ? value : minimum;
  return (
    <div>
      <span className="ui-secondary text-xs font-semibold uppercase tracking-[0.12em]">Number of guests</span>
      <div className="mt-1.5 flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(minimum, numeric - 1))}
          className="ui-button-secondary min-h-14 min-w-14 p-0"
          aria-label="Remove one guest"
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
          className="ui-field min-h-14 min-w-0 flex-1 rounded-xl px-3 text-center text-2xl font-black"
          aria-label="Guest count"
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(maximum, numeric + 1))}
          className="ui-button-secondary min-h-14 min-w-14 p-0"
          aria-label="Add one guest"
        >
          <Plus className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => onChange('')} className="ui-button-secondary min-h-14 px-3 text-xs">
          Clear
        </button>
      </div>
      <span className="ui-muted mt-1 block text-[11px]">Enter any whole number from {minimum} to {maximum}.</span>
    </div>
  );
}
