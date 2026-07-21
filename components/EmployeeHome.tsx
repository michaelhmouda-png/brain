'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale } from './LocaleProvider';

type Summary = { tasks: number; today: number; overdue: number; notifications: number };
export function EmployeeHome() {
  const { messages: t } = useLocale();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { const controller = new AbortController(); Promise.all([
    fetch('/api/tasks', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal }).then((r) => r.ok ? r.json() : Promise.reject()),
    fetch('/api/notifications?state=true', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal }).then((r) => r.ok ? r.json() : Promise.reject()),
  ]).then(([taskPayload, notificationPayload]: unknown[]) => {
    const tasks = taskPayload && typeof taskPayload === 'object' && 'data' in taskPayload && Array.isArray((taskPayload as { data: unknown[] }).data) ? (taskPayload as { data: Array<Record<string, unknown>> }).data : [];
    const activeTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress');
    const today = new Date().toISOString().slice(0, 10);
    setSummary({ tasks: activeTasks.length, today: activeTasks.filter((task) => task.dueDate === today).length, overdue: activeTasks.filter((task) => typeof task.dueDate === 'string' && task.dueDate < today).length, notifications: notificationPayload && typeof notificationPayload === 'object' && 'unread_count' in notificationPayload ? Number((notificationPayload as { unread_count: unknown }).unread_count) || 0 : 0 });
  }).catch(() => { if (!controller.signal.aborted) setFailed(true); }); return () => controller.abort(); }, []);
  return <section className="space-y-6 rounded-[32px] border border-white/10 bg-white/5 p-5 sm:p-8">
    <header><p className="text-sm uppercase tracking-[.3em] text-cyan-300">{t.home.eyebrow}</p><h1 className="mt-3 text-3xl font-black">{t.home.title}</h1><p className="mt-2 text-slate-300">{t.home.description}</p></header>
    {failed && <div role="alert" className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-red-100">{t.home.unavailable}</div>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[
      [t.home.tasks, summary?.tasks], [t.home.today, summary?.today], [t.home.overdue, summary?.overdue], [t.home.notifications, summary?.notifications],
    ].map(([label, value]) => <article key={String(label)} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-3xl font-black text-white">{value ?? '—'}</p></article>)}</div>
    <div className="grid gap-3 sm:grid-cols-3"><Link href="/dashboard/tasks" className="flex min-h-11 items-center justify-center rounded-xl bg-cyan-600 px-4 font-semibold">{t.home.viewTasks}</Link><Link href="/dashboard/notifications" className="flex min-h-11 items-center justify-center rounded-xl border border-white/15 px-4 font-semibold">{t.home.notifications}</Link><Link href="/dashboard/ai-assistant" className="flex min-h-11 items-center justify-center rounded-xl border border-white/15 px-4 font-semibold">{t.home.askBrain}</Link></div>
  </section>;
}
