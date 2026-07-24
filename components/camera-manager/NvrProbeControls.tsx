'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Radar, Wifi } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import type {
  NvrProbeCommandType,
  SanitizedNvrProbeCommand,
  SanitizedNvrProbeControlState,
} from '@/lib/brain-agent/command-contracts';

const ACTIVE_STATES = new Set(['pending', 'leased']);

const labels = {
  en: {
    title: 'Read-only NVR diagnostics',
    description: 'Commands run through the assigned Local Brain Agent. Brain never connects directly to the NVR.',
    probe: 'Probe capabilities',
    health: 'Health diagnostics',
    loading: 'Checking Agent readiness…',
    unavailable: 'Diagnostics are not available.',
    failed: 'The diagnostic request could not be created.',
    requestId: 'Request ID',
    status: 'State',
    failure: 'Safe failure code',
    created: 'Created',
    expires: 'Expires',
    completed: 'Completed',
    attempts: 'Attempts',
    vendor: 'Vendor',
    model: 'Model',
    firmware: 'Firmware version',
    healthStatus: 'Overall health',
    healthy: 'Healthy',
    unhealthy: 'Unhealthy',
    responseTime: 'Response time',
    capabilities: 'Supported read-only CGI capabilities',
    noResult: 'No completed result yet.',
    reasons: {
      NVR_PROBE_GATEWAY_UNASSIGNED: 'Assign this NVR to a gateway first.',
      NVR_PROBE_ASSIGNMENT_INCOMPATIBLE: 'The NVR and gateway company/location assignment is incompatible.',
      NVR_PROBE_GATEWAY_OFFLINE: 'The assigned gateway is offline.',
      NVR_PROBE_TRANSPORT_UNAVAILABLE: 'The gateway command transport is unavailable.',
      NVR_PROBE_CREDENTIALS_NOT_REPORTED: 'The Agent has not reported protected local credentials for this NVR.',
    } as Record<string, string>,
  },
  ar: {
    title: 'تشخيص جهاز التسجيل للقراءة فقط',
    description: 'تعمل الأوامر عبر وكيل برين المحلي المعيّن. لا يتصل برين مباشرةً بجهاز التسجيل.',
    probe: 'فحص الإمكانات',
    health: 'تشخيص الصحة',
    loading: 'جارٍ التحقق من جاهزية الوكيل…',
    unavailable: 'التشخيص غير متاح.',
    failed: 'تعذّر إنشاء طلب التشخيص.',
    requestId: 'معرّف الطلب',
    status: 'الحالة',
    failure: 'رمز الخطأ الآمن',
    created: 'أُنشئ',
    expires: 'ينتهي',
    completed: 'اكتمل',
    attempts: 'المحاولات',
    vendor: 'الشركة المصنّعة',
    model: 'الطراز',
    firmware: 'إصدار البرنامج الثابت',
    healthStatus: 'الصحة العامة',
    healthy: 'سليم',
    unhealthy: 'غير سليم',
    responseTime: 'زمن الاستجابة',
    capabilities: 'إمكانات CGI المدعومة للقراءة فقط',
    noResult: 'لا توجد نتيجة مكتملة بعد.',
    reasons: {
      NVR_PROBE_GATEWAY_UNASSIGNED: 'عيّن جهاز التسجيل إلى بوابة أولاً.',
      NVR_PROBE_ASSIGNMENT_INCOMPATIBLE: 'تعيين الشركة أو الموقع بين جهاز التسجيل والبوابة غير متوافق.',
      NVR_PROBE_GATEWAY_OFFLINE: 'البوابة المعيّنة غير متصلة.',
      NVR_PROBE_TRANSPORT_UNAVAILABLE: 'نقل أوامر البوابة غير متاح.',
      NVR_PROBE_CREDENTIALS_NOT_REPORTED: 'لم يبلّغ الوكيل عن وجود بيانات اعتماد محلية محمية لهذا الجهاز.',
    } as Record<string, string>,
  },
} as const;

function isControlState(value: unknown): value is SanitizedNvrProbeControlState {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { nvrConnectionId?: unknown }).nvrConnectionId === 'string'
    && Array.isArray((value as { commands?: unknown }).commands));
}

