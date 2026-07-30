'use client';

import { CircleAlert, Pause, Play, Plus, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useLocale } from '@/components/LocaleProvider';
import { recurringMessages } from '@/lib/recurring-tasks/i18n';

type Location = { id: string; name: string; timezone: string };
type Department = { id: string; name: string; location_id: string|null };
type Employee = { id: string; first_name: string; last_name: string; location_id: string|null; department_id: string|null; role: string };
type Rule = {
  id: string; name: string; description: string|null; status: 'active'|'paused'|'ended'; timezone: string;
  location_id: string|null; current_version: number; next_occurrence_at: string|null; locations: { name: string }|null;
  recurring_task_rule_versions: Array<{
    version: number;
    recurrence: { kind: string; weekdays: number[] };
    time_anchor: { kind: string; localTime: string|null; offsetMinutes: number };
    task_template: { title: string; description: string|null; priority: string; evidenceRequired: boolean; countRequirement: Record<string, unknown>|null };
    workforce: { departmentId: string|null; employeeRole: string|null; shiftOverlapRequired: true; specificEmployeeId: string|null };
    assignment_mode: string; reminder_offsets_minutes: number[]; start_date: string; end_date: string|null;
  }>;
};
type Outcome = { id: string; rule_id: string; local_occurrence_at: string; outcome: string; created_task_count: number; safe_failure_code: string|null };
type OperatingHour = { location_id: string; weekday: number; is_closed: boolean; opens_at: string|null; closes_at: string|null };
type Payload = { rules: Rule[]; outcomes: Outcome[]; locations: Location[]; departments: Department[]; employees: Employee[]; operatingHours: OperatingHour[] };

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const jsonHeaders = { 'Content-Type': 'application/json' };
const latestVersion = (rule: Rule) => [...rule.recurring_task_rule_versions]
  .sort((left, right) => right.version - left.version)[0];

function errorCode(payload: unknown) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) && typeof (payload as { error?: unknown }).error === 'string'
    ? String((payload as { error: string }).error) : 'RECURRING_UNAVAILABLE';
}

