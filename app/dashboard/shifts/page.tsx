'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { interpolateMessage } from '@/lib/i18n';
import { isRecord, logRouteDiagnostic, stringField } from '@/lib/client-api';

const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Day = (typeof days)[number];
type ShiftTemplate = { name: string; startTime: string; endTime: string };
type ConcreteShift = {
  id: string;
  employeeId: string;
  locationId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  status: 'scheduled';
};
type EmployeeOption = { id: string; firstName: string; lastName: string; locationId: string | null; departmentId: string | null; departmentName: string | null };
type LocationOption = { id: string; name: string; timezone: string };
type Schedule = {
  id: string;
  employeeId: string;
  weekStartDate: string;
  employee: { firstName: string; lastName: string } | null;
  days: Record<Day, ShiftTemplate | null>;
};
type WeeklySeries={id:string;employeeId:string;locationId:string;status:'active'|'paused'|'ended';currentVersion:number;weekdays:number[];startTime:string;endTime:string;effectiveFrom:string;effectiveUntil:string|null};
type SchedulePayload = {
  scope: 'personal' | 'management';
  timezone: string;
  schedules: Schedule[];
  concreteShifts: ConcreteShift[];
  employees: EmployeeOption[];
  locations: LocationOption[];
  stats: { employeesScheduled: number; swapsPending: number; timeOffRequests: number } | null;
  weeklySeries: WeeklySeries[];
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

function concreteShiftFrom(value: unknown): ConcreteShift {
  if (!isRecord(value)) throw new Error('INVALID_SCHEDULE_RESPONSE');
  const status = stringField(value, 'status');
  const date = stringField(value, 'date');
  const startTime = stringField(value, 'startTime');
  const endTime = stringField(value, 'endTime');
  const locationId = value.locationId === null ? null : stringField(value, 'locationId');
  if (status !== 'scheduled' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new Error('INVALID_SCHEDULE_RESPONSE');
  }
  return {
    id: stringField(value, 'id'),
    employeeId: stringField(value, 'employeeId'),
    locationId,
    date,
    startTime,
    endTime,
    status,
  };
}

function employeeFrom(value: unknown): EmployeeOption {
  if (!isRecord(value)) throw new Error('INVALID_SCHEDULE_RESPONSE');
  return {
    id: stringField(value, 'id'),
    firstName: stringField(value, 'firstName'),
    lastName: stringField(value, 'lastName'),
    locationId: value.locationId === null ? null : stringField(value, 'locationId'),
    departmentId: value.departmentId === null ? null : stringField(value, 'departmentId'),
    departmentName: value.departmentName === null ? null : stringField(value, 'departmentName'),
  };
}

function locationFrom(value: unknown): LocationOption {
  if (!isRecord(value)) throw new Error('INVALID_SCHEDULE_RESPONSE');
  const timezone = stringField(value, 'timezone');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  } catch {
    throw new Error('INVALID_SCHEDULE_RESPONSE');
  }
  return { id: stringField(value, 'id'), name: stringField(value, 'name'), timezone };
}

function payloadFrom(value: unknown): SchedulePayload {
  if (!isRecord(value) || (value.scope !== 'personal' && value.scope !== 'management')
      || !Array.isArray(value.schedules) || !Array.isArray(value.concreteShifts)) {
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
    concreteShifts: value.concreteShifts.map(concreteShiftFrom),
    employees: value.scope === 'management' && Array.isArray(value.employees) ? value.employees.map(employeeFrom) : [],
    locations: value.scope === 'management' && Array.isArray(value.locations) ? value.locations.map(locationFrom) : [],
    stats,
    weeklySeries: value.scope==='management'&&Array.isArray(value.weeklySeries)?value.weeklySeries.map(item=>{if(!isRecord(item)||!Array.isArray(item.weekly_shift_schedule_versions))throw new Error('INVALID_SCHEDULE_RESPONSE');const versions=item.weekly_shift_schedule_versions.filter(isRecord);const current=versions.find(version=>Number(version.version)===Number(item.current_version));if(!current||!Array.isArray(current.weekdays))throw new Error('INVALID_SCHEDULE_RESPONSE');const status=stringField(item,'status');if(!['active','paused','ended'].includes(status))throw new Error('INVALID_SCHEDULE_RESPONSE');return{id:stringField(item,'id'),employeeId:stringField(item,'employee_id'),locationId:stringField(item,'location_id'),status:status as WeeklySeries['status'],currentVersion:Number(item.current_version),weekdays:current.weekdays.map(Number),startTime:stringField(current,'start_time').slice(0,5),endTime:stringField(current,'end_time').slice(0,5),effectiveFrom:stringField(current,'effective_from'),effectiveUntil:current.effective_until===null?null:stringField(current,'effective_until')};}):[],
  };
}

