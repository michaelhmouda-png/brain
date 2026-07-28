'use client';

import Image from 'next/image';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ImagePlus,
  Paperclip,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { fetchJsonCollection, isRecord, stringField } from '@/lib/client-api';
import {
  TASK_EVIDENCE_MAX_BYTES,
  TASK_EVIDENCE_MIME_TYPES,
  type TaskEvidenceSourceType,
} from '@/lib/task-evidence';
import {
  TASK_EVIDENCE_MAX_ITEMS,
  TASK_EVIDENCE_MAX_TOTAL_BYTES,
  type TaskEvidenceCountRequirement,
} from '@/lib/task-evidence-submission';

type TaskOption = {
  id: string;
  displayTitle: string | null;
  translationState: 'not_required' | 'ready' | 'pending' | 'failed';
  status: string;
  countRequirement: TaskEvidenceCountRequirement | null;
};

type SelectedEvidence = {
  itemId: string;
  file: File;
  sourceType: TaskEvidenceSourceType;
  previewUrl: string;
  sha256: string | null;
  status: 'selected' | 'hashing' | 'uploading' | 'verified' | 'failed';
  progress: number;
};

type PreparedUpload = {
  itemId: string;
  status: string;
  upload: { path: string; token: string } | null;
};

function taskOption(value: unknown): TaskOption | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, 'id');
  const displayTitle = typeof value.displayTitle === 'string' ? value.displayTitle : null;
  const translationState = ['not_required', 'ready', 'pending', 'failed'].includes(
    String(value.translationState),
  )
    ? value.translationState as TaskOption['translationState']
    : 'pending';
  const countRequirement = isRecord(value.countRequirement)
    ? value.countRequirement as unknown as TaskEvidenceCountRequirement
    : null;
  return id
    ? {
        id,
        displayTitle,
        translationState,
        status: stringField(value, 'status'),
        countRequirement,
      }
    : null;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function uploadSignedObject(
  file: File,
  path: string,
  token: string,
  onProgress: (progress: number) => void,
  errors: { storage: string; upload: string; secure: string },
): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !publishableKey) return Promise.reject(new Error(errors.storage));
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `${baseUrl}/storage/v1/object/upload/sign/task-evidence/${encodedPath}?token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('apikey', publishableKey);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error(errors.upload));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(errors.secure));
    };
    const body = new FormData();
    body.append('cacheControl', '3600');
    body.append('', file);
    xhr.send(body);
  });
}

function sourceFor(items: SelectedEvidence[]) {
  const values = new Set(items.map((item) => item.sourceType));
  return values.size > 1 ? 'mixed_capture' : items[0]?.sourceType ?? 'gallery_upload';
}

export function TaskEvidenceAttachment({
  disabled,
  onUploaded,
}: {
  disabled: boolean;
  onUploaded: (taskTitle: string) => void;
}) {
  const { language, messages: t } = useLocale();
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<SelectedEvidence[]>([]);
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [taskId, setTaskId] = useState('');
  const [selected, setSelected] = useState<SelectedEvidence[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [quantity, setQuantity] = useState('');
  const [damagedQuantity, setDamagedQuantity] = useState('');
  const [locationDetails, setLocationDetails] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === taskId),
    [taskId, tasks],
  );
  const requirement = selectedTask?.countRequirement ?? null;
  const overallProgress = selected.length === 0
    ? 0
    : Math.round(selected.reduce((sum, item) => sum + item.progress, 0) / selected.length);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(
    () => () => selectedRef.current.forEach(
      (item) => URL.revokeObjectURL(item.previewUrl),
    ),
    [],
  );

  async function showPicker() {
    setOpen(true);
    setError(null);
    if (tasksLoaded) return;
    setLoadingTasks(true);
    const controller = new AbortController();
    try {
      const values = await fetchJsonCollection('Task evidence', '/api/tasks', controller.signal);
      setTasks(values.map(taskOption).filter((task): task is TaskOption =>
        task !== null && (task.status === 'pending' || task.status === 'in_progress')));
      setTasksLoaded(true);
    } catch {
      setError(t.evidence.tasksFailed);
    } finally {
      setLoadingTasks(false);
    }
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>, sourceType: TaskEvidenceSourceType) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    if (selected.length + files.length > TASK_EVIDENCE_MAX_ITEMS) {
      setError(t.evidenceC5.tooManyPhotos);
      return;
    }
    if (
      files.some((file) =>
        !TASK_EVIDENCE_MIME_TYPES.some((mime) => mime === file.type)
        || file.size <= 0
        || file.size > TASK_EVIDENCE_MAX_BYTES)
    ) {
      setError(t.evidence.invalidFile);
      return;
    }
    const total = [...selected.map((item) => item.file), ...files]
      .reduce((sum, file) => sum + file.size, 0);
    if (total > TASK_EVIDENCE_MAX_TOTAL_BYTES) {
      setError(t.evidenceC5.totalTooLarge);
      return;
    }
    setSelected((current) => [
      ...current,
      ...files.map((file) => ({
        itemId: crypto.randomUUID(),
        file,
        sourceType,
        previewUrl: URL.createObjectURL(file),
        sha256: null,
        status: 'selected' as const,
        progress: 0,
      })),
    ]);
    setError(null);
  }

  function removeItem(itemId: string) {
    setSelected((current) => {
      const target = current.find((item) => item.itemId === itemId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.itemId !== itemId);
    });
    setError(null);
  }

  function moveItem(index: number, direction: -1 | 1) {
    setSelected((current) => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  function resetAndClose() {
    selected.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setSelected([]);
    setTaskId('');
    setQuantity('');
    setDamagedQuantity('');
    setLocationDetails('');
    setNotes('');
    setSubmissionId(null);
    setIdempotencyKey(crypto.randomUUID());
    setError(null);
    setOpen(false);
  }

  function updateItem(itemId: string, patch: Partial<SelectedEvidence>) {
    setSelected((current) => current.map((item) =>
      item.itemId === itemId ? { ...item, ...patch } : item));
  }

  function countPayload() {
    if (!requirement) return null;
    const parsedQuantity = Number(quantity);
    const parsedDamaged = damagedQuantity === '' ? null : Number(damagedQuantity);
    if (
      quantity === ''
      || !Number.isFinite(parsedQuantity)
      || parsedQuantity < 0
      || (!requirement.allowDecimals && !Number.isInteger(parsedQuantity))
      || (requirement.damagedQuantityRequested
        && (
          parsedDamaged === null
          || !Number.isFinite(parsedDamaged)
          || parsedDamaged < 0
          || parsedDamaged > parsedQuantity
        ))
    ) {
      throw new Error(t.evidenceC5.invalidCount);
    }
    return {
      quantity: parsedQuantity,
      unit: requirement.unit,
      damagedQuantity: requirement.damagedQuantityRequested ? parsedDamaged : null,
      locationDetails: locationDetails.trim() || null,
      notes: notes.trim() || null,
    };
  }

  async function confirmUpload() {
    if (selected.length === 0 || !taskId || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const count = countPayload();
      const hashed = [];
      const seen = new Set<string>();
      for (const item of selected) {
        updateItem(item.itemId, { status: 'hashing' });
        const hash = item.sha256 ?? await sha256(item.file);
        if (seen.has(hash)) throw new Error(t.evidenceC5.duplicatePhoto);
        seen.add(hash);
        updateItem(item.itemId, { sha256: hash, status: 'selected' });
        hashed.push({ ...item, sha256: hash });
      }

      const prepareResponse = await fetch('/api/task-evidence/submissions', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          taskId,
          locationId: null,
          sourceType: sourceFor(hashed),
          idempotencyKey,
          items: hashed.map((item, index) => ({
            itemId: item.itemId,
            ordinal: index + 1,
            sourceType: item.sourceType,
            mimeType: item.file.type,
            sizeBytes: item.file.size,
            sha256: item.sha256,
          })),
          count,
        }),
      });
      const prepared: unknown = await prepareResponse.json();
      if (
        !prepareResponse.ok
        || !isRecord(prepared)
        || typeof prepared.submissionId !== 'string'
        || !Array.isArray(prepared.items)
      ) {
        throw new Error(t.evidence.prepareFailed);
      }
      const recoveringExistingSubmission = submissionId === prepared.submissionId;
      setSubmissionId(prepared.submissionId);
      const uploads = prepared.items.filter(isRecord) as PreparedUpload[];
      for (const item of hashed) {
        const upload = uploads.find((candidate) => candidate.itemId === item.itemId);
        if (!upload) throw new Error(t.evidence.prepareFailed);
        if (upload.status !== 'verified') {
          if (!upload.upload) throw new Error(t.evidence.prepareFailed);
          let completeResponse: Response | null = null;
          if (recoveringExistingSubmission) {
            completeResponse = await fetch(
              `/api/task-evidence/submissions/${prepared.submissionId}/items/${item.itemId}/complete`,
              {
                method: 'POST',
                cache: 'no-store',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
              },
            );
          }
          if (!completeResponse?.ok) {
            updateItem(item.itemId, { status: 'uploading' });
            await uploadSignedObject(
              item.file,
              upload.upload.path,
              upload.upload.token,
              (progress) => updateItem(item.itemId, { progress }),
              {
                storage: t.evidence.storageUnavailable,
                upload: t.evidence.uploadFailed,
                secure: t.evidence.secureUploadFailed,
              },
            );
            completeResponse = await fetch(
              `/api/task-evidence/submissions/${prepared.submissionId}/items/${item.itemId}/complete`,
              {
                method: 'POST',
                cache: 'no-store',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
              },
            );
          }
          if (!completeResponse.ok) {
            updateItem(item.itemId, { status: 'failed' });
            throw new Error(`${t.evidenceC5.retryPhoto}: ${item.file.name}`);
          }
        }
        updateItem(item.itemId, { status: 'verified', progress: 100 });
      }

      const finalizeResponse = await fetch(
        `/api/task-evidence/submissions/${prepared.submissionId}/finalize`,
        {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        },
      );
      if (!finalizeResponse.ok) throw new Error(t.evidence.finalizeFailed);
      const taskTitle = selectedTask?.displayTitle ?? t.evidence.task;
      resetAndClose();
      onUploaded(taskTitle);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : t.evidenceC5.uploadInterrupted,
      );
    } finally {
      setUploading(false);
    }
  }

  return <>
    <button
      type="button"
      onClick={() => void showPicker()}
      disabled={disabled}
      aria-label={t.evidence.attach}
      className="ui-button-secondary flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg"
    >
      <Paperclip className="h-5 w-5" />
    </button>
    <input
      ref={cameraInput}
      className="sr-only"
      type="file"
      accept="image/*"
      capture="environment"
      onChange={(event) => addFiles(event, 'mobile_camera')}
    />
    <input
      ref={galleryInput}
      className="sr-only"
      type="file"
      multiple
      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
      onChange={(event) => addFiles(event, 'gallery_upload')}
    />
    {open && <div
      className="ui-overlay fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-title"
    >
      <div
        lang={language}
        dir={language === 'ar' ? 'rtl' : 'ltr'}
        className="ui-inverse max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl border p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-2xl sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-center justify-between">
          <h2 id="evidence-title" className="text-xl font-bold">{t.evidence.attach}</h2>
          <button
            type="button"
            onClick={resetAndClose}
            disabled={uploading}
            aria-label={t.evidence.close}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white text-white hover:bg-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-400">{t.evidence.privacy}</p>
        <div className="mt-5 space-y-4">
          {loadingTasks
            ? <p role="status" className="text-sm text-slate-300">{t.evidence.loadingTasks}</p>
            : tasksLoaded && tasks.length === 0
              ? <p className="ui-alert ui-alert-warning rounded-xl p-3 text-sm">{t.evidence.noActiveTasks}</p>
              : <label className="block text-sm font-semibold">
                  {t.evidence.task}
                  <select
                    value={taskId}
                    onChange={(event) => {
                      setTaskId(event.target.value);
                      setQuantity('');
                      setDamagedQuantity('');
                    }}
                    disabled={uploading || submissionId !== null || tasks.length === 0}
                    className="ui-field mt-1 min-h-11 w-full rounded-lg px-3 text-base"
                  >
                    <option value="">{t.evidence.selectTask}</option>
                    {tasks.map((task) => <option key={task.id} value={task.id}>
                      {task.displayTitle ?? t.tasks.translationPending}
                      {' '}({t.status[task.status as 'pending' | 'in_progress']})
                    </option>)}
                  </select>
                </label>}

          {requirement && <fieldset className="space-y-3 rounded-xl border border-white bg-black p-4">
            <legend className="px-1 text-sm font-semibold">{t.evidenceC5.instructions}</legend>
            <p className="font-medium">{requirement.countLabel}</p>
            {requirement.instructions && <p className="text-sm text-slate-300">{requirement.instructions}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">{t.evidenceC5.count}
                <input
                  type="number"
                  min="0"
                  step={requirement.allowDecimals ? '0.001' : '1'}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  disabled={uploading || submissionId !== null}
                  className="ui-field mt-1 min-h-11 w-full rounded-lg px-3 text-base"
                  required
                />
              </label>
              <label className="text-sm">{t.evidenceC5.unit}
                <input
                  value={requirement.unit}
                  readOnly
                  className="ui-field mt-1 min-h-11 w-full rounded-lg px-3 text-base"
                />
              </label>
              {requirement.damagedQuantityRequested && <label className="text-sm">
                {t.evidenceC5.damaged}
                <input
                  type="number"
                  min="0"
                  step={requirement.allowDecimals ? '0.001' : '1'}
                  value={damagedQuantity}
                  onChange={(event) => setDamagedQuantity(event.target.value)}
                  disabled={uploading || submissionId !== null}
                  className="ui-field mt-1 min-h-11 w-full rounded-lg px-3 text-base"
                  required
                />
              </label>}
              <label className="text-sm">{t.evidenceC5.details}
                <input
                  value={locationDetails}
                  maxLength={500}
                  onChange={(event) => setLocationDetails(event.target.value)}
                  disabled={uploading || submissionId !== null}
                  className="ui-field mt-1 min-h-11 w-full rounded-lg px-3 text-base"
                />
              </label>
            </div>
            <label className="block text-sm">{t.evidenceC5.notes}
              <textarea
                value={notes}
                maxLength={1000}
                onChange={(event) => setNotes(event.target.value)}
                disabled={uploading || submissionId !== null}
                className="ui-field mt-1 min-h-20 w-full rounded-lg p-3 text-base"
              />
            </label>
          </fieldset>}

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={
                tasks.length === 0
                || uploading
                || submissionId !== null
                || selected.length >= TASK_EVIDENCE_MAX_ITEMS
              }
              onClick={() => cameraInput.current?.click()}
              className="ui-button-primary flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl px-3"
            >
              <Camera className="h-6 w-6" />
              {selected.length ? t.evidenceC5.addPhotos : t.evidence.takePhoto}
            </button>
            <button
              type="button"
              disabled={
                tasks.length === 0
                || uploading
                || submissionId !== null
                || selected.length >= TASK_EVIDENCE_MAX_ITEMS
              }
              onClick={() => galleryInput.current?.click()}
              className="ui-button-secondary flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl px-3"
            >
              <ImagePlus className="h-6 w-6" />
              {t.evidence.chooseGallery}
            </button>
          </div>

          {selected.length > 0 && <div className="grid gap-3 sm:grid-cols-2">
            {selected.map((item, index) => <article
              key={item.itemId}
              className="overflow-hidden rounded-xl border border-slate-700 bg-black"
            >
              <div className="relative">
                <Image
                  unoptimized
                  src={item.previewUrl}
                  alt={t.evidence.preview}
                  width={768}
                  height={576}
                  className="h-44 w-full object-contain"
                />
                <button
                  type="button"
                  onClick={() => removeItem(item.itemId)}
                  disabled={uploading || submissionId !== null || item.status === 'verified'}
                  className="absolute end-2 top-2 flex h-11 w-11 items-center justify-center rounded-full border border-white bg-black text-white"
                  aria-label={t.evidence.remove}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-2 p-3">
                <p className="truncate text-sm">
                  {t.evidenceC5.photoOf
                    .replace('{current}', String(index + 1))
                    .replace('{total}', String(selected.length))}
                  {' · '}{item.file.name}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => moveItem(index, -1)}
                    disabled={uploading || submissionId !== null || index === 0}
                    className="ui-button-secondary flex h-11 w-11 items-center justify-center rounded-lg p-0"
                    aria-label="Move photo earlier"
                  >
                    {language === 'ar' ? <ArrowRight /> : <ArrowLeft />}
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(index, 1)}
                    disabled={
                      uploading
                      || submissionId !== null
                      || index === selected.length - 1
                    }
                    className="ui-button-secondary flex h-11 w-11 items-center justify-center rounded-lg p-0"
                    aria-label="Move photo later"
                  >
                    {language === 'ar' ? <ArrowLeft /> : <ArrowRight />}
                  </button>
                </div>
                {(uploading || item.status === 'failed') && <div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full ${item.status === 'failed' ? 'bg-red-500' : 'bg-cyan-500'}`}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {item.status === 'failed' ? t.evidenceC5.retryPhoto : `${item.progress}%`}
                  </p>
                </div>}
              </div>
            </article>)}
          </div>}

          {uploading && <div aria-label={t.evidenceC5.overallProgress}>
            <div className="mb-1 flex justify-between text-sm text-slate-300">
              <span>{t.evidenceC5.overallProgress}</span>
              <span>{overallProgress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-cyan-500 transition-[width]"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>}

          <p className="text-xs text-slate-500">{t.evidence.queuedReview}</p>
          {submissionId && error && <p className="ui-alert ui-alert-warning rounded-xl p-3 text-xs">
            {t.evidenceC5.uploadInterrupted}
          </p>}
          {error && <div
            className="ui-alert ui-alert-error text-sm"
            role="alert"
          >
            {error}
          </div>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={resetAndClose}
              disabled={uploading}
              className="ui-button-secondary"
            >
              {t.evidence.cancel}
            </button>
            <button
              type="button"
              onClick={() => void confirmUpload()}
              disabled={
                selected.length === 0
                || !taskId
                || uploading
                || tasks.length === 0
                || (requirement !== null && quantity === '')
              }
              className="ui-button-primary"
            >
              {uploading
                ? <RefreshCw className="h-4 w-4 animate-spin" />
                : <Upload className="h-4 w-4" />}
              {t.evidence.confirm}
            </button>
          </div>
        </div>
      </div>
    </div>}
  </>;
}