export function RecurringRoutinesConsole() {
  const { language, companyTimezone } = useLocale();
  const t = recurringMessages[language];
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Rule|null>(null);
  const [configuringHours, setConfiguringHours] = useState(false);
  const [preview, setPreview] = useState<Array<Record<string, unknown>>>([]);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/recurring-routines', { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.data) throw new Error(errorCode(body));
      setPayload(body.data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'RECURRING_UNAVAILABLE'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const unresolved = useMemo(() => payload?.outcomes.filter((row) =>
    ['no_eligible_employee', 'invalid_schedule', 'dst_failure', 'failed'].includes(row.outcome)) ?? [], [payload]);

  async function mutate(rule: Rule, action: 'pause'|'resume'|'end') {
    setPending(true);
    try {
      const response = await fetch(`/api/recurring-routines/${rule.id}`, {
        method: 'PATCH', headers: jsonHeaders,
        body: JSON.stringify({ action, expectedVersion: rule.current_version }),
      });
      if (!response.ok) throw new Error(errorCode(await response.json().catch(() => null)));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'RECURRING_UNAVAILABLE'); }
    finally { setPending(false); }
  }

  return (
    <main className="min-w-0 space-y-5 pb-[max(6rem,env(safe-area-inset-bottom))] text-white" data-testid="recurring-routines-console">
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-3xl border border-white/10 bg-slate-950/70 p-5">
        <div><p className="text-xs font-black uppercase tracking-[.2em] text-cyan-300">{t.eyebrow}</p>
          <h1 className="mt-2 text-2xl font-black">{t.title}</h1><p className="mt-1 text-sm text-slate-400">{t.description}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setConfiguringHours(true)} className="min-h-11 rounded-xl border border-white/15 px-4 font-bold">{t.operatingHours}</button>
          <button type="button" onClick={() => setCreating(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-300 px-4 font-black text-slate-950">
            <Plus className="h-4 w-4" aria-hidden="true" />{t.create}
          </button>
        </div>
      </header>
      <p className="rounded-2xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">{t.advisory}</p>
      {loading ? <p role="status">{t.loading}</p> : null}
      {error ? <div role="alert" className="rounded-2xl border border-red-400/30 bg-red-950/40 p-4"><p>{t.failed}</p><code className="text-xs">{error}</code>
        <button type="button" onClick={() => void load()} className="ms-3 underline">{t.retry}</button></div> : null}
      {!loading && payload?.rules.length === 0 ? <p className="rounded-2xl border border-white/10 p-8 text-center text-slate-400">{t.empty}</p> : null}
      <section className="grid gap-4 lg:grid-cols-2">
        {payload?.rules.map((rule) => {
          const version = latestVersion(rule);
          return <article key={rule.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0">
              <h2 className="truncate font-black" dir="auto">{rule.name}</h2>
              <p className="mt-1 text-xs text-slate-400">{rule.locations?.name ?? 'Company'} · {rule.timezone}</p></div>
              <span className="rounded-full bg-white/10 px-2 py-1 text-xs">{t[rule.status]}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-500">{t.recurrence}</dt><dd>{version?.recurrence.kind ?? '—'}</dd></div>
              <div><dt className="text-slate-500">{t.assignment}</dt><dd className="break-words">{version?.assignment_mode ?? '—'}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">{t.next}</dt>
                <dd>{rule.next_occurrence_at ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short', timeZone: rule.timezone }).format(new Date(rule.next_occurrence_at)) : t.noNext}</dd></div>
            </dl>
            <div className="mt-4 flex gap-2">
              {rule.status !== 'ended' ? <button disabled={pending} onClick={() => setEditing(rule)} className="min-h-10 rounded-xl border border-white/15 px-3">{t.edit}</button> : null}
              {rule.status === 'active' ? <button disabled={pending} onClick={() => void mutate(rule, 'pause')} className="min-h-10 rounded-xl border border-white/15 px-3"><Pause className="me-2 inline h-4 w-4" />{t.pause}</button> : null}
              {rule.status === 'paused' ? <button disabled={pending} onClick={() => void mutate(rule, 'resume')} className="min-h-10 rounded-xl border border-white/15 px-3"><Play className="me-2 inline h-4 w-4" />{t.resume}</button> : null}
              {rule.status !== 'ended' ? <button disabled={pending} onClick={() => void mutate(rule, 'end')} className="min-h-10 rounded-xl border border-red-400/20 px-3 text-red-200"><Square className="me-2 inline h-4 w-4" />{t.finish}</button> : null}
            </div>
          </article>;
        })}
      </section>
      {unresolved.length ? <section className="rounded-2xl border border-amber-300/20 bg-slate-950/70 p-4">
        <h2 className="flex items-center gap-2 font-black"><CircleAlert className="h-5 w-5 text-amber-300" />{t.unresolved}</h2>
        <ul className="mt-3 space-y-2 text-sm">{unresolved.map((row) => <li key={row.id} className="rounded-xl bg-white/5 p-3">
          {row.local_occurrence_at} · {row.outcome} {row.safe_failure_code ? `· ${row.safe_failure_code}` : ''}
        </li>)}</ul>
      </section> : null}
      {creating || editing ? <RuleDialog payload={payload} timezone={companyTimezone} t={t} preview={preview} pending={pending} initialRule={editing}
        onClose={() => { setCreating(false); setEditing(null); setPreview([]); }}
        onPreview={async (rule) => {
          setPending(true);
          try {
            const response = await fetch('/api/recurring-routines', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ preview: true, rule }) });
            const body = await response.json().catch(() => null);
            if (!response.ok) throw new Error(errorCode(body));
            setPreview(Array.isArray(body.data) ? body.data : []);
          } finally { setPending(false); }
        }}
        onSave={async (rule) => {
          setPending(true);
          try {
            const response = editing
              ? await fetch(`/api/recurring-routines/${editing.id}`, { method: 'PATCH', headers: jsonHeaders,
                body: JSON.stringify({ action: 'version', expectedVersion: editing.current_version, rule }) })
              : await fetch('/api/recurring-routines', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(rule) });
            if (!response.ok) throw new Error(errorCode(await response.json().catch(() => null)));
            setCreating(false); setEditing(null); setPreview([]); await load();
          } finally { setPending(false); }
        }} /> : null}
      {configuringHours && payload ? <HoursDialog payload={payload} t={t} pending={pending}
        onClose={() => setConfiguringHours(false)}
        onSave={async (value) => {
          setPending(true);
          try {
            const response = await fetch('/api/recurring-routines', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(value) });
            if (!response.ok) throw new Error(errorCode(await response.json().catch(() => null)));
            setConfiguringHours(false); await load();
          } finally { setPending(false); }
        }} /> : null}
    </main>
  );
}

