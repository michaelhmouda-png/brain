'use client';

import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  PackageOpen,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrainPage, BrainPageHeader, BrainSurface } from '@/components/brain-experience/BrainUI';
import { BrainMark } from '@/components/brain-experience/BrainMark';

interface DailyBriefing {
  generated_at: string;
  greeting: string;
  brain_score: {
    total: number;
    change: number | null;
    categories: {
      operations: number;
      employees: number;
      inventory: number;
      customers: number;
      data_quality: number;
    };
  };
  priorities: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    description: string;
    related_record_id: string | null;
  }>;
  positive_updates: string[];
  recommended_actions: string[];
  unavailable_metrics: string[];
}

interface TimelineEvent {
  id: string;
  event_type: string;
  module: string;
  title: string;
  description?: string;
  occurred_at: string;
}

const categoryMeta = {
  operations: { label: 'Operations', href: '/dashboard/tasks', icon: ClipboardCheck },
  employees: { label: 'Team', href: '/dashboard/employees', icon: Users },
  inventory: { label: 'Inventory', href: '/dashboard/inventory', icon: PackageOpen },
  customers: { label: 'Guests', href: '/dashboard/customers', icon: Users },
  data_quality: { label: 'Data quality', href: '/dashboard/settings', icon: CheckCircle2 },
} as const;

function scoreStatus(score: number) {
  if (score >= 90) return { label: 'Excellent', tone: 'text-emerald-700', ring: 'stroke-emerald-600' };
  if (score >= 80) return { label: 'Strong', tone: 'text-emerald-700', ring: 'stroke-emerald-600' };
  if (score >= 70) return { label: 'Needs attention', tone: 'text-amber-700', ring: 'stroke-amber-600' };
  if (score >= 60) return { label: 'At risk', tone: 'text-orange-700', ring: 'stroke-orange-600' };
  return { label: 'Urgent', tone: 'text-red-700', ring: 'stroke-red-600' };
}

function recommendationLink(action: string) {
  const value = action.toLowerCase();
  if (value.includes('employee')) return '/dashboard/employees';
  if (value.includes('inventory') || value.includes('stock')) return '/dashboard/inventory';
  if (value.includes('customer') || value.includes('guest')) return '/dashboard/customers';
  if (value.includes('maintenance')) return '/dashboard/maintenance';
  return '/dashboard/tasks';
}

function priorityTone(severity: DailyBriefing['priorities'][number]['severity']) {
  if (severity === 'critical') return 'brain-priority is-urgent';
  if (severity === 'high') return 'brain-priority is-attention';
  if (severity === 'medium') return 'brain-priority is-information';
  return 'brain-priority';
}

