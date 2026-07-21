'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, Paperclip, RefreshCw, Upload, X } from 'lucide-react';
import Image from 'next/image';
import { fetchJsonCollection, isRecord, stringField } from '@/lib/client-api';
import { TASK_EVIDENCE_MAX_BYTES, TASK_EVIDENCE_MIME_TYPES, type TaskEvidenceSourceType } from '@/lib/task-evidence';
import { useLocale } from '@/components/LocaleProvider';

type TaskOption = { id: string; title: string; status: string };
type SelectedEvidence = { file: File; sourceType: TaskEvidenceSourceType; previewUrl: string; idempotencyKey: string };

function taskOption(value: unknown): TaskOption | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, 'id');
  const title = stringField(value, 'title');
  return id && title ? { id, title, status: stringField(value, 'status') } : null;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function uploadSignedObject(file: File, path: string, token: string, onProgress: (progress: number) => void, errors: { storage: string; upload: string; secure: string }): Promise<void> {
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
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onerror = () => reject(new Error(errors.upload));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(errors.secure));
    const body = new FormData();
    body.append('cacheControl', '3600');
    body.append('', file);
    xhr.send(body);
  });
}

export function TaskEvidenceAttachment({ disabled, onUploaded }: { disabled: boolean; onUploaded: (taskTitle: string) => void }) {
  const { language, messages: t } = useLocale();
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [taskId, setTaskId] = useState('');
  const [selected, setSelected] = useState<SelectedEvidence | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === taskId), [taskId, tasks]);

  useEffect(() => () => { if (selected) URL.revokeObjectURL(selected.previewUrl); }, [selected]);

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

  function chooseFile(event: ChangeEvent<HTMLInputElement>, sourceType: TaskEvidenceSourceType) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!TASK_EVIDENCE_MIME_TYPES.some((mime) => mime === file.type) || file.size <= 0 || file.size > TASK_EVIDENCE_MAX_BYTES) {
      setError(t.evidence.invalidFile);
      return;
    }
    if (selected) URL.revokeObjectURL(selected.previewUrl);
    setSelected({ file, sourceType, previewUrl: URL.createObjectURL(file), idempotencyKey: crypto.randomUUID() });
    setError(null);
    setProgress(0);
  }

  function resetAndClose() {
    if (selected) URL.revokeObjectURL(selected.previewUrl);
    setSelected(null);
    setTaskId('');
    setProgress(0);
    setError(null);
    setOpen(false);
  }

  async function confirmUpload() {
    if (!selected || !taskId || uploading) return;
    setUploading(true);
    setProgress(0);
    setError(null);
    try {
      const hash = await sha256(selected.file);
      const prepareResponse = await fetch('/api/task-evidence', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ taskId, locationId: null, sourceType: selected.sourceType, mimeType: selected.file.type, sizeBytes: selected.file.size, sha256: hash, idempotencyKey: selected.idempotencyKey }),
      });
      const prepared: unknown = await prepareResponse.json();
      if (!prepareResponse.ok || !isRecord(prepared) || typeof prepared.evidenceId !== 'string') throw new Error(t.evidence.prepareFailed);
      if (prepared.status !== 'pending_review') {
        if (prepared.status !== 'uploaded_pending_completion') {
          if (!isRecord(prepared.upload) || typeof prepared.upload.path !== 'string' || typeof prepared.upload.token !== 'string') throw new Error(t.evidence.prepareFailed);
          await uploadSignedObject(selected.file, prepared.upload.path, prepared.upload.token, setProgress, {
            storage: t.evidence.storageUnavailable,
            upload: t.evidence.uploadFailed,
            secure: t.evidence.secureUploadFailed,
          });
          setProgress(100);
        }
        const completeResponse = await fetch(`/api/task-evidence/${prepared.evidenceId}/complete`, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const completed: unknown = await completeResponse.json();
        if (!completeResponse.ok || !isRecord(completed) || !['pending_review', 'queued'].includes(String(completed.status))) throw new Error(t.evidence.finalizeFailed);
      }
      const taskTitle = selectedTask?.title ?? 'task';
      resetAndClose();
      onUploaded(taskTitle);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t.evidence.uploadFailed);
    } finally {
      setUploading(false);
    }
  }

  return <>
    <button type="button" onClick={() => void showPicker()} disabled={disabled} aria-label={t.evidence.attach} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-slate-900/50 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"><Paperclip className="h-5 w-5" /></button>
    <input ref={cameraInput} className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => chooseFile(event, 'mobile_camera')} />
    <input ref={galleryInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => chooseFile(event, 'gallery_upload')} />
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="evidence-title"><div lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} className="max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl bg-slate-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white shadow-2xl sm:max-w-lg sm:rounded-2xl sm:p-6"><div className="flex items-center justify-between"><h2 id="evidence-title" className="text-xl font-bold">{t.evidence.attach}</h2><button type="button" onClick={resetAndClose} disabled={uploading} aria-label={t.evidence.close} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10"><X className="h-5 w-5" /></button></div>
      <p className="mt-2 text-sm text-slate-400">{t.evidence.privacy}</p>
      <div className="mt-5 space-y-4">
        {loadingTasks ? <p role="status" className="text-sm text-slate-300">{t.evidence.loadingTasks}</p> : tasksLoaded && tasks.length === 0 ? <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">{t.evidence.noActiveTasks}</p> : <label className="block text-sm font-semibold">{t.evidence.task}<select value={taskId} onChange={(event) => setTaskId(event.target.value)} disabled={uploading || tasks.length === 0} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-base"><option value="">{t.evidence.selectTask}</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title} ({t.status[task.status as 'pending' | 'in_progress']})</option>)}</select></label>}
        {!selected ? <><div className="grid grid-cols-2 gap-3"><button type="button" disabled={tasks.length === 0} onClick={() => cameraInput.current?.click()} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 text-cyan-200 disabled:opacity-50"><Camera className="h-6 w-6" />{t.evidence.takePhoto}</button><button type="button" disabled={tasks.length === 0} onClick={() => galleryInput.current?.click()} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-3 text-slate-200 disabled:opacity-50"><ImagePlus className="h-6 w-6" />{t.evidence.chooseGallery}</button></div><p className="text-xs text-slate-500">{t.evidence.cameraHelp} {t.evidence.galleryHelp}</p></> : <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-black"><Image unoptimized src={selected.previewUrl} alt={t.evidence.preview} width={768} height={576} className="max-h-72 w-full object-contain" /><button type="button" onClick={() => { URL.revokeObjectURL(selected.previewUrl); setSelected(null); setProgress(0); }} disabled={uploading} className="absolute end-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/70" aria-label={t.evidence.remove}><X className="h-5 w-5" /></button></div>}
        {uploading && <div aria-label={t.evidence.progress}><div className="mb-1 flex justify-between text-sm text-slate-300"><span>{progress > 0 ? t.evidence.uploading : t.evidence.preparing}</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-cyan-500 transition-[width]" style={{ width: `${progress}%` }} /></div></div>}
        <p className="text-xs text-slate-500">{t.evidence.queuedReview}</p>
        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" role="alert">{error}</div>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={resetAndClose} disabled={uploading} className="min-h-11 rounded-lg border border-slate-600 px-4 font-semibold">{t.evidence.cancel}</button><button type="button" onClick={() => void confirmUpload()} disabled={!selected || !taskId || uploading || tasks.length === 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 font-semibold disabled:opacity-50">{uploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{t.evidence.confirm}</button></div>
      </div></div></div>}
  </>;
}