function RuleDialog({ payload, timezone, t, preview, pending, initialRule, onClose, onPreview, onSave }: {
  payload: Payload|null; timezone: string; t: typeof recurringMessages.en | typeof recurringMessages.ar;
  preview: Array<Record<string, unknown>>; pending: boolean; initialRule: Rule|null; onClose(): void;
  onPreview(rule: unknown): Promise<void>; onSave(rule: unknown): Promise<void>;
}) {
  const [formError, setFormError] = useState<string|null>(null);
  const initial = initialRule ? latestVersion(initialRule) : undefined;
  function ruleFromForm(form: HTMLFormElement) {
    const data = new FormData(form);
    const location = payload?.locations.find((row) => row.id === data.get('locationId'));
    const recurrenceKind = String(data.get('recurrence'));
    const selectedDays = data.getAll('weekday').map(Number);
    const reminders = String(data.get('reminders') ?? '').split(',').filter(Boolean).map((value) => Number(value.trim()));
    const countRequired = data.get('countRequired') === 'on';
    return {
      name: data.get('name'), description: data.get('description') || null,
      locationId: data.get('locationId') || null, timezone: location?.timezone ?? timezone,
      recurrence: { kind: recurrenceKind, weekdays: recurrenceKind === 'daily' ? [] : selectedDays },
      timeAnchor: { kind: data.get('anchor'), localTime: data.get('anchor') === 'fixed_time' ? data.get('localTime') : null, offsetMinutes: Number(data.get('offset')) },
      startDate: data.get('startDate'), endDate: data.get('endDate') || null,
      taskTemplate: { title: data.get('taskTitle'), description: data.get('taskDescription') || null,
        priority: data.get('priority'), evidenceRequired: data.get('evidenceRequired') === 'on',
        countRequirement: countRequired ? { countRequired: true, countLabel: data.get('countLabel'), unit: data.get('unit'),
          damagedQuantityRequested: false, allowDecimals: true, instructions: null } : null },
      workforce: { departmentId: data.get('departmentId') || null, employeeRole: data.get('employeeRole') || null,
        shiftOverlapRequired: true, specificEmployeeId: data.get('assignmentMode') === 'specific_employee_if_on_shift' ? data.get('specificEmployeeId') || null : null },
      assignmentMode: data.get('assignmentMode'), reminderOffsetsMinutes: reminders,
    };
  }
  async function submit(event: FormEvent<HTMLFormElement>, previewOnly: boolean) {
    event.preventDefault(); setFormError(null);
    try { await (previewOnly ? onPreview(ruleFromForm(event.currentTarget)) : onSave(ruleFromForm(event.currentTarget))); }
    catch (reason) { setFormError(reason instanceof Error ? reason.message : 'RECURRING_UNAVAILABLE'); }
  }
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 sm:items-center sm:p-5" role="dialog" aria-modal="true">
    <form onSubmit={(event) => void submit(event, false)} className="max-h-[100dvh] w-full overflow-y-auto overscroll-contain bg-slate-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-3xl sm:rounded-3xl sm:border sm:border-white/10">
      <div className="flex items-center justify-between"><h2 className="text-xl font-black">{initialRule ? t.edit : t.create}</h2><button type="button" onClick={onClose} className="min-h-11 px-3">{t.cancel}</button></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label={t.name}><input name="name" required maxLength={160} defaultValue={initialRule?.name ?? ''} className="input" /></Field>
        <Field label={t.location}><select name="locationId" required defaultValue={initialRule?.location_id ?? ''} className="input"><option value="">—</option>{payload?.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
        <Field label={t.taskTitle}><input name="taskTitle" required maxLength={200} defaultValue={initial?.task_template.title ?? ''} className="input" /></Field>
        <Field label={t.priority}><select name="priority" defaultValue={initial?.task_template.priority ?? 'medium'} className="input">{['low','medium','high','critical'].map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label={t.taskDescription}><textarea name="taskDescription" maxLength={2000} defaultValue={initial?.task_template.description ?? ''} className="input" /></Field>
        <Field label={t.recurrence}><select name="recurrence" defaultValue={initial?.recurrence.kind ?? 'daily'} className="input">
          <option value="daily">{t.daily}</option><option value="selected_weekdays">{t.selected}</option>
          <option value="except_weekdays">{t.except}</option><option value="weekly">{t.weekly}</option>
        </select></Field>
        <fieldset className="sm:col-span-2"><legend className="text-sm text-slate-300">{t.selected}</legend><div className="mt-2 flex flex-wrap gap-2">
          {weekdays.map((day, index) => <label key={day} className="rounded-xl border border-white/10 px-3 py-2"><input type="checkbox" name="weekday" value={index} defaultChecked={initial?.recurrence.weekdays.includes(index)} className="me-2" />{day}</label>)}</div></fieldset>
        <Field label={t.localTime}><select name="anchor" defaultValue={initial?.time_anchor.kind ?? 'fixed_time'} className="input"><option value="fixed_time">{t.fixed}</option><option value="location_opening">{t.opening}</option><option value="location_closing">{t.closing}</option></select>
          <input type="time" name="localTime" defaultValue={initial?.time_anchor.localTime ?? '09:00'} className="input mt-2" /></Field>
        <Field label={t.offset}><input type="number" name="offset" min={-720} max={720} defaultValue={initial?.time_anchor.offsetMinutes ?? 0} className="input" /></Field>
        <Field label={t.start}><input type="date" name="startDate" required defaultValue={initial?.start_date ?? new Date().toISOString().slice(0, 10)} className="input" /></Field>
        <Field label={t.end}><input type="date" name="endDate" defaultValue={initial?.end_date ?? ''} className="input" /></Field>
        <Field label={t.assignment}><select name="assignmentMode" defaultValue={initial?.assignment_mode ?? 'every_matching_employee_on_shift'} className="input"><option value="every_matching_employee_on_shift">{t.every}</option><option value="one_matching_employee_on_shift">{t.one}</option><option value="specific_employee_if_on_shift">{t.specific}</option></select></Field>
        <Field label={t.department}><select name="departmentId" defaultValue={initial?.workforce.departmentId ?? ''} className="input"><option value="">{t.anyDepartment}</option>{payload?.departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
        <Field label={t.role}><input name="employeeRole" defaultValue={initial?.workforce.employeeRole ?? ''} placeholder={t.anyRole} className="input" /></Field>
        <Field label={t.specific}><select name="specificEmployeeId" defaultValue={initial?.workforce.specificEmployeeId ?? ''} className="input"><option value="">—</option>{payload?.employees.map((row) => <option key={row.id} value={row.id}>{row.first_name} {row.last_name}</option>)}</select></Field>
        <Field label={t.reminders}><input name="reminders" defaultValue={initial?.reminder_offsets_minutes.join(',') ?? ''} placeholder="30,0" className="input" /></Field>
        <div className="space-y-3"><label><input type="checkbox" name="evidenceRequired" defaultChecked={initial?.task_template.evidenceRequired} className="me-2" />{t.evidence}</label><label><input type="checkbox" name="countRequired" defaultChecked={Boolean(initial?.task_template.countRequirement)} className="me-2" />{t.count}</label></div>
        <Field label={t.count}><div className="flex gap-2"><input name="countLabel" defaultValue={String(initial?.task_template.countRequirement?.countLabel ?? '')} placeholder="Items" className="input" /><input name="unit" defaultValue={String(initial?.task_template.countRequirement?.unit ?? '')} placeholder="items" className="input" /></div></Field>
      </div>
      {formError ? <p role="alert" className="mt-4 text-red-300">{formError}</p> : null}
      {preview.length ? <div className="mt-4 rounded-2xl bg-white/5 p-4"><h3 className="font-bold">{t.preview}</h3><pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(preview, null, 2)}</pre></div> : null}
      <div className="sticky bottom-0 mt-5 flex gap-3 border-t border-white/10 bg-slate-950 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button disabled={pending} type="button" onClick={(event) => {
          const form = event.currentTarget.form;
          if (!form) return;
          setFormError(null);
          void onPreview(ruleFromForm(form)).catch((reason) =>
            setFormError(reason instanceof Error ? reason.message : 'RECURRING_UNAVAILABLE'));
        }} className="min-h-11 flex-1 rounded-xl border border-white/15">{t.preview}</button>
        <button disabled={pending} type="submit" className="min-h-11 flex-1 rounded-xl bg-cyan-300 font-black text-slate-950">{pending ? t.saving : initialRule ? t.update : t.save}</button>
      </div>
    </form>
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm text-slate-300"><span className="mb-1 block">{label}</span>{children}</label>;
}

