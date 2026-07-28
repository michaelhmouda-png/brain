'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { interpolateMessage } from '@/lib/i18n';
import { isRecord, logRouteDiagnostic, stringField } from '@/lib/client-api';

const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Day = (typeof days)[number];
type ShiftTemplate = { name: string; startTime: string; endTime: string };
type Schedule = {
  id: string;
  employeeId: string;
  weekStartDate: string;
  employee: { firstName: string; lastName: string } | null;
  days: Record<Day, ShiftTemplate | null>;
};
type SchedulePayload = {
  scope: 'personal' | 'management';
  timezone: string;
  schedules: Schedule[];
  stats: { employeesScheduled: number; swapsPending: number; timeOffRequests: number } | null;
};

function dateAtTimezone(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function shiftDate(date: string, offset: number): string {
  const instant = new Date(`${date}T12:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + offset);
  return instant.toISOString().slice(0, 10);
}

function mondayFor(date: string): string {
  const instant = new Date(`${date}T12:00:00.000Z`);
  const day = instant.getUTCDay();
  return shiftDate(date, -(day === 0 ? 6 : day - 1));
}

function templateFrom(value: unknown): ShiftTemplate | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error('INVALID_SCHEDULE_RESPONSE');
  const name = stringField(value, 'name');
  const startTime = stringField(value, 'startTime');
  const endTime = stringField(value, 'endTime');
  if (!name || !/^\d{2}:\d{2}/.test(startTime) || !/^\d{2}:\d{2}/.test(endTime)) {
    throw new Error('INVALID_SCHEDULE_RESPONSE');
  }
  return { name, startTime: startTime.slice(0, 5), endTime: endTime.slice(0, 5) };
}

function scheduleFrom(value: unknown): Schedule {
  if (!isRecord(value) || !isRecord(value.days)) throw new Error('INVALID_SCHEDULE_RESPONSE');
  const dayValues = value.days;
  const projectedDays = Object.fromEntries(days.map((day) => [day, templateFrom(dayValues[day])])) as Record<Day, ShiftTemplate | null>;
  const employeeRecord = value.employee === null || value.employee === undefined ? null : value.employee;
  if (employeeRecord !== null && !isRecord(employeeRecord)) throw new Error('INVALID_SCHEDULE_RESPONSE');
  return {
    id: stringField(value, 'id'),
    employeeId: stringField(value, 'employee_id'),
    weekStartDate: stringField(value, 'week_start_date'),
    employee: employeeRecord ? {
      firstName: stringField(employeeRecord, 'first_name'),
      lastName: stringField(employeeRecord, 'last_name'),
    } : null,
    days: projectedDays,
  };
}

function payloadFrom(value: unknown): SchedulePayload {
  if (!isRecord(value) || (value.scope !== 'personal' && value.scope !== 'management') || !Array.isArray(value.schedules)) {
    throw new Error('INVALID_SCHEDULE_RESPONSE');
  }
  const timezone = stringField(value, 'timezone');
  try {
    if (!timezone) throw new Error('INVALID_SCHEDULE_RESPONSE');
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  } catch {
    throw new Error('INVALID_SCHEDULE_RESPONSE');
  }
  const stats = isRecord(value.stats) ? {
    employeesScheduled: Number(value.stats.employeesScheduled) || 0,
    swapsPending: Number(value.stats.swapsPending) || 0,
    timeOffRequests: Number(value.stats.timeOffRequests) || 0,
  } : null;
  return {
    scope: value.scope,
    timezone,
    schedules: value.schedules.map(scheduleFrom),
    stats,
  };
}

export default function ShiftsPage() {
  const { language, role, companyTimezone, messages: t } = useLocale();
  const [payload, setPayload] = useState<SchedulePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => mondayFor(dateAtTimezone(new Date(), companyTimezone)));

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/shifts?type=schedules&weekStart=${encodeURIComponent(weekStart)}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'FORBIDDEN' : 'FAILED');
      setPayload(payloadFrom(await response.json()));
    } catch (reason) {
      if (signal?.aborted) return;
      logRouteDiagnostic('Shifts', reason);
      setPayload(null);
      setError(reason instanceof Error && reason.message === 'FORBIDDEN' ? t.schedule.unauthorized : t.schedule.failed);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [t, weekStart]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const locale = language === 'ar' ? 'ar-LB' : 'en';
  const formattedWeek = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: payload?.timezone || companyTimezone,
  }).format(new Date(`${weekStart}T12:00:00.000Z`)), [companyTimezone, locale, payload?.timezone, weekStart]);
  const personal = role === 'employee';
  const PreviousIcon = language === 'ar' ? ChevronRight : ChevronLeft;
  const NextIcon = language === 'ar' ? ChevronLeft : ChevronRight;

  return (
    <section className="space-y-6 rounded-[28px] border border-white/10 bg-white/5 p-4 sm:p-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-950">{personal ? t.schedule.personalTitle : t.schedule.managementTitle}</h1>
        <p className="mt-2 text-slate-600">{personal ? t.schedule.personalDescription : t.schedule.managementDescription}</p>
      </header>

      <div className="grid grid-cols-2 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[auto_1fr_auto]">
        <button type="button" onClick={() => setWeekStart((current) => shiftDate(current, -7))} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 font-medium">
          <PreviousIcon className="h-4 w-4" aria-hidden="true" /> {t.schedule.previousWeek}
        </button>
        <div className="order-first col-span-2 text-center font-semibold sm:order-none sm:col-span-1">
          {interpolateMessage(t.schedule.weekOf, { date: formattedWeek })}
        </div>
        <button type="button" onClick={() => setWeekStart((current) => shiftDate(current, 7))} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 font-medium">
          {t.schedule.nextWeek} <NextIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {loading ? <p role="status" className="rounded-2xl bg-white p-6 text-slate-600">{t.schedule.loading}</p> : null}
      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-4 min-h-11 rounded-xl bg-red-700 px-4 font-semibold text-white">{t.schedule.retry}</button>
        </div>
      ) : null}

      {!loading && !error && payload?.schedules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
          {personal ? t.schedule.noSchedules : t.schedule.noManagementSchedules}
        </div>
      ) : null}

      {!loading && !error && personal && payload ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {days.map((day, index) => {
            const shift = payload.schedules[0]?.days[day] ?? null;
            const date = shiftDate(weekStart, index);
            return (
              <article key={day} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="font-semibold text-slate-950">{t.schedule.days[day]}</p>
                <p className="mt-1 text-xs text-slate-500">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: payload.timezone }).format(new Date(`${date}T12:00:00.000Z`))}</p>
                {shift ? (
                  <div className="mt-4">
                    <p className="font-medium text-slate-800" dir="auto">{shift.name}</p>
                    <p className="mt-1 text-sm text-slate-600"><bdi dir="ltr">{shift.startTime}–{shift.endTime}</bdi></p>
                  </div>
                ) : <p className="mt-4 text-sm text-slate-500">{t.schedule.noShift}</p>}
              </article>
            );
          })}
        </div>
      ) : null}

      {!loading && !error && !personal && payload?.schedules.length ? (
        <div className="mobile-scroll-region overflow-x-auto rounded-2xl border border-slate-200 bg-white" role="region" aria-label={t.schedule.tableLabel} tabIndex={0}>
          <table className="w-full min-w-[900px]">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-start text-sm font-semibold">{t.schedule.employee}</th>
                {days.map((day) => <th key={day} className="px-5 py-3 text-start text-sm font-semibold">{t.schedule.days[day]}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {payload.schedules.map((schedule) => (
                <tr key={schedule.id}>
                  <td className="px-5 py-4 font-medium" dir="auto">{schedule.employee ? `${schedule.employee.firstName} ${schedule.employee.lastName}`.trim() : t.schedule.employee}</td>
                  {days.map((day) => {
                    const shift = schedule.days[day];
                    return <td key={day} className="px-5 py-4 text-sm">{shift ? <><span dir="auto">{shift.name}</span><br /><bdi dir="ltr">{shift.startTime}–{shift.endTime}</bdi></> : '—'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!personal && payload?.stats ? (
        <div className="grid gap-3 md:grid-cols-3">
          {[
            [t.schedule.employeesScheduled, payload.stats.employeesScheduled],
            [t.schedule.swapsPending, payload.stats.swapsPending],
            [t.schedule.timeOffRequests, payload.stats.timeOffRequests],
          ].map(([label, value]) => <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-2xl font-bold">{new Intl.NumberFormat(locale).format(Number(value))}</p><p className="mt-1 text-sm text-slate-600">{label}</p></article>)}
        </div>
      ) : null}
    </section>
  );
}
