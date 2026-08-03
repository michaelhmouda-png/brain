'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/components/LocaleProvider';

type Health = { workers?: Array<Record<string, unknown>>; queues?: Record<string, Record<string, unknown>>; materialization?: Record<string, unknown>; observedAt?: string };

function value(input: unknown) { return input === null || input === undefined ? '—' : String(input); }

export default function WorkerHealthPage() {
  const { language } = useLocale();
  const ar = language === 'ar';
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch('/api/workers/health', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => { if (!response.ok) throw new Error('unavailable'); return response.json(); })
      .then((body) => setHealth(body.data)).catch(() => setFailed(true));
  }, []);
  return <div className="space-y-6" dir={ar ? 'rtl' : 'ltr'}>
    <div><h1 className="text-3xl font-bold text-slate-950">{ar ? 'صحة خدمات المعالجة' : 'Worker health'}</h1>
      <p className="mt-2 text-slate-600">{ar ? 'ملخص عام دون تفاصيل الشركات أو المهام.' : 'Global operational summary without tenant or task details.'}</p></div>
    {failed ? <div role="alert" className="brain-surface p-5 text-red-700">{ar ? 'حالة الخدمات غير متاحة حالياً.' : 'Worker health is currently unavailable.'}</div> : null}
    {!health && !failed ? <p>{ar ? 'جار التحميل…' : 'Loading…'}</p> : null}
    {health ? <>
      <section className="grid gap-4 md:grid-cols-2">{(health.workers ?? []).map((worker) => <article key={String(worker.name)} className="brain-surface p-5">
        <h2 className="font-semibold text-slate-950">{String(worker.name)}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><dt>{ar ? 'آخر نجاح' : 'Last success'}</dt><dd>{value(worker.lastSucceededAt)}</dd>
          <dt>{ar ? 'آخر فشل' : 'Last failure'}</dt><dd>{value(worker.lastFailedAt)}</dd><dt>{ar ? 'رمز الفشل' : 'Failure code'}</dt><dd>{value(worker.lastFailureCode)}</dd></dl>
      </article>)}</section>
      <section className="grid gap-4 md:grid-cols-3">{Object.entries(health.queues ?? {}).map(([name, queue]) => <article key={name} className="brain-surface p-5"><h2 className="font-semibold text-slate-950">{name}</h2>
        <p className="mt-2 text-sm">{ar ? 'قيد الانتظار' : 'Pending'}: {value(queue.pending)} · {ar ? 'إعادة المحاولة' : 'Retrying'}: {value(queue.retrying)} · {ar ? 'فشل نهائي' : 'Dead-letter'}: {value(queue.deadLetter)}</p>
        <p className="mt-2 text-xs text-slate-500">{ar ? 'أقدم عنصر' : 'Oldest pending'}: {value(queue.oldestPendingAt)}</p></article>)}</section>
      <section className="brain-surface p-5"><h2 className="font-semibold text-slate-950">{ar ? 'حداثة الإنشاء' : 'Materialization freshness'}</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{Object.entries(health.materialization ?? {}).map(([key, item]) => <div key={key}><dt className="text-slate-500">{key}</dt><dd>{value(item)}</dd></div>)}</dl></section>
    </> : null}
  </div>;
}
