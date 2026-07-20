'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AlertCircle, Plus, RefreshCw, X } from 'lucide-react';
import {
  ClientApiError,
  fetchJsonCollection,
  isRecord,
  logRouteDiagnostic,
  stringField,
  userFacingRouteError,
} from '@/lib/client-api';

interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: string;
  publishedAt: string;
  expiresAt?: string;
  creatorName?: string;
}

type AnnouncementForm = {
  title: string;
  content: string;
  priority: string;
  expiresAt: string;
};

const emptyForm = (): AnnouncementForm => ({ title: '', content: '', priority: 'normal', expiresAt: '' });

function normalizeAnnouncement(value: unknown): Announcement | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, 'id');
  if (!id) return null;
  const creator = Array.isArray(value.created_by) ? value.created_by[0] : value.created_by;
  return {
    id,
    title: stringField(value, 'title') || 'Untitled announcement',
    content: stringField(value, 'content'),
    priority: stringField(value, 'priority') || 'normal',
    publishedAt: stringField(value, 'published_at') || stringField(value, 'created_at'),
    expiresAt: stringField(value, 'expires_at') || undefined,
    creatorName: isRecord(creator) ? stringField(creator, 'full_name') || undefined : undefined,
  };
}

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authorizationError, setAuthorizationError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<AnnouncementForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadAnnouncements = useCallback(async (signal?: AbortSignal) => {
    const controller = signal ? null : new AbortController();
    setLoading(true);
    setError(null);
    setAuthorizationError(false);
    try {
      const data = await fetchJsonCollection('Announcements', '/api/announcements', signal ?? controller!.signal);
      setAnnouncements(data.map(normalizeAnnouncement).filter((item): item is Announcement => item !== null));
    } catch (loadError) {
      if (signal?.aborted || controller?.signal.aborted) return;
      logRouteDiagnostic('Announcements', loadError);
      const status = loadError instanceof ClientApiError ? loadError.diagnostic.status : undefined;
      setAuthorizationError(status === 401 || status === 403);
      setAnnouncements([]);
      setError(userFacingRouteError(loadError));
    } finally {
      if (!signal?.aborted && !controller?.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadAnnouncements(controller.signal));
    return () => controller.abort();
  }, [loadAnnouncements]);

  async function submitAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/announcements', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'create', data: form }),
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) throw new Error('The server returned an invalid response.');
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'Announcement creation failed.';
        throw new Error(message);
      }
      const created = normalizeAnnouncement(payload);
      if (!created) throw new Error('The server returned an invalid announcement.');
      setAnnouncements((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setForm(emptyForm());
      setCreating(false);
      setSuccess('Announcement published successfully.');
      await loadAnnouncements();
    } catch (creationError) {
      setSubmitError(creationError instanceof Error ? creationError.message : 'Announcement creation failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const priorityStyle = (priority: string) => priority === 'urgent'
    ? 'border-red-500 bg-red-50'
    : priority === 'high' ? 'border-orange-500 bg-orange-50'
      : priority === 'normal' ? 'border-blue-500 bg-blue-50' : 'border-gray-500 bg-gray-50';

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div><h1 className="text-3xl font-bold text-gray-900">Announcements</h1><p className="mt-2 text-gray-600">Live company announcements and updates</p></div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button type="button" onClick={() => void loadAnnouncements()} disabled={loading} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 font-semibold text-gray-900 disabled:opacity-60 sm:flex-none"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          <button type="button" onClick={() => { setCreating(true); setSubmitError(null); setSuccess(null); }} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-700 sm:flex-none"><Plus className="h-4 w-4" />New announcement</button>
        </div>
      </div>

      {success && <div className="rounded-xl border border-green-300 bg-green-50 p-4 text-green-900" role="status">{success}</div>}
      {loading && announcements.length === 0 && <div className="space-y-3" role="status" aria-label="Loading announcements">{[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl bg-white/60" />)}</div>}
      {!loading && error && <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-6 text-center text-red-100" role="alert"><AlertCircle className="mx-auto h-6 w-6" /><p className="mt-2">{error}</p>{!authorizationError && <button type="button" onClick={() => void loadAnnouncements()} className="mt-4 min-h-11 rounded-lg bg-white px-4 font-semibold text-slate-900">Try again</button>}</div>}
      {!loading && !error && announcements.length === 0 && <div className="rounded-xl bg-white p-8 text-center text-gray-600">No announcements have been published for this company.</div>}

      {!error && announcements.length > 0 && <div className="space-y-4">{announcements.map((announcement) => <article key={announcement.id} className={`rounded-lg border-l-4 p-4 shadow sm:p-6 ${priorityStyle(announcement.priority)}`}><div className="flex flex-col items-start justify-between gap-3 sm:flex-row"><div className="min-w-0 flex-1"><h2 className="break-words text-lg font-bold text-gray-900">{announcement.title}</h2><p className="mt-1 text-sm text-gray-600">Posted by {announcement.creatorName || 'Company administrator'}{announcement.publishedAt ? ` on ${new Date(announcement.publishedAt).toLocaleDateString()}` : ''}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-800">{announcement.priority}</span></div><p className="mt-3 whitespace-pre-wrap break-words text-gray-700">{announcement.content}</p>{announcement.expiresAt && <p className="mt-3 text-xs text-gray-500">Expires: {new Date(announcement.expiresAt).toLocaleDateString()}</p>}</article>)}</div>}

      {creating && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="announcement-form-title"><div className="max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-xl sm:rounded-2xl sm:p-6"><div className="flex items-center justify-between"><h2 id="announcement-form-title" className="text-xl font-bold text-gray-950">New announcement</h2><button type="button" aria-label="Close announcement form" onClick={() => setCreating(false)} className="flex h-11 w-11 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>
        <form onSubmit={submitAnnouncement} className="mt-5 space-y-4">
          <label className="block text-sm font-semibold text-gray-900">Title<input required maxLength={200} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base" /></label>
          <label className="block text-sm font-semibold text-gray-900">Message<textarea required maxLength={10000} rows={6} value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-base" /></label>
          <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold text-gray-900">Priority<select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base">{['low', 'normal', 'high', 'urgent'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label><label className="block text-sm font-semibold text-gray-900">Expires (optional)<input type="datetime-local" value={form.expiresAt} onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base" /></label></div>
          {submitError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{submitError}</div>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setCreating(false)} disabled={submitting} className="min-h-11 rounded-lg border border-gray-300 px-4 font-semibold text-gray-900">Cancel</button><button type="submit" disabled={submitting} className="min-h-11 rounded-lg bg-indigo-600 px-5 font-semibold text-white disabled:opacity-60">{submitting ? 'Publishing…' : 'Publish announcement'}</button></div>
        </form></div></div>}
    </div>
  );
}
