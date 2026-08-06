'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/components/LocaleProvider';

type ConfigurationIssue = { code: string; variableNames: string[]; area: string };
type Alert = { code: string; severity: 'critical'|'high'|'medium' };
type Health = {
  workers?: Array<Record<string, unknown>>;
  queues?: Record<string, Record<string, unknown>>;
  materialization?: Record<string, unknown>;
  agents?: Record<string, unknown>;
  recurring?: Record<string, unknown>;
  operational?: { status: 'ok'|'degraded'; alerts: Alert[]; observedAt: string };
  telemetryAvailable?: boolean;
  telemetryErrorCode?: string;
  telemetryDiagnostic?: { code: string; stage: string; postgrestCode: string|null; httpStatus: number|null };
  configuration?: { deploymentEnvironment: string; valid: boolean; coreValid: boolean; issues: ConfigurationIssue[] };
};

const text = {
  en: { title:'Worker health', description:'Global operational summary without tenant or task details.', unavailable:'Worker health is currently unavailable.', loading:'Loading…', alerts:'Operational alerts', healthy:'No active operational alert.', configuration:'Runtime configuration', valid:'All required runtime configuration is valid.', issues:'configuration issues detected.', variables:'Variables', telemetry:'Worker telemetry is unavailable.', stage:'Stage', postgrest:'PostgREST code', http:'HTTP status', success:'Last success', failure:'Last failure', code:'Failure code', pending:'Pending', retrying:'Retrying', dead:'Dead-letter', oldest:'Oldest pending', freshness:'Materialization freshness', agents:'Brain Agents', recurring:'Recurring-task failures (24h)', escalate:'Escalation: Critical — page the launch owner immediately. High — acknowledge within 15 minutes and follow the recovery runbook.' },
  ar: { title:'صحة خدمات المعالجة', description:'ملخص تشغيلي عام من دون تفاصيل الشركات أو المهام.', unavailable:'حالة الخدمات غير متاحة حالياً.', loading:'جارٍ التحميل…', alerts:'التنبيهات التشغيلية', healthy:'لا يوجد تنبيه تشغيلي نشط.', configuration:'إعدادات التشغيل', valid:'كل إعدادات التشغيل المطلوبة صالحة.', issues:'مشكلة إعداد مكتشفة.', variables:'المتغيرات', telemetry:'بيانات تشغيل المعالجات غير متاحة.', stage:'المرحلة', postgrest:'رمز PostgREST', http:'حالة HTTP', success:'آخر نجاح', failure:'آخر فشل', code:'رمز الفشل', pending:'قيد الانتظار', retrying:'إعادة المحاولة', dead:'فشل نهائي', oldest:'أقدم عنصر', freshness:'حداثة الإنشاء', agents:'وكلاء برين', recurring:'إخفاقات المهام المتكررة (24 ساعة)', escalate:'التصعيد: حرج — تواصل فوراً مع مسؤول الإطلاق. عالٍ — أكّد الاستلام خلال 15 دقيقة واتبع دليل الاستعادة.' },
};
const value = (input: unknown) => input === null || input === undefined ? '—' : String(input);

