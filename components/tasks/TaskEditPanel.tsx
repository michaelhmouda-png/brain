'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { isRecord } from '@/lib/client-api';
import { taskDeadlineFormValues, type TaskEditOptions } from '@/lib/task-edit';
import { taskListItemFromPayload, type TaskListItem } from '@/lib/task-list';

type FormState = {
  title: string;
  description: string;
  assignedEmployeeId: string;
  priority: TaskListItem['priority'];
  status: TaskListItem['status'];
  dueDate: string;
  dueTime: string;
  locationId: string;
  countRequired: boolean;
  countLabel: string;
  countUnit: string;
  countInstructions: string;
  damagedQuantityRequested: boolean;
  allowDecimals: boolean;
};

function formFromTask(task: TaskListItem): FormState {
  const deadline = taskDeadlineFormValues(
    task.dueDate,
    task.dueAt,
    task.companyTimezone ?? 'UTC',
  );
  return {
    title: task.title,
    description: task.description ?? '',
    assignedEmployeeId: task.assignedEmployee?.id ?? '',
    priority: task.priority,
    status: task.status,
    dueDate: deadline.dueDate,
    dueTime: deadline.dueTime,
    locationId: task.location?.id ?? '',
    countRequired: task.countRequirement?.countRequired === true,
    countLabel: task.countRequirement?.countLabel ?? '',
    countUnit: task.countRequirement?.unit ?? 'pieces',
    countInstructions: task.countRequirement?.instructions ?? '',
    damagedQuantityRequested: task.countRequirement?.damagedQuantityRequested ?? false,
    allowDecimals: task.countRequirement?.allowDecimals ?? false,
  };
}