export function NvrProbeControls({ nvrConnectionId }: { nvrConnectionId: string }) {
  const { language } = useLocale();
  const t = labels[language];
  const reachabilityLabel = language === 'ar' ? 'HTTP' : 'Check HTTP reachability';
  const [state, setState] = useState<SanitizedNvrProbeControlState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<NvrProbeCommandType | null>(null);
  const [reachability, setReachability] = useState<{
    commandId: string;
    status: string;
    attemptCount: number;
    result: Record<string, unknown> | null;
    errorCode: string | null;
  } | null>(null);
  const [submittingReachability, setSubmittingReachability] = useState(false);
  const [discovery, setDiscovery] = useState<{
    commandId: string;
    status: string;
    attemptCount: number;
    result: Record<string, unknown> | null;
    errorCode: string | null;
  } | null>(null);
  const [submittingDiscovery, setSubmittingDiscovery] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/devices/commands?nvrConnectionId=${encodeURIComponent(nvrConnectionId)}`,
        { cache: 'no-store', headers: { Accept: 'application/json' } },
      );
      const payload: unknown = await response.json().catch(() => null);
      const data = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { data?: unknown }).data
        : null;
      if (!response.ok || !isControlState(data)) throw new Error('NVR_PROBE_STATE_UNAVAILABLE');
      setState(data);
      setError(null);
    } catch {
      setError(t.unavailable);
    } finally {
      setLoading(false);
    }
  }, [nvrConnectionId, t.unavailable]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const hasActiveCommand = useMemo(
    () => state?.commands.some((command) => ACTIVE_STATES.has(command.status)) === true,
    [state],
  );
  const hasActiveLocalCommand = Boolean(
    reachability && ACTIVE_STATES.has(reachability.status)
    || discovery && ACTIVE_STATES.has(discovery.status),
  );

  useEffect(() => {
    if (!hasActiveCommand) return;
    const timer = window.setInterval(() => void load(), 2_000);
    return () => window.clearInterval(timer);
  }, [hasActiveCommand, load]);

  useEffect(() => {
    if (!reachability || !ACTIVE_STATES.has(reachability.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(
        `/api/devices/commands?id=${encodeURIComponent(reachability.commandId)}`,
        { cache: 'no-store', headers: { Accept: 'application/json' } },
      );
      const payload: unknown = await response.json().catch(() => null);
      const data = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { data?: unknown }).data
        : null;
      if (response.ok && data && typeof data === 'object' && !Array.isArray(data)) {
        setReachability(data as typeof reachability);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [reachability]);

  useEffect(() => {
    if (!discovery || !ACTIVE_STATES.has(discovery.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(
        `/api/devices/commands?id=${encodeURIComponent(discovery.commandId)}`,
        { cache: 'no-store', headers: { Accept: 'application/json' } },
      );
      const payload: unknown = await response.json().catch(() => null);
      const data = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { data?: unknown }).data
        : null;
      if (response.ok && data && typeof data === 'object' && !Array.isArray(data)) {
        setDiscovery(data as typeof discovery);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [discovery]);

  async function enqueue(commandType: NvrProbeCommandType) {
    if (!state?.eligible || hasActiveCommand || hasActiveLocalCommand || submitting) return;
    setSubmitting(commandType);
    setError(null);
    try {
      const response = await fetch('/api/devices/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          nvrConnectionId,
          commandType,
          idempotencyKey: crypto.randomUUID(),
          ttlSeconds: 120,
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const safeCode = payload && typeof payload === 'object' && !Array.isArray(payload)
          && typeof (payload as { error?: unknown }).error === 'string'
          ? (payload as { error: string }).error
          : null;
        throw new Error(safeCode ?? 'NVR_PROBE_NOT_ENQUEUED');
      }
      await load();
    } catch (caught) {
      const safeCode = caught instanceof Error ? caught.message : '';
      setError(t.reasons[safeCode] ?? t.failed);
    } finally {
      setSubmitting(null);
    }
  }

  async function enqueueReachability() {
    if (!state?.eligible || !state.gatewayId || submittingReachability || hasActiveCommand || hasActiveLocalCommand) return;
    setSubmittingReachability(true);
    setError(null);
    try {
      const response = await fetch('/api/devices/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          gatewayId: state.gatewayId,
          nvrConnectionId,
          commandType: 'network_reachability',
          idempotencyKey: crypto.randomUUID(),
          request: { portKind: 'http', timeoutMs: 5_000 },
          ttlSeconds: 120,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const data = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { data?: unknown }).data
        : null;
      if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)
          || typeof (data as { commandId?: unknown }).commandId !== 'string') {
        throw new Error('DEVICE_COMMAND_NOT_ENQUEUED');
      }
      setReachability({
        commandId: (data as { commandId: string }).commandId,
        status: String((data as { status?: unknown }).status ?? 'pending'),
        attemptCount: 0,
        result: null,
        errorCode: null,
      });
    } catch {
      setError(t.failed);
    } finally {
      setSubmittingReachability(false);
    }
  }

  async function enqueueDiscovery(diagnostic = false) {
    if (!state?.eligible || !state.gatewayId || submittingDiscovery || hasActiveCommand || hasActiveLocalCommand) return;
    setSubmittingDiscovery(true);
    setError(null);
    try {
      const response = await fetch('/api/devices/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          gatewayId: state.gatewayId,
          nvrConnectionId,
          commandType: 'channel_discovery',
          idempotencyKey: crypto.randomUUID(),
          request: diagnostic ? { diagnostic: true } : {},
          ttlSeconds: 120,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const data = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { data?: unknown }).data
        : null;
      if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)
          || typeof (data as { commandId?: unknown }).commandId !== 'string') {
        throw new Error('DEVICE_COMMAND_NOT_ENQUEUED');
      }
      setDiscovery({
        commandId: (data as { commandId: string }).commandId,
        status: String((data as { status?: unknown }).status ?? 'pending'),
        attemptCount: 0,
        result: null,
        errorCode: null,
      });
    } catch {
      setError(t.failed);
    } finally {
      setSubmittingDiscovery(false);
    }
  }

  const formatTime = (value: string | null) => value
    ? new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
    : '—';

  return (
    <section className="mt-4 border-t border-white/10 pt-4" aria-label={t.title}>
      <h4 className="font-semibold">{t.title}</h4>
      <p className="mt-1 text-xs text-slate-400">{t.description}</p>
      {loading ? <p className="mt-3 text-sm text-slate-400">{t.loading}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p> : null}
      {!loading && state && !state.eligible ? (
        <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">
          {state.safeUnavailableCode ? t.reasons[state.safeUnavailableCode] ?? t.unavailable : t.unavailable}
        </p>
      ) : null}
      {!loading && state?.eligible ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void enqueue('nvr_capability_probe')}
            disabled={hasActiveCommand || hasActiveLocalCommand || submitting !== null}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-cyan-400/30 px-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Radar className="h-4 w-4" />
            {t.probe}
          </button>
          <button
            type="button"
            onClick={() => void enqueue('nvr_health_diagnostics')}
            disabled={hasActiveCommand || hasActiveLocalCommand || submitting !== null}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-400/30 px-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Activity className="h-4 w-4" />
            {t.health}
          </button>
          <button
            type="button"
            onClick={() => void enqueueReachability()}
            disabled={hasActiveCommand || hasActiveLocalCommand || submitting !== null || submittingReachability}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-sky-400/30 px-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Wifi className="h-4 w-4" />
            {reachabilityLabel}
          </button>
          <button
            type="button"
            onClick={() => void enqueueDiscovery()}
            disabled={hasActiveCommand || hasActiveLocalCommand || submitting !== null || submittingDiscovery}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-violet-400/30 px-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Discover channels
          </button>
          <button
            type="button"
            onClick={() => void enqueueDiscovery(true)}
            disabled={hasActiveCommand || hasActiveLocalCommand || submitting !== null || submittingDiscovery}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-amber-400/30 px-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Diagnose channel response
          </button>
        </div>
      ) : null}
      {reachability ? (
        <article className="mt-3 rounded-xl bg-black/20 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{reachabilityLabel}</strong>
            <span className="rounded-full bg-white/10 px-2 py-1">{reachability.status}</span>
          </div>
          <dl className="mt-3 grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_1fr]">
            <dt className="text-slate-500">{t.requestId}</dt><dd className="break-all">{reachability.commandId}</dd>
            <dt className="text-slate-500">{t.attempts}</dt><dd>{reachability.attemptCount}</dd>
            <dt className="text-slate-500">{t.failure}</dt><dd>{reachability.errorCode ?? '—'}</dd>
            {reachability.result ? (
              <>
                <dt className="text-slate-500">{t.status}</dt><dd>{reachability.result.reachable ? 'reachable' : 'unreachable'}</dd>
                <dt className="text-slate-500">{t.responseTime}</dt><dd>{String(reachability.result.latencyMs)} ms</dd>
              </>
            ) : null}
          </dl>
        </article>
      ) : null}
      {discovery ? (
        <article className="mt-3 rounded-xl bg-black/20 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>Discover channels</strong>
            <span className="rounded-full bg-white/10 px-2 py-1">{discovery.status}</span>
          </div>
          <dl className="mt-3 grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_1fr]">
            <dt className="text-slate-500">{t.requestId}</dt><dd className="break-all">{discovery.commandId}</dd>
            <dt className="text-slate-500">{t.attempts}</dt><dd>{discovery.attemptCount}</dd>
            <dt className="text-slate-500">{t.failure}</dt><dd>{discovery.errorCode ?? '—'}</dd>
            <dt className="text-slate-500">Discovered channels</dt>
            <dd>{Array.isArray(discovery.result?.channels) ? discovery.result.channels.length : '—'}</dd>
          </dl>
        </article>
      ) : null}
      {state?.commands.map((command) => (
        <CommandStatus key={command.commandId} command={command} formatTime={formatTime} t={t} />
      ))}
    </section>
  );
}

function CommandStatus({
  command,
  formatTime,
  t,
}: {
  command: SanitizedNvrProbeCommand;
  formatTime: (value: string | null) => string;
  t: (typeof labels)[keyof typeof labels];
}) {
  const result = command.result;
  return (
    <article className="mt-3 rounded-xl bg-black/20 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{command.commandType === 'nvr_capability_probe' ? t.probe : t.health}</strong>
        <span className="rounded-full bg-white/10 px-2 py-1">{command.status}</span>
      </div>
      <dl className="mt-3 grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_1fr]">
        <dt className="text-slate-500">{t.requestId}</dt><dd className="break-all">{command.requestId}</dd>
        <dt className="text-slate-500">{t.status}</dt><dd>{command.status}</dd>
        <dt className="text-slate-500">{t.failure}</dt><dd>{command.safeFailureCode ?? '—'}</dd>
        <dt className="text-slate-500">{t.attempts}</dt><dd>{command.attemptCount}</dd>
        <dt className="text-slate-500">{t.created}</dt><dd>{formatTime(command.createdAt)}</dd>
        <dt className="text-slate-500">{t.expires}</dt><dd>{formatTime(command.expiresAt)}</dd>
        <dt className="text-slate-500">{t.completed}</dt><dd>{formatTime(command.completedAt)}</dd>
      </dl>
      {result ? (
        <dl className="mt-3 grid gap-x-3 gap-y-1 border-t border-white/10 pt-3 sm:grid-cols-[max-content_1fr]">
          <dt className="text-slate-500">{t.vendor}</dt><dd>{String(result.vendor)}</dd>
          <dt className="text-slate-500">{t.model}</dt><dd>{String(result.model)}</dd>
          <dt className="text-slate-500">{t.firmware}</dt><dd>{String(result.firmwareVersion)}</dd>
          <dt className="text-slate-500">{t.healthStatus}</dt><dd>{result.healthy ? t.healthy : t.unhealthy}</dd>
          <dt className="text-slate-500">{t.responseTime}</dt><dd>{String(result.responseTimeMs)} ms</dd>
          <dt className="text-slate-500">{t.capabilities}</dt>
          <dd className="break-words">{(result.capabilities as string[]).join(', ')}</dd>
        </dl>
      ) : (
        <p className="mt-3 border-t border-white/10 pt-3 text-slate-500">{t.noResult}</p>
      )}
    </article>
  );
}
