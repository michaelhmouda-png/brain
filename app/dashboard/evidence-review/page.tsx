'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';

type Evidence = Record<string, unknown> & { evidence_id: string; evidence_status: string; task_title: string };

function evidenceRows(value: unknown): Evidence[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('evidence' in value) || !Array.isArray(value.evidence)) return [];
  return value.evidence.filter((row): row is Evidence => typeof row === 'object' && row !== null &&
    typeof row.evidence_id === 'string' && typeof row.evidence_status === 'string' && typeof row.task_title === 'string');
}

export default function EvidenceReviewPage() {
  const [rows, setRows] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{ id: string; decision: 'approved' | 'rejected' } | null>(null);
  const [note, setNote] = useState('');

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

  async function showImage(id: string) {
    const response = await fetch(`/api/task-evidence/${id}/access`, { cache: 'no-store', credentials: 'same-origin' });
    const data: unknown = await response.json();
    if (!response.ok || typeof data !== 'object' || data === null || !('signedUrl' in data) || typeof data.signedUrl !== 'string') { setError('The private image is temporarily unavailable.'); return; }
    setUrls((current) => ({ ...current, [id]: data.signedUrl as string }));
  }

  async function review() {
    if (!confirming) return;
    const response = await fetch(`/api/task-evidence/${confirming.id}/review`, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: confirming.decision, note, confirm: true }) });
    if (!response.ok) { setError('The review could not be saved. Please retry.'); return; }
    setConfirming(null); setNote(''); await load();
  }

  async function retryVerification(id: string) {
    const response = await fetch(`/api/task-evidence/${id}/verification`, { method: 'POST', cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) { setError('AI analysis could not be queued again.'); return; }
    await load();
  }

  return <main className="space-y-5 text-white"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Evidence review</h1><p className="text-sm text-slate-400">AI results support a human decision. Reviews never change task status.</p></div><button onClick={() => void load()} className="min-h-11 rounded-xl border border-white/10 px-4">Refresh</button></div>
    {loading && <p className="text-slate-300">Loading evidence…</p>}{error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">{error} <button onClick={() => void load()} className="ml-2 min-h-11 underline">Retry</button></div>}
    {!loading && !error && rows.length === 0 && <div className="rounded-2xl border border-white/10 p-6 text-slate-300">No evidence is awaiting or has completed review.</div>}
    <div className="grid gap-4 xl:grid-cols-2">{rows.map((row) => { const observations = Array.isArray(row.visible_observations) ? row.visible_observations.filter((item): item is string => typeof item === 'string') : []; const codes = Array.isArray(row.reason_codes) ? row.reason_codes.filter((item): item is string => typeof item === 'string') : []; return <article key={row.evidence_id} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60 p-4"><div className="flex justify-between gap-3"><div><h2 className="font-semibold">{row.task_title}</h2><p className="text-xs text-slate-400">Submitted by {typeof row.submitter_name === 'string' ? row.submitter_name : 'Team member'}</p></div><span className="h-fit rounded-full bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200">{row.evidence_status.replaceAll('_', ' ')}</span></div>
      {urls[row.evidence_id] ? <Image unoptimized src={urls[row.evidence_id]} alt="Private task evidence" width={800} height={600} className="mt-3 max-h-80 w-full rounded-xl bg-black object-contain" /> : <button onClick={() => void showImage(row.evidence_id)} className="mt-3 min-h-11 w-full rounded-xl border border-white/10">Load private image</button>}
      <div className="mt-3 space-y-2 text-sm"><p><span className="text-slate-400">AI verdict:</span> {typeof row.ai_verdict === 'string' ? row.ai_verdict : 'Not available'}</p><p><span className="text-slate-400">Confidence:</span> {typeof row.confidence === 'number' ? `${Math.round(row.confidence * 100)}%` : '—'}</p><p>{typeof row.explanation === 'string' ? row.explanation : 'Analysis has not completed.'}</p>{observations.length > 0 && <ul className="list-disc pl-5 text-slate-300">{observations.map((item) => <li key={item}>{item}</li>)}</ul>}{codes.length > 0 && <p className="text-xs text-amber-200">{codes.join(' · ')}</p>}<p className="text-xs text-slate-500">Attempts: {Array.isArray(row.attempts) ? row.attempts.length : 0} · Audit events: {Array.isArray(row.audit_history) ? row.audit_history.length : 0}</p></div>
      {row.evidence_status === 'verification_failed' && <button onClick={() => void retryVerification(row.evidence_id)} className="mt-4 min-h-11 w-full rounded-xl border border-amber-500/30 text-amber-200">Retry AI analysis</button>}
      {['ai_verified','ai_rejected','needs_human_review','verification_failed'].includes(row.evidence_status) && <div className="mt-2 grid grid-cols-2 gap-2"><button onClick={() => setConfirming({ id: row.evidence_id, decision: 'rejected' })} className="min-h-11 rounded-xl border border-red-500/30 text-red-200">Reject</button><button onClick={() => setConfirming({ id: row.evidence_id, decision: 'approved' })} className="min-h-11 rounded-xl bg-cyan-600 font-semibold">Approve</button></div>}
    </article>; })}</div>
    {confirming && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4" role="dialog" aria-modal="true"><div className="w-full rounded-t-3xl bg-slate-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-2xl"><h2 className="text-lg font-bold">Confirm {confirming.decision}</h2><p className="mt-2 text-sm text-slate-300">This records an append-only human decision. The task status will not change.</p><label className="mt-4 block text-sm">Optional note<textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-base" /></label><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => setConfirming(null)} className="min-h-11 rounded-xl border border-white/10">Cancel</button><button onClick={() => void review()} className="min-h-11 rounded-xl bg-cyan-600 font-semibold">Confirm</button></div></div></div>}
  </main>;
}
