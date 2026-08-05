'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/components/LocaleProvider';

type ConfigurationIssue = { code: string; variableNames: string[]; area: string };
type Health = {
  workers?: Array<Record<string, unknown>>;
  queues?: Record<string, Record<string, unknown>>;
  materialization?: Record<string, unknown>;
  observedAt?: string;
  telemetryAvailable?: boolean;
  telemetryErrorCode?: string;
  configuration?: {
    deploymentEnvironment: string;
    valid: boolean;
    coreValid: boolean;
    issues: ConfigurationIssue[];
  };
};

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
  const issues = health?.configuration?.issues ?? [];
  return <div className="space-y-6" dir={ar ? 'rtl' : 'ltr'}>
    <div><h1 className="text-3xl font-bold text-slate-950">{ar ? 'صحة خدمات المعالجة' : 'Worker health'}</h1>
      <p className="mt-2 text-slate-600">{ar ? 'ملخص عام دون تفاصيل الشركات أو المهام.' : 'Global operational summary without tenant or task details.'}</p></div>
    {failed ? <div role="alert" className="brain-surface p-5 text-red-700">{ar ? 'حالة الخدمات غير متاحة حالياً.' : 'Worker health is currently unavailable.'}</div> : null}
    {!health && !failed ? <p>{ar ? 'جار التحميل…' : 'Loading…'}</p> : null}
    {health ? <>
      <section className="brain-surface p-5">
        <h2 className="font-semibold text-slate-950">{ar ? 'إعدادات التشغيل' : 'Runtime configuration'}</h2>
        <p className={`mt-2 text-sm ${issues.length ? 'text-amber-800' : 'text-emerald-700'}`}>
          {issues.length
            ? (ar ? `توجد ${issues.length} مشكلة آمنة للتشخيص.` : `${issues.length} configuration issue${issues.length === 1 ? '' : 's'} detected.`)
            : (ar ? 'كل إعدادات التشغيل المطلوبة صالحة.' : 'All required runtime configuration is valid.')}
        </p>
        {issues.length ? <ul className="mt-4 space-y-3" aria-label={ar ? 'مشكلات الإعداد' : 'Configuration issues'}>
          {issues.map((item) => <li key={`${item.code}:${item.variableNames.join(',')}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <div className="font-mono break-all">{item.code}</div>
            <div className="mt-1 break-words">{ar ? 'المتغيرات' : 'Variables'}: {item.variableNames.join(', ')}</div>
          </li>)}
        </ul> : null}
      </section>
      {health.telemetryAvailable === false ? <div role="alert" className="brain-surface p-5 text-amber-800">
        {ar ? 'بيانات تشغيل المعالجات غير متاحة.' : 'Worker telemetry is unavailable.'} <span className="font-mono">{health.telemetryErrorCode}</span>
      </div> : null}
      {health.telemetryAvailable !== false ? <>
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
    </> : null}
  </div>;
}