export function PremiumCommandCenter() {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [briefingResponse, timelineResponse] = await Promise.all([
        fetch('/api/brain/daily-briefing', { cache: 'no-store', credentials: 'same-origin' }),
        fetch('/api/brain/timeline', { cache: 'no-store', credentials: 'same-origin' }),
      ]);
      if (!briefingResponse.ok) throw new Error(briefingResponse.status === 401 ? 'Please sign in to view your briefing.' : 'Today’s briefing is unavailable.');
      setBriefing(await briefingResponse.json() as DailyBriefing);
      if (timelineResponse.ok) {
        const payload: unknown = await timelineResponse.json();
        setTimeline(payload && typeof payload === 'object' && 'events' in payload && Array.isArray(payload.events)
          ? payload.events as TimelineEvent[]
          : []);
      }
      setLastUpdated(new Date());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Today’s briefing is unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  if (loading && !briefing) {
    return (
      <BrainPage>
        <div className="h-10 w-64 animate-pulse rounded-xl bg-white" />
        <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
          <div className="h-64 animate-pulse rounded-[24px] bg-white" />
          <div className="h-64 animate-pulse rounded-[24px] bg-white" />
        </div>
      </BrainPage>
    );
  }

  if (!briefing) {
    return (
      <BrainSurface className="p-7">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
          <div>
            <h1 className="font-semibold text-slate-900">{error || 'Today’s briefing is unavailable.'}</h1>
            <button type="button" onClick={() => void load()} className="brain-button-secondary mt-4">
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          </div>
        </div>
      </BrainSurface>
    );
  }

  const health = scoreStatus(briefing.brain_score.total);
  const scoreChange = briefing.brain_score.change;

  return (
    <BrainPage>
      <BrainPageHeader
        eyebrow="Today"
        title={briefing.greeting}
        description={lastUpdated ? `Your live operational briefing · updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Your live operational briefing'}
        actions={(
          <button type="button" onClick={() => void load()} disabled={loading} className="brain-button-secondary" aria-label="Refresh briefing">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,.7fr)]">
        <BrainSurface className="brain-briefing-hero">
          <div className="flex min-w-0 flex-col justify-between gap-8">
            <div>
              <p className="brain-eyebrow">Business health</p>
              <h2 className="mt-3 max-w-xl text-2xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-3xl">
                {briefing.priorities.length
                  ? `${briefing.priorities.length} ${briefing.priorities.length === 1 ? 'priority needs' : 'priorities need'} your attention.`
                  : 'Operations are clear right now.'}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
                {briefing.priorities[0]?.description || briefing.positive_updates[0] || 'Brain will surface the next important operational change here.'}
              </p>
            </div>
            <button type="button" onClick={() => window.dispatchEvent(new Event('brain:open'))} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl bg-[var(--brain-action-primary)] px-4 text-sm font-semibold text-[var(--brain-action-primary-text)]">
              <BrainMark className="h-5 w-5" />
              Ask about today
            </button>
          </div>
          <div className="brain-score">
            <svg viewBox="0 0 120 120" className="h-36 w-36 -rotate-90" aria-hidden="true">
              <circle cx="60" cy="60" r="51" fill="none" stroke="#ecece8" strokeWidth="8" />
              <circle
                cx="60"
                cy="60"
                r="51"
                fill="none"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${briefing.brain_score.total * 3.204} 320.4`}
                className={health.ring}
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="text-4xl font-semibold tracking-[-0.06em] text-slate-950">{briefing.brain_score.total}</p>
                <p className={`text-xs font-semibold ${health.tone}`}>{health.label}</p>
              </div>
            </div>
            {scoreChange !== null ? (
              <p className={`mt-2 flex items-center justify-center gap-1 text-xs font-medium ${scoreChange < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                {scoreChange < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                {scoreChange > 0 ? '+' : ''}{scoreChange} since yesterday
              </p>
            ) : null}
          </div>
        </BrainSurface>

        <BrainSurface className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="brain-eyebrow">What matters now</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950">Priorities</h2>
            </div>
            <span className="brain-count-badge">{briefing.priorities.length}</span>
          </div>
          <div className="mt-5 space-y-2">
            {briefing.priorities.length ? briefing.priorities.slice(0, 4).map((priority, index) => (
              <article key={`${priority.title}-${index}`} className={priorityTone(priority.severity)}>
                <span className="brain-priority-dot" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900">{priority.title}</h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{priority.description}</p>
                </div>
              </article>
            )) : (
              <div className="py-8 text-center">
                <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-600" />
                <p className="mt-2 text-sm font-medium text-slate-700">Nothing urgent</p>
                <p className="mt-1 text-xs text-slate-500">Brain is watching for changes.</p>
              </div>
            )}
          </div>
        </BrainSurface>
      </div>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="brain-eyebrow">At a glance</p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950">Your operation</h2>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Object.entries(briefing.brain_score.categories).map(([key, score]) => {
            const meta = categoryMeta[key as keyof typeof categoryMeta];
            const Icon = meta.icon;
            return (
              <Link key={key} href={meta.href} className="brain-metric-card">
                <span className="brain-metric-icon"><Icon className="h-4 w-4" /></span>
                <span className="mt-5 text-3xl font-semibold tracking-[-0.05em] text-slate-950">{score}</span>
                <span className="mt-1 text-xs text-slate-500">{meta.label}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <BrainSurface className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="brain-eyebrow">Brain recommends</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950">Next actions</h2>
            </div>
            <Sparkles className="h-5 w-5 text-blue-600" />
          </div>
          <div className="mt-5 divide-y divide-slate-100">
            {briefing.recommended_actions.length ? briefing.recommended_actions.slice(0, 4).map((action) => (
              <Link key={action} href={recommendationLink(action)} className="group flex min-h-14 items-center gap-3 py-2 text-sm text-slate-700">
                <span className="min-w-0 flex-1">{action}</span>
                <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-600" />
              </Link>
            )) : <p className="py-8 text-sm text-slate-500">No recommendations right now.</p>}
          </div>
        </BrainSurface>

        <BrainSurface className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="brain-eyebrow">Live operation</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950">Recent activity</h2>
            </div>
            <Link href="/dashboard/timeline" className="text-xs font-semibold text-blue-700">View all</Link>
          </div>
          <div className="mt-5 space-y-1">
            {timeline.length ? timeline.slice(0, 5).map((event) => (
              <article key={event.id} className="flex gap-3 py-2.5">
                <time className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-slate-400">
                  {new Date(event.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium text-slate-800">{event.title}</h3>
                  <p className="mt-0.5 text-xs capitalize text-slate-500">{event.module}</p>
                </div>
              </article>
            )) : (
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-slate-700">A quiet start</p>
                <p className="mt-1 text-xs text-slate-500">Today’s operational events will appear here.</p>
              </div>
            )}
          </div>
        </BrainSurface>
      </div>
    </BrainPage>
  );
}