export default function ShiftsPage() {
  const { language, role, companyTimezone, messages: t } = useLocale();
  const [payload, setPayload] = useState<SchedulePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingWeekly, setCreatingWeekly] = useState(false);
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => mondayFor(dateAtTimezone(new Date(), companyTimezone)));
  const [employeeFilter,setEmployeeFilter]=useState('');const [locationFilter,setLocationFilter]=useState('');const [departmentFilter,setDepartmentFilter]=useState('');const [statusFilter,setStatusFilter]=useState('scheduled');
  const [managingSeries,setManagingSeries]=useState<WeeklySeries|null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params=new URLSearchParams({type:'schedules',weekStart,status:statusFilter});if(employeeFilter)params.set('employeeId',employeeFilter);if(locationFilter)params.set('locationId',locationFilter);if(departmentFilter)params.set('departmentId',departmentFilter);
      const response = await fetch(`/api/shifts?${params}`, {
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
  }, [departmentFilter, employeeFilter, locationFilter, statusFilter, t, weekStart]);

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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">{personal ? t.schedule.personalTitle : t.schedule.managementTitle}</h1>
          <p className="mt-2 text-slate-600">{personal ? t.schedule.personalDescription : t.schedule.managementDescription}</p>
        </div>
        {!personal ? (<div className="flex flex-wrap gap-2"><button type="button" onClick={() => setCreatingWeekly(true)} disabled={!payload?.employees.length || !payload.locations.length} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-300 px-4 font-black text-slate-950 disabled:opacity-50"><Plus className="h-4 w-4" aria-hidden="true" />{t.schedule.createWeekly}</button>
          <button
            type="button"
            onClick={() => { setCreatedMessage(null); setCreating(true); }}
            disabled={!payload?.employees.length || !payload.locations.length}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-300 px-4 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t.schedule.createShift}
          </button>
        </div>) : null}
      </header>

      {createdMessage ? <p role="status" className="rounded-xl border border-emerald-400/30 bg-emerald-950/50 p-3 text-emerald-100">{createdMessage}</p> : null}
      {!personal&&payload?<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><select aria-label={t.schedule.employee} className="input" value={employeeFilter} onChange={event=>setEmployeeFilter(event.target.value)}><option value="">{t.schedule.allEmployees}</option>{payload.employees.map(employee=><option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select><select aria-label={t.schedule.location} className="input" value={locationFilter} onChange={event=>setLocationFilter(event.target.value)}><option value="">{t.schedule.allLocations}</option>{payload.locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select><select aria-label={t.schedule.department} className="input" value={departmentFilter} onChange={event=>setDepartmentFilter(event.target.value)}><option value="">{t.schedule.allDepartments}</option>{Array.from(new Map(payload.employees.filter(employee=>employee.departmentId&&employee.departmentName).map(employee=>[employee.departmentId!,employee.departmentName!]))).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select><select aria-label={t.schedule.status} className="input" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="scheduled">{t.schedule.scheduled}</option><option value="cancelled">{t.schedule.cancelled}</option><option value="completed">{t.schedule.completed}</option></select></div>:null}

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

      {!loading && !error && payload?.schedules.length === 0 && payload.concreteShifts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
          {personal ? t.schedule.noSchedules : t.schedule.noManagementSchedules}
        </div>
      ) : null}

      {!loading && !error && personal && payload ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {days.map((day, index) => {
            const date = shiftDate(weekStart, index);
            const concrete = payload.concreteShifts.find((shift) => shift.date === date) ?? null;
            const shift = concrete
              ? { name: t.schedule.scheduled, startTime: concrete.startTime, endTime: concrete.endTime }
              : payload.schedules[0]?.days[day] ?? null;
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

      {!loading && !error && !personal && payload?.concreteShifts.length ? (
        <section aria-labelledby="concrete-shifts-title">
          <h2 id="concrete-shifts-title" className="mb-3 text-lg font-bold text-slate-950">{t.schedule.concreteShifts}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {payload.concreteShifts.map((shift) => {
              const employee = payload.employees.find((row) => row.id === shift.employeeId);
              const location = payload.locations.find((row) => row.id === shift.locationId);
              return (
                <article key={shift.id} className="rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-white">
                  <p className="font-bold" dir="auto">{employee ? `${employee.firstName} ${employee.lastName}`.trim() : t.schedule.employee}</p>
                  <p className="mt-1 text-sm text-slate-300">{shift.date} · <bdi dir="ltr">{shift.startTime}–{shift.endTime}</bdi></p>
                  {location ? <p className="mt-1 text-xs text-slate-400" dir="auto">{location.name} · <bdi dir="ltr">{location.timezone}</bdi></p> : null}
                </article>
              );
            })}
          </div>
        </section>
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

      {creating && payload ? (
        <CreateShiftDialog
          employees={payload.employees}
          locations={payload.locations}
          initialDate={weekStart}
          t={t.schedule}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            await load();
            setCreatedMessage(t.schedule.shiftCreated);
            setCreating(false);
          }}
        />
      ) : null}
      {!loading&&!error&&!personal&&payload?.weeklySeries.length?<section><h2 className="mb-3 text-lg font-bold">{t.schedule.weeklySchedules}</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{payload.weeklySeries.map(series=>{const employee=payload.employees.find(row=>row.id===series.employeeId);return <article key={series.id} className="rounded-2xl border border-white/10 bg-slate-950 p-4 text-white"><p className="font-bold" dir="auto">{employee?`${employee.firstName} ${employee.lastName}`:t.schedule.employee}</p><p className="mt-1"><bdi dir="ltr">{series.startTime}–{series.endTime}</bdi> · {series.status}</p><p className="mt-1 text-sm text-slate-400">{series.weekdays.map(day=>day).join(', ')}</p><button type="button" onClick={()=>setManagingSeries(series)} className="mt-3 min-h-11 rounded-xl border border-white/15 px-4">{t.schedule.manage}</button></article>})}</div></section>:null}
      {creatingWeekly && payload ? <WeeklyShiftDialog employees={payload.employees} locations={payload.locations} initialDate={weekStart} t={t.schedule} onClose={() => setCreatingWeekly(false)} onCreated={async () => { await load(); setCreatedMessage(t.schedule.weeklyCreated); setCreatingWeekly(false); }} /> : null}
      {managingSeries?<ManageWeeklyDialog series={managingSeries} t={t.schedule} onClose={()=>setManagingSeries(null)} onSaved={async()=>{await load();setManagingSeries(null);}}/>:null}
    </section>
  );
}

type ScheduleCopy = ReturnType<typeof useLocale>['messages']['schedule'];

function ManageWeeklyDialog({series,t,onClose,onSaved}:{series:WeeklySeries;t:ScheduleCopy;onClose():void;onSaved():Promise<void>}){const[action,setAction]=useState<'pause'|'resume'|'end'|'edit'|'exception'>(series.status==='paused'?'resume':'pause');const[date,setDate]=useState(series.effectiveFrom);const[kind,setKind]=useState<'day_off'|'approved_leave'|'override'>('day_off');const[startTime,setStartTime]=useState(series.startTime);const[endTime,setEndTime]=useState(series.endTime);const[pending,setPending]=useState(false);const[error,setError]=useState<string|null>(null);async function save(){setPending(true);setError(null);try{const input=action==='exception'?{date,kind,...(kind==='override'?{locationId:series.locationId,startTime,endTime}:{})}:action==='edit'?{effectiveFrom:date,startTime,endTime}:action==='end'?{effectiveFrom:date}:{};const response=await fetch('/api/shifts',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'manage_weekly_schedule',data:{scheduleAction:action,seriesIds:[series.id],input}})});const body:unknown=await response.json();if(!response.ok)throw new Error(isRecord(body)&&typeof body.error==='string'?body.error:'WEEKLY_SHIFT_UNAVAILABLE');await onSaved();}catch(reason){setError(reason instanceof Error?reason.message:t.unavailable);}finally{setPending(false);}}return <div className="fixed inset-0 z-[96] flex items-end justify-center bg-black/75 sm:items-center sm:p-5" role="dialog" aria-modal="true"><div className="max-h-[100dvh] w-full overflow-y-auto bg-slate-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white sm:max-w-lg sm:rounded-3xl"><header className="flex justify-between"><h2 className="text-xl font-black">{t.manageWeekly}</h2><button type="button" onClick={onClose} className="min-h-11 min-w-11"><X/></button></header><label className="mt-4 block">{t.action}<select className="input" value={action} onChange={event=>setAction(event.target.value as typeof action)}><option value="pause">{t.pause}</option><option value="resume">{t.resume}</option><option value="end">{t.endSchedule}</option><option value="edit">{t.futureEdit}</option><option value="exception">{t.exception}</option></select></label>{['end','edit','exception'].includes(action)?<label className="mt-4 block">{t.date}<input type="date" className="input" value={date} onChange={event=>setDate(event.target.value)}/></label>:null}{action==='exception'?<label className="mt-4 block">{t.exception}<select className="input" value={kind} onChange={event=>setKind(event.target.value as typeof kind)}><option value="day_off">{t.dayOff}</option><option value="approved_leave">{t.approvedLeave}</option><option value="override">{t.override}</option></select></label>:null}{action==='edit'||kind==='override'?<div className="mt-4 grid grid-cols-2 gap-3"><input aria-label={t.startTime} type="time" className="input" value={startTime} onChange={event=>setStartTime(event.target.value)}/><input aria-label={t.endTime} type="time" className="input" value={endTime} onChange={event=>setEndTime(event.target.value)}/></div>:null}{error?<p role="alert" className="mt-4 text-red-200">{error}</p>:null}<footer className="sticky bottom-0 mt-5 flex gap-3 border-t border-white/10 bg-slate-950 pt-4"><button type="button" onClick={onClose} className="min-h-11 flex-1">{t.cancel}</button><button type="button" disabled={pending} onClick={()=>void save()} className="min-h-11 flex-1 rounded-xl bg-cyan-300 font-bold text-slate-950">{t.save}</button></footer></div></div>}

function WeeklyShiftDialog({ employees, locations, initialDate, t, onClose, onCreated }: { employees: EmployeeOption[]; locations: LocationOption[]; initialDate: string; t: ScheduleCopy; onClose(): void; onCreated(): Promise<void> }) {
  const [employeeIds,setEmployeeIds]=useState<string[]>([]);const [locationId,setLocationId]=useState(locations[0]?.id??'');const [weekdays,setWeekdays]=useState<number[]>([0,1,2,4,5,6]);
  const [startTime,setStartTime]=useState('09:00');const [endTime,setEndTime]=useState('17:00');const [startDate,setStartDate]=useState(initialDate);const [endDate,setEndDate]=useState('');
  const [preview,setPreview]=useState<{rows:Record<string,unknown>[];errors:Record<string,unknown>[];valid:boolean;previewToken:string}|null>(null);const [pending,setPending]=useState(false);const [error,setError]=useState<string|null>(null);
  const input={employeeIds,locationId,weekdays,startTime,endTime,startDate,endDate:endDate||null};
  async function request(action:'preview_weekly_schedule'|'confirm_weekly_schedule'){setPending(true);setError(null);try{const response=await fetch('/api/shifts',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({action,data:input,...(action==='confirm_weekly_schedule'?{previewToken:preview?.previewToken}:{})})});const body:unknown=await response.json();if(!response.ok||!isRecord(body)||!isRecord(body.data))throw new Error(isRecord(body)&&typeof body.error==='string'?body.error:'WEEKLY_SHIFT_UNAVAILABLE');if(action==='preview_weekly_schedule'){const data=body.data;if(!Array.isArray(data.rows)||!Array.isArray(data.errors)||typeof data.valid!=='boolean'||typeof data.previewToken!=='string')throw new Error('WEEKLY_SHIFT_UNAVAILABLE');setPreview(data as typeof preview);}else await onCreated();}catch(reason){setError(reason instanceof Error?reason.message:t.unavailable);}finally{setPending(false);}}
  return <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="weekly-shift-title"><div className="max-h-[100dvh] w-full overflow-y-auto bg-slate-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white sm:max-w-3xl sm:rounded-3xl" dir="inherit"><header className="flex justify-between"><div><h2 id="weekly-shift-title" className="text-xl font-black">{t.weeklyTitle}</h2><p className="text-sm text-slate-400">{t.weeklyDescription}</p></div><button type="button" onClick={onClose} aria-label={t.cancel} className="min-h-11 min-w-11"><X /></button></header><div className="mt-5 grid gap-4 sm:grid-cols-2"><fieldset className="sm:col-span-2"><legend>{t.employee}</legend><div className="mt-2 grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2">{employees.map(employee=><label key={employee.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 p-2"><input type="checkbox" checked={employeeIds.includes(employee.id)} onChange={()=>setEmployeeIds(current=>current.includes(employee.id)?current.filter(id=>id!==employee.id):[...current,employee.id])}/><span dir="auto">{employee.firstName} {employee.lastName}</span></label>)}</div></fieldset><label>{t.location}<select className="input" value={locationId} onChange={event=>setLocationId(event.target.value)}>{locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><fieldset><legend>{t.workingDays}</legend><div className="flex flex-wrap gap-2">{days.map((day,index)=>{const dow=(index+1)%7;return <label key={day} className="rounded-lg border border-white/10 p-2"><input type="checkbox" checked={weekdays.includes(dow)} onChange={()=>setWeekdays(current=>current.includes(dow)?current.filter(value=>value!==dow):[...current,dow])}/> {t.days[day]}</label>})}</div></fieldset><label>{t.startTime}<input className="input" type="time" value={startTime} onChange={event=>setStartTime(event.target.value)}/></label><label>{t.endTime}<input className="input" type="time" value={endTime} onChange={event=>setEndTime(event.target.value)}/></label><label>{t.startDate}<input className="input" type="date" value={startDate} onChange={event=>setStartDate(event.target.value)}/></label><label>{t.optionalEndDate}<input className="input" type="date" value={endDate} onChange={event=>setEndDate(event.target.value)}/></label></div>{endTime<=startTime?<p className="mt-3 text-amber-200">{t.overnight}</p>:null}{preview?<section className="mt-4 rounded-2xl border border-white/10 p-4"><h3 className="font-bold">{t.preview}</h3><p>{preview.rows.length} {t.generatedShifts}</p>{preview.errors.length?<pre className="mt-2 whitespace-pre-wrap text-sm text-red-200">{JSON.stringify(preview.errors,null,2)}</pre>:null}</section>:null}{error?<p role="alert" className="mt-4 text-red-200">{error}</p>:null}<footer className="sticky bottom-0 mt-5 flex flex-wrap gap-3 border-t border-white/10 bg-slate-950 pt-4 pb-[max(0rem,env(safe-area-inset-bottom))]"><button type="button" onClick={onClose} className="min-h-11 flex-1">{t.cancel}</button><button type="button" disabled={pending||!employeeIds.length||!weekdays.length} onClick={()=>void request('preview_weekly_schedule')} className="min-h-11 flex-1 rounded-xl border border-violet-300">{t.preview}</button><button type="button" disabled={pending||!preview?.valid} onClick={()=>void request('confirm_weekly_schedule')} className="min-h-11 flex-1 rounded-xl bg-violet-300 font-black text-slate-950">{t.confirmAll}</button></footer></div></div>;
}

function creationErrorMessage(code: string, t: ScheduleCopy) {
  if (code === 'SHIFT_INPUT_INVALID') return t.inputInvalid;
  if (code === 'SHIFT_EMPLOYEE_INVALID') return t.employeeInvalid;
  if (code === 'SHIFT_LOCATION_INVALID') return t.locationInvalid;
  if (code === 'SHIFT_LOCAL_TIME_INVALID') return t.localTimeInvalid;
  if (code === 'SHIFT_DUPLICATE') return t.duplicate;
  if (code === 'SHIFT_CONFLICT') return t.conflict;
  return t.unavailable;
}

function CreateShiftDialog({ employees, locations, initialDate, t, onClose, onCreated }: {
  employees: EmployeeOption[];
  locations: LocationOption[];
  initialDate: string;
  t: ScheduleCopy;
  onClose(): void;
  onCreated(): Promise<void>;
}) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const location = locations.find((row) => row.id === locationId);
  const overnight = Boolean(startTime && endTime && endTime <= startTime);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/shifts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action: 'create_shift',
          data: { employeeId, locationId, date, startTime, endTime },
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const code = isRecord(body) && typeof body.error === 'string' ? body.error : 'SHIFT_UNAVAILABLE';
        throw new Error(code);
      }
      await onCreated();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : 'SHIFT_UNAVAILABLE';
      setError(creationErrorMessage(code, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="create-shift-title">
      <form onSubmit={(event) => void submit(event)} className="max-h-[100dvh] w-full overflow-y-auto overscroll-contain bg-slate-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white sm:max-w-lg sm:rounded-3xl sm:border sm:border-white/10">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="create-shift-title" className="text-xl font-black">{t.createShiftTitle}</h2>
            <p className="mt-1 text-sm text-slate-400">{t.createShiftDescription}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.cancel} className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/10">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="mt-5 grid gap-4">
          <label className="text-sm text-slate-300">
            <span className="mb-1 block">{t.employee}</span>
            <select required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className="input">
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            <span className="mb-1 block">{t.location}</span>
            <select required value={locationId} onChange={(event) => setLocationId(event.target.value)} className="input">
              {locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            <span className="mb-1 block">{t.date}</span>
            <input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className="input" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-slate-300">
              <span className="mb-1 block">{t.startTime}</span>
              <input required type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="input" />
            </label>
            <label className="text-sm text-slate-300">
              <span className="mb-1 block">{t.endTime}</span>
              <input required type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="input" />
            </label>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-4 text-sm">
          <p>{date} · <bdi dir="ltr">{startTime}–{endTime}</bdi></p>
          <p className="mt-1 text-slate-300">{t.timezone}: <bdi dir="ltr">{location?.timezone ?? '—'}</bdi></p>
          {overnight ? <p className="mt-1 text-amber-200">{t.overnight}</p> : null}
        </div>

        {error ? <p role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-950/60 p-3 text-red-100">{error}</p> : null}

        <footer className="sticky bottom-0 mt-5 flex gap-3 border-t border-white/10 bg-slate-950 pt-4 pb-[max(0rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onClose} disabled={pending} className="min-h-11 flex-1 rounded-xl border border-white/15 font-bold">{t.cancel}</button>
          <button type="submit" disabled={pending || !employeeId || !locationId} className="min-h-11 flex-1 rounded-xl bg-cyan-300 font-black text-slate-950 disabled:opacity-50">
            {pending ? t.creating : t.create}
          </button>
        </footer>
      </form>
    </div>
  );
}