export default function WorkerHealthPage() {
  const { language } = useLocale();
  const t = text[language];
  const [health, setHealth] = useState<Health|null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { fetch('/api/workers/health', { credentials:'same-origin', cache:'no-store' })
    .then(async (response) => { if (!response.ok) throw new Error('unavailable'); return response.json(); })
    .then((body) => setHealth(body.data)).catch(() => setFailed(true)); }, []);
  const issues = health?.configuration?.issues ?? [];
  const alerts = health?.operational?.alerts ?? [];
  return <div className="space-y-6" dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <header><h1 className="text-3xl font-bold text-slate-950">{t.title}</h1><p className="mt-2 text-slate-600">{t.description}</p></header>
    {failed ? <div role="alert" className="brain-surface p-5 text-red-700">{t.unavailable}</div> : null}
    {!health && !failed ? <p>{t.loading}</p> : null}
    {health ? <>
      <section className="brain-surface p-5"><h2 className="font-semibold text-slate-950">{t.alerts}</h2>
        {alerts.length ? <div className="mt-4 space-y-3">{alerts.map((alert) => <div role="alert" key={alert.code} className={alert.severity === 'critical' ? 'rounded-xl border border-red-200 bg-red-50 p-3 text-red-900' : 'rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950'}><span className="font-semibold uppercase">{alert.severity}</span> · <span className="font-mono break-all">{alert.code}</span></div>)}<p className="text-sm text-slate-600">{t.escalate}</p></div> : <p className="mt-2 text-sm text-emerald-700">{t.healthy}</p>}
      </section>
      <section className="brain-surface p-5"><h2 className="font-semibold text-slate-950">{t.configuration}</h2><p className={`mt-2 text-sm ${issues.length ? 'text-amber-800':'text-emerald-700'}`}>{issues.length ? `${issues.length} ${t.issues}` : t.valid}</p>
        {issues.length ? <ul className="mt-4 space-y-3">{issues.map((item) => <li key={`${item.code}:${item.variableNames.join(',')}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><div className="font-mono break-all">{item.code}</div><div className="mt-1 break-words">{t.variables}: {item.variableNames.join(', ')}</div></li>)}</ul> : null}
      </section>
      {health.telemetryAvailable === false ? <div role="alert" className="brain-surface p-5 text-amber-800"><p>{t.telemetry} <span className="font-mono">{health.telemetryErrorCode}</span></p>{health.telemetryDiagnostic ? <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div><dt>{t.stage}</dt><dd className="font-mono">{health.telemetryDiagnostic.stage}</dd></div><div><dt>{t.postgrest}</dt><dd className="font-mono">{value(health.telemetryDiagnostic.postgrestCode)}</dd></div><div><dt>{t.http}</dt><dd className="font-mono">{value(health.telemetryDiagnostic.httpStatus)}</dd></div></dl> : null}</div> : null}
      {health.telemetryAvailable !== false ? <>
        <section className="grid gap-4 md:grid-cols-2">{(health.workers ?? []).map((worker) => <article key={String(worker.name)} className="brain-surface p-5"><h2 className="font-semibold text-slate-950">{String(worker.name)}</h2><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><dt>{t.success}</dt><dd>{value(worker.lastSucceededAt)}</dd><dt>{t.failure}</dt><dd>{value(worker.lastFailedAt)}</dd><dt>{t.code}</dt><dd>{value(worker.lastFailureCode)}</dd></dl></article>)}</section>
        <section className="grid gap-4 md:grid-cols-3">{Object.entries(health.queues ?? {}).map(([name, queue]) => <article key={name} className="brain-surface p-5"><h2 className="font-semibold text-slate-950">{name}</h2><p className="mt-2 text-sm">{t.pending}: {value(queue.pending)} · {t.retrying}: {value(queue.retrying)} · {t.dead}: {value(queue.deadLetter)}</p><p className="mt-2 text-xs text-slate-500">{t.oldest}: {value(queue.oldestPendingAt)}</p></article>)}</section>
        <section className="grid gap-4 sm:grid-cols-2"><article className="brain-surface p-5"><h2 className="font-semibold text-slate-950">{t.agents}</h2><dl className="mt-3 space-y-2 text-sm">{Object.entries(health.agents ?? {}).map(([key,item]) => <div key={key} className="flex justify-between gap-4"><dt>{key}</dt><dd>{value(item)}</dd></div>)}</dl></article><article className="brain-surface p-5"><h2 className="font-semibold text-slate-950">{t.recurring}</h2><p className="mt-3 text-2xl font-semibold">{value(health.recurring?.failedLast24Hours)}</p></article></section>
        <section className="brain-surface p-5"><h2 className="font-semibold text-slate-950">{t.freshness}</h2><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{Object.entries(health.materialization ?? {}).map(([key,item]) => <div key={key}><dt className="text-slate-500">{key}</dt><dd>{value(item)}</dd></div>)}</dl></section>
      </> : null}
    </> : null}
  </div>;
}
