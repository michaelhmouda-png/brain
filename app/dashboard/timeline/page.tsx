'use client';

import { useCallback, useEffect, useState } from 'react';

type Observation = {
  id: string;
  observationType: string;
  value: unknown;
  description: string;
  confidence: number | null;
  state: 'observed' | 'unknown';
  requiresHumanReview: boolean;
};

type TimelineEvent = {
  id: string;
  occurredAt: string;
  eventType: string;
  title: string;
  summary: string;
  severity: 'info' | 'notice' | 'warning' | 'critical';
  confidence: number | null;
  locationName: string | null;
  sourceType: string;
  sourceId: string | null;
  requiresHumanReview: boolean;
  observations: Observation[];
};

function parseEvents(value: unknown): {
  events: TimelineEvent[];
  nextCursor: string | null;
} | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const data = (value as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const events = (data as { events?: unknown }).events;
  const nextCursor = (data as { nextCursor?: unknown }).nextCursor;
  if (!Array.isArray(events) || nextCursor !== null && typeof nextCursor !== 'string') return null;
  for (const event of events) {
    if (typeof event !== 'object' || event === null || Array.isArray(event)) return null;
    const row = event as Record<string, unknown>;
    if (typeof row.id !== 'string'
        || typeof row.occurredAt !== 'string'
        || typeof row.eventType !== 'string'
        || typeof row.title !== 'string'
        || typeof row.summary !== 'string'
        || typeof row.sourceType !== 'string'
        || typeof row.requiresHumanReview !== 'boolean'
        || !Array.isArray(row.observations)) return null;
  }
  return { events: events as TimelineEvent[], nextCursor };
}

const severityStyle = {
  info: 'bg-slate-500/15 text-slate-200',
  notice: 'bg-cyan-500/15 text-cyan-200',
  warning: 'bg-amber-500/15 text-amber-200',
  critical: 'bg-rose-500/15 text-rose-200',
};

export default function TimelinePage() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextCursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '25' });
      if (nextCursor) params.set('cursor', nextCursor);
      const response = await fetch(`/api/brain/timeline?${params}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = response.ok ? parseEvents(payload) : null;
      if (!parsed) throw new Error('BRAIN_TIMELINE_READ_FAILED');
      setEvents((current) => nextCursor ? [...current, ...parsed.events] : parsed.events);
      setCursor(parsed.nextCursor);
    } catch {
      setError('Timeline is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <section className="space-y-5 px-4 pb-8 sm:px-6 lg:px-0">
      <header className="rounded-[28px] border border-white/10 bg-white/5 p-5 sm:p-7">
        <p className="text-sm uppercase tracking-[0.25em] text-cyan-300">Operational memory</p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">Brain Timeline</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Read-only operational events and normalized observations. Recommendations remain advisory.
        </p>
      </header>
      {error ? <p role="alert" className="rounded-2xl border border-rose-400/30 p-4 text-rose-200">{error}</p> : null}
      {!loading && events.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">
          No Timeline events match this view.
        </p>
      ) : null}
      <div className="space-y-3">
        {events.map((event) => (
          <article key={event.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-slate-400">{new Date(event.occurredAt).toLocaleString()}</p>
                <h2 className="mt-1 text-lg font-bold">{event.title}</h2>
                <p className="mt-1 text-sm text-slate-300">{event.summary}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs ${severityStyle[event.severity]}`}>
                {event.severity}
              </span>
            </div>
            <dl className="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
              <div><dt>Event</dt><dd className="text-slate-200">{event.eventType}</dd></div>
              <div><dt>Location</dt><dd className="text-slate-200">{event.locationName ?? 'Company-wide'}</dd></div>
              <div><dt>Source</dt><dd className="text-slate-200">{event.sourceType}</dd></div>
              <div><dt>Confidence</dt><dd className="text-slate-200">{event.confidence === null ? 'Unknown' : `${Math.round(event.confidence * 100)}%`}</dd></div>
              <div><dt>Human review</dt><dd className="text-slate-200">{event.requiresHumanReview ? 'Required' : 'Not requested'}</dd></div>
            </dl>
            <details className="mt-4 rounded-xl border border-white/10 p-3">
              <summary className="cursor-pointer font-semibold">Observations ({event.observations.length})</summary>
              <div className="mt-3 space-y-2">
                {event.observations.map((observation) => (
                  <div key={observation.id} className="rounded-lg bg-white/5 p-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong>{observation.observationType}</strong>
                      <span className="text-xs text-slate-400">
                        {observation.state} · {observation.confidence === null ? 'unknown confidence' : `${Math.round(observation.confidence * 100)}%`}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-300">{observation.description}</p>
                  </div>
                ))}
              </div>
            </details>
          </article>
        ))}
      </div>
      {loading ? <p className="text-center text-sm text-slate-400">Loading Timeline…</p> : null}
      {!loading && cursor ? (
        <button
          type="button"
          onClick={() => void load(cursor)}
          className="min-h-11 rounded-xl border border-white/15 px-4 font-semibold"
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