function HoursDialog({ payload, t, pending, onClose, onSave }: {
  payload: Payload; t: typeof recurringMessages.en | typeof recurringMessages.ar; pending: boolean;
  onClose(): void; onSave(value: unknown): Promise<void>;
}) {
  const [locationId, setLocationId] = useState(payload.locations[0]?.id ?? '');
  const [error, setError] = useState<string|null>(null);
  const existing = (weekday: number) => payload.operatingHours.find((row) =>
    row.location_id === locationId && row.weekday === weekday);
  return <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 sm:items-center sm:p-5" role="dialog" aria-modal="true">
    <form onSubmit={(event) => {
      event.preventDefault(); setError(null);
      const data = new FormData(event.currentTarget);
      const days = weekdays.map((_, weekday) => ({
        weekday, isClosed: data.get(`closed-${weekday}`) === 'on',
        opensAt: data.get(`open-${weekday}`), closesAt: data.get(`close-${weekday}`),
      }));
      void onSave({ locationId, days }).catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'RECURRING_UNAVAILABLE'));
    }} className="max-h-[100dvh] w-full overflow-y-auto bg-slate-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-xl sm:rounded-3xl sm:border sm:border-white/10">
      <div className="flex items-center justify-between"><div><h2 className="text-xl font-black">{t.operatingHours}</h2><p className="text-sm text-slate-400">{t.configureHours}</p></div>
        <button type="button" onClick={onClose} className="min-h-11 px-3">{t.cancel}</button></div>
      <select value={locationId} onChange={(event) => setLocationId(event.target.value)} required className="input mt-5">
        {payload.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
      </select>
      <div className="mt-4 space-y-2">{weekdays.map((day, weekday) => {
        const row = existing(weekday);
        return <fieldset key={`${locationId}-${day}`} className="grid grid-cols-[1fr_6rem_6rem] items-center gap-2 rounded-xl border border-white/10 p-3">
          <legend className="sr-only">{day}</legend><label className="font-bold"><input type="checkbox" name={`closed-${weekday}`} defaultChecked={row?.is_closed} className="me-2" />{day} · {t.closed}</label>
          <input aria-label={`${day} opening`} type="time" name={`open-${weekday}`} defaultValue={row?.opens_at?.slice(0,5) ?? '09:00'} className="input" />
          <input aria-label={`${day} closing`} type="time" name={`close-${weekday}`} defaultValue={row?.closes_at?.slice(0,5) ?? '23:00'} className="input" />
        </fieldset>;
      })}</div>
      {error ? <p role="alert" className="mt-3 text-red-300">{error}</p> : null}
      <button disabled={pending || !locationId} type="submit" className="mt-5 min-h-11 w-full rounded-xl bg-cyan-300 font-black text-slate-950">{pending ? t.saving : t.update}</button>
    </form>
  </div>;
}
