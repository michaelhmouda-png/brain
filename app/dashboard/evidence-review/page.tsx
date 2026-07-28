'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/components/LocaleProvider';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';

type Evidence = Record<string, unknown> & { evidence_id: string; evidence_status: string; task_title: string };
type SubmissionItem = { itemId: string; ordinal: number; mimeType: string };

const evidenceTone: Record<string, StatusTone> = {
  pending_upload: 'pending',
  pending_review: 'pending',
  queued: 'pending',
  processing: 'processing',
  ai_verified: 'info',
  ai_rejected: 'warning',
  needs_human_review: 'review',
  verification_failed: 'failed',
  human_approved: 'approved',
  human_rejected: 'rejected',
};

function submissionItems(row: Evidence): SubmissionItem[] {
  const context = row.submission_context;
  if (typeof context !== 'object' || context === null || Array.isArray(context)) return [];
  const items = (context as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (
      typeof item !== 'object'
      || item === null
      || Array.isArray(item)
      || typeof item.itemId !== 'string'
      || typeof item.ordinal !== 'number'
      || typeof item.mimeType !== 'string'
    ) {
      return [];
    }
    return [{ itemId: item.itemId, ordinal: item.ordinal, mimeType: item.mimeType }];
  });
}

function contextRecord(row: Evidence, key: string): Record<string, unknown> | null {
  if (
    typeof row.submission_context !== 'object'
    || row.submission_context === null
    || Array.isArray(row.submission_context)
  ) return null;
  const value = (row.submission_context as Record<string, unknown>)[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function evidenceRows(value: unknown): Evidence[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('evidence' in value) || !Array.isArray(value.evidence)) return [];
  return value.evidence.filter((row): row is Evidence => typeof row === 'object' && row !== null &&
    typeof row.evidence_id === 'string' && typeof row.evidence_status === 'string' && typeof row.task_title === 'string');
}

export default function EvidenceReviewPage() {
  const { messages: t } = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{ id: string; decision: 'approved' | 'rejected' } | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/task-evidence/reviews', { cache: 'no-store', credentials: 'same-origin' });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error('Evidence reviews could not be loaded.');
      setRows(evidenceRows(data));
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Evidence reviews could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/task-evidence/reviews', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        const data: unknown = await response.json();
        if (!response.ok) throw new Error('Evidence reviews could not be loaded.');
        setRows(evidenceRows(data));
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Evidence reviews could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function showImage(id: string, itemId: string) {
    const accessPath = itemId === id
      ? `/api/task-evidence/${id}/access`
      : `/api/task-evidence/${id}/access?itemId=${encodeURIComponent(itemId)}`;
    const response = await fetch(accessPath, { cache: 'no-store', credentials: 'same-origin' });
    const data: unknown = await response.json();
    if (!response.ok || typeof data !== 'object' || data === null || !('signedUrl' in data) || typeof data.signedUrl !== 'string') { setError('The private image is temporarily unavailable.'); return; }
    setUrls((current) => ({ ...current, [`${id}:${itemId}`]: data.signedUrl as string }));
  }

  async function review() {
    if (!confirming || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/task-evidence/${confirming.id}/review`, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: confirming.decision, note, confirm: true }) });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
          ? data.error
          : 'The review could not be saved. Please retry.';
        setError(message);
        return;
      }
      setConfirming(null);
      setNote('');
      await load();
      router.refresh();
    } catch {
      setError('The review could not be saved. Please retry.');
    } finally {
      setSaving(false);
    }
  }

  async function retryVerification(id: string) {
    const response = await fetch(`/api/task-evidence/${id}/verification`, { method: 'POST', cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) { setError('AI analysis could not be queued again.'); return; }
    await load();
  }

  return <main className="space-y-5 text-black"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Evidence review</h1><p className="text-sm text-zinc-800">AI results support a human decision. Manager approval completes the linked active task; AI verification alone never changes task status.</p></div><button onClick={() => void load()} className="ui-button-secondary min-h-11 rounded-xl px-4">Refresh</button></div>
    {loading && <p className="text-slate-300">Loading evidence…</p>}{error && <div role="alert" className="ui-alert ui-alert-error">{error} <button onClick={() => void load()} className="ui-link ms-2 min-h-11 underline">Retry</button></div>}
    {!loading && !error && rows.length === 0 && <div className="rounded-2xl border border-black bg-white p-6 text-zinc-800">No evidence is awaiting or has completed review.</div>}
    <div className="grid gap-4 xl:grid-cols-2">{rows.map((row) => { const observations = Array.isArray(row.visible_observations) ? row.visible_observations.filter((item): item is string => typeof item === 'string') : []; const codes = Array.isArray(row.reason_codes) ? row.reason_codes.filter((item): item is string => typeof item === 'string') : []; const evidenceLabel = t.evidenceState[row.evidence_status as keyof typeof t.evidenceState] ?? t.evidenceState.pending_review; const items = submissionItems(row); const requirement = contextRecord(row, 'countRequirement'); const submittedCount = contextRecord(row, 'submittedCount'); const setResult = contextRecord(row, 'setResult'); return <article key={row.evidence_id} className="overflow-hidden rounded-2xl border border-black bg-white p-4 text-black"><div className="flex justify-between gap-3"><div><h2 className="font-semibold">{typeof row.displayTitle === 'string' ? row.displayTitle : row.task_title}</h2><p className="text-xs text-zinc-700">Submitted by {typeof row.submitter_name === 'string' ? row.submitter_name : 'Team member'}</p></div><StatusBadge className="h-fit" label={evidenceLabel} tone={evidenceTone[row.evidence_status] ?? 'info'} /></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{items.map((item) => { const key = `${row.evidence_id}:${item.itemId}`; return <div key={item.itemId} className="ui-inverse overflow-hidden rounded-xl border">{urls[key] ? <Image unoptimized src={urls[key]} alt={`Private task evidence photo ${item.ordinal}`} width={800} height={600} className="max-h-72 w-full object-contain" /> : <button onClick={() => void showImage(row.evidence_id, item.itemId)} className="min-h-28 w-full px-3 text-sm">{t.evidenceC5.photoOf.replace('{current}', String(item.ordinal)).replace('{total}', String(items.length))}<br />Load private image</button>}</div>; })}</div>
      {requirement && submittedCount && <div className="mt-3 rounded-xl border border-black bg-white p-3 text-sm text-black"><p className="font-semibold">{String(requirement.countLabel ?? t.evidenceC5.count)}</p><dl className="mt-2 grid grid-cols-2 gap-2"><div><dt className="text-slate-700">{t.evidenceC5.count}</dt><dd>{String(submittedCount.quantity)} {String(submittedCount.unit)}</dd></div>{submittedCount.damagedQuantity !== null && <div><dt className="text-slate-700">{t.evidenceC5.damaged}</dt><dd>{String(submittedCount.damagedQuantity)}</dd></div>}<div><dt className="text-slate-700">{t.evidenceC5.details}</dt><dd>{String(submittedCount.locationDetails ?? '—')}</dd></div><div><dt className="text-slate-700">{t.evidenceC5.notes}</dt><dd>{String(submittedCount.notes ?? '—')}</dd></div></dl>{setResult && <p className="mt-2 text-black">AI observed: {String(setResult.observedQuantity ?? 'unknown')} · {String(setResult.countComparison ?? 'cannot_verify')}</p>}</div>}
      <div className="mt-3 space-y-2 text-sm text-black"><p><span className="text-slate-700">AI verdict:</span> {typeof row.ai_verdict === 'string' ? row.ai_verdict : 'Not available'}</p><p><span className="text-slate-700">Confidence:</span> {typeof row.confidence === 'number' ? `${Math.round(row.confidence * 100)}%` : '—'}</p><p>{typeof row.explanation === 'string' ? row.explanation : 'Analysis has not completed.'}</p>{observations.length > 0 && <ul className="list-disc pl-5 text-slate-800">{observations.map((item) => <li key={item}>{item}</li>)}</ul>}{codes.length > 0 && <p className="text-xs text-black">{codes.join(' · ')}</p>}<p className="text-xs text-slate-700">Attempts: {Array.isArray(row.attempts) ? row.attempts.length : 0} · Audit events: {Array.isArray(row.audit_history) ? row.audit_history.length : 0}</p></div>
      {row.evidence_status === 'verification_failed' && <button onClick={() => void retryVerification(row.evidence_id)} className="ui-button-secondary mt-4 w-full">Retry AI analysis</button>}
      {['ai_verified','ai_rejected','needs_human_review','verification_failed'].includes(row.evidence_status) && <div className="mt-2 grid grid-cols-2 gap-2"><button onClick={() => setConfirming({ id: row.evidence_id, decision: 'rejected' })} className="ui-button-destructive">Reject</button><button onClick={() => setConfirming({ id: row.evidence_id, decision: 'approved' })} className="ui-button-primary">Approve</button></div>}
    </article>; })}</div>
    {confirming && <div className="ui-overlay fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true"><div className="ui-inverse w-full rounded-t-3xl border p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-2xl"><h2 className="text-lg font-bold">Confirm {confirming.decision}</h2><p className="mt-2 text-sm text-slate-300">{confirming.decision === 'approved' ? 'Approve evidence and complete this task?' : 'Reject evidence and leave this task unchanged?'}</p><label className="mt-4 block text-sm">Optional note<textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} className="ui-field mt-1 min-h-24 w-full rounded-xl p-3 text-base" /></label><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={saving} onClick={() => setConfirming(null)} className="ui-button-secondary">Cancel</button><button disabled={saving} onClick={() => void review()} className="ui-button-primary">{saving ? 'Saving…' : 'Confirm'}</button></div></div></div>}
  </main>;
}