export function TaskEditPanel({
  task,
  options,
  onClose,
  onUpdated,
  onRefresh,
}: {
  task: TaskListItem;
  options: TaskEditOptions;
  onClose(): void;
  onUpdated(task: TaskListItem): void;
  onRefresh(): Promise<void>;
}) {
  const { messages: t } = useLocale();
  const [form, setForm] = useState<FormState>(() => formFromTask(task));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ code: string; field: string | null } | null>(null);

  const isTerminal = task.status === 'completed' || task.status === 'cancelled';
  const statusOptions = useMemo(
    () => isTerminal
      ? [task.status]
      : ['pending', 'in_progress', 'cancelled'] as TaskListItem['status'][],
    [isTerminal, task.status],
  );

  const update = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const errorMessage = error?.code === 'TASK_EDIT_STALE'
    ? t.tasks.editConflict
    : error?.code === 'TASK_EDIT_FORBIDDEN'
      ? t.tasks.editForbidden
      : error?.code === 'TASK_EDIT_LIFECYCLE_CONFLICT'
        ? t.tasks.editLifecycle
        : error?.code === 'TASK_EDIT_ASSIGNEE_INVALID'
          ? t.tasks.editAssigneeInvalid
          : error?.code === 'TASK_EDIT_LOCATION_INVALID'
            ? t.tasks.editLocationInvalid
            : error?.code === 'TASK_EDIT_INPUT_INVALID'
              ? t.tasks.editInvalid
              : t.tasks.editFailed;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || isTerminal) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/tasks', {
        method: 'PATCH',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          expectedUpdatedAt: task.updatedAt,
          patch: {
            title: form.title,
            description: form.description.trim() ? form.description : null,
            assignedEmployeeId: form.assignedEmployeeId || null,
            priority: form.priority,
            status: form.status,
            dueDate: form.dueDate || null,
            dueTime: form.dueTime || null,
            locationId: form.locationId || null,
            countRequirement: form.countRequired
              ? {
                  countRequired: true,
                  countLabel: form.countLabel,
                  unit: form.countUnit,
                  damagedQuantityRequested: form.damagedQuantityRequested,
                  allowDecimals: form.allowDecimals,
                  instructions: form.countInstructions.trim()
                    ? form.countInstructions
                    : null,
                }
              : null,
          },
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = isRecord(payload) ? payload : {};
        setError({
          code: typeof failure.code === 'string' ? failure.code : `HTTP_${response.status}`,
          field: typeof failure.field === 'string' ? failure.field : null,
        });
        return;
      }
      const updated = isRecord(payload) ? taskListItemFromPayload(payload.data) : null;
      if (!updated || updated.id !== task.id) {
        setError({ code: 'TASK_EDIT_RESPONSE_INVALID', field: null });
        return;
      }
      onUpdated(updated);
      setSaving(false);
      onClose();
      await onRefresh();
    } catch {
      setError({ code: 'TASK_EDIT_NETWORK_FAILED', field: null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="ui-overlay fixed inset-0 z-50 flex items-end justify-center p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
    >
      <section
        aria-labelledby="task-edit-title"
        aria-modal="true"
        className="ui-inverse max-h-[96dvh] w-full overflow-y-auto rounded-t-3xl border p-5 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-7"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
              {t.tasks.editEyebrow}
            </p>
            <h2 id="task-edit-title" className="mt-2 text-2xl font-black text-white">
              {t.tasks.editTitle}
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              {t.tasks.editTimezone}: {task.companyTimezone ?? 'UTC'}
            </p>
          </div>
          <button
            type="button"
            aria-label={t.tasks.editClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 text-white hover:bg-white/10"
            onClick={onClose}
            disabled={saving}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="ui-alert ui-alert-error mt-5 p-4" role="alert">
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">{errorMessage}</p>
                {error.field && (
                  <p className="mt-1 text-xs">
                    {t.tasks.editField}: {error.field}
                  </p>
                )}
              </div>
            </div>
            {error.code === 'TASK_EDIT_STALE' && (
              <button
                type="button"
                className="mt-3 min-h-11 rounded-xl bg-red-100 px-4 text-sm font-semibold text-red-950"
                onClick={() => void onRefresh()}
              >
                {t.tasks.editLoadLatest}
              </button>
            )}
          </div>
        )}

        <form className="mt-6 grid gap-5 sm:grid-cols-2" onSubmit={submit}>
          <label className="sm:col-span-2">
            <span className="text-sm font-semibold text-slate-200">{t.tasks.editTaskTitle}</span>
            <input
              required
              maxLength={300}
              value={form.title}
              onChange={(event) => update('title', event.target.value)}
              className="ui-field-light mt-2 min-h-12 w-full rounded-xl border px-4 outline-none focus:border-cyan-400"
            />
          </label>

          <label className="sm:col-span-2">
            <span className="text-sm font-semibold text-slate-200">{t.tasks.editDescription}</span>
            <textarea
              maxLength={5000}
              rows={4}
              value={form.description}
              onChange={(event) => update('description', event.target.value)}
              className="ui-field-light mt-2 w-full rounded-xl border px-4 py-3 outline-none focus:border-cyan-400"
            />
          </label>

          <label>
            <span className="text-sm font-semibold text-slate-200">{t.tasks.editAssignee}</span>
            <select
              value={form.assignedEmployeeId}
              onChange={(event) => update('assignedEmployeeId', event.target.value)}
              className="ui-field-light mt-2 min-h-12 w-full rounded-xl border px-4 outline-none focus:border-cyan-400"
            >
              <option value="">{t.tasks.unassigned}</option>
              {options.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
          </label>

          <fieldset className="space-y-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 sm:col-span-2">
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={form.countRequired}
                onChange={(event) => update('countRequired', event.target.checked)}
                className="h-5 w-5"
              />
              <span className="text-sm font-semibold text-slate-100">
                {t.evidenceC5.requireCount}
              </span>
            </label>
            {form.countRequired && <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="text-sm font-semibold text-slate-200">
                    {t.evidenceC5.countLabel}
                  </span>
                  <input
                    required
                    maxLength={120}
                    value={form.countLabel}
                    onChange={(event) => update('countLabel', event.target.value)}
                    className="ui-field-light mt-2 min-h-12 w-full rounded-xl border px-4 outline-none focus:border-cyan-400"
                  />
                </label>
                <label>
                  <span className="text-sm font-semibold text-slate-200">
                    {t.evidenceC5.unit}
                  </span>
                  <input
                    required
                    maxLength={32}
                    pattern="[a-z][a-z0-9_-]{0,31}"
                    value={form.countUnit}
                    onChange={(event) => update('countUnit', event.target.value.toLowerCase())}
                    list="task-evidence-count-units"
                    className="ui-field-light mt-2 min-h-12 w-full rounded-xl border px-4 outline-none focus:border-cyan-400"
                  />
                  <datalist id="task-evidence-count-units">
                    {['bags', 'pieces', 'boxes', 'bottles', 'kilograms', 'litres', 'trays']
                      .map((unit) => <option key={unit} value={unit} />)}
                  </datalist>
                </label>
              </div>
              <label className="block">
                <span className="text-sm font-semibold text-slate-200">
                  {t.evidenceC5.instructions}
                </span>
                <textarea
                  maxLength={1000}
                  rows={3}
                  value={form.countInstructions}
                  onChange={(event) => update('countInstructions', event.target.value)}
                  className="ui-field-light mt-2 w-full rounded-xl border px-4 py-3 outline-none focus:border-cyan-400"
                />
              </label>
              <div className="flex flex-wrap gap-5">
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={form.damagedQuantityRequested}
                    onChange={(event) => update(
                      'damagedQuantityRequested',
                      event.target.checked,
                    )}
                    className="h-5 w-5"
                  />
                  <span className="text-sm text-slate-200">
                    {t.evidenceC5.requestDamaged}
                  </span>
                </label>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={form.allowDecimals}
                    onChange={(event) => update('allowDecimals', event.target.checked)}
                    className="h-5 w-5"
                  />
                  <span className="text-sm text-slate-200">
                    {t.evidenceC5.allowDecimals}
                  </span>
                </label>
              </div>
            </>}
          </fieldset>

          <label>
            <span className="text-sm font-semibold text-slate-200">{t.tasks.editLocation}</span>
            <select
              value={form.locationId}
              onChange={(event) => update('locationId', event.target.value)}
              className="ui-field-light mt-2 min-h-12 w-full rounded-xl border px-4 outline-none focus:border-cyan-400"
            >
              <option value="">{t.tasks.editNoLocation}</option>
              {options.locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span className="text-sm font-semibold text-slate-200">{t.tasks.editPriority}</span>
            <select
              value={form.priority}
              onChange={(event) => update('priority', event.target.value as TaskListItem['priority'])}
              className="ui-field-light mt-2 min-h-12 w-full rounded-xl border px-4 outline-none focus:border-cyan-400"
            >
              {(['critical', 'high', 'medium', 'low'] as const).map((priority) => (
                <option key={priority} value={priority}>{t.priority[priority]}</option>
              ))}
            </select>
          </label>

          <label>
            <span className="text-sm font-semibold text-slate-200">{t.tasks.editStatus}</span>
            <select
              value={form.status}
              disabled={isTerminal}
              onChange={(event) => update('status', event.target.value as TaskListItem['status'])}
              className="ui-field-light mt-2 min-h-12 w-full rounded-xl border px-4 outline-none focus:border-cyan-400"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>{t.status[status]}</option>
              ))}
            </select>
          </label>

          <label>
            <span className="text-sm font-semibold text-slate-200">{t.tasks.editDueDate}</span>
            <input
              type="date"
              value={form.dueDate}
              onChange={(event) => update('dueDate', event.target.value)}
              className="ui-field-light mt-2 min-h-12 w-full rounded-xl border px-4 outline-none focus:border-cyan-400"
            />
          </label>

          <label>
            <span className="text-sm font-semibold text-slate-200">{t.tasks.editDueTime}</span>
            <input
              type="time"
              value={form.dueTime}
              disabled={!form.dueDate}
              onChange={(event) => update('dueTime', event.target.value)}
              className="ui-field-light mt-2 min-h-12 w-full rounded-xl border px-4 outline-none focus:border-cyan-400"
            />
          </label>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:col-span-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="ui-button-secondary min-h-12 px-5"
            >
              {t.tasks.editCancel}
            </button>
            <button
              type="submit"
              disabled={saving || isTerminal}
              className="ui-button-primary min-h-12 px-5"
            >
              {saving ? t.tasks.editSaving : t.tasks.editSave}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
