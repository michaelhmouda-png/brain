'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  Check,
  Clock3,
  LoaderCircle,
  Paperclip,
  X,
} from 'lucide-react';
import { TaskEvidenceAttachment } from '@/components/brain/TaskEvidenceAttachment';
import { useLocale } from '@/components/LocaleProvider';
import { interpolateMessage } from '@/lib/i18n';
import { BrainMark } from './BrainMark';

type CommandState = 'idle' | 'thinking' | 'confirming' | 'executing' | 'done' | 'failed';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
};

type PendingAction = {
  id: string;
  label: string;
  rows: Array<{ key: string; value: string }>;
  expiresAt: string;
};

type ChatQuota = {
  limit: number;
  remaining: number;
  resetAt: string | null;
};

export type BrainPageContext = {
  route: string;
  moduleKey: 'reservations' | 'timeline' | 'tasks' | 'cameras' | 'employees' | 'inventory' | 'maintenance' | 'incidents' | 'operations' | 'schedule' | 'notifications' | 'settings' | 'home' | 'brain';
  module: string;
  view: string;
  entity: string | null;
  company: string;
  location: string;
  user: string;
};

const CONFIRMATIONS = new Set([
  'confirm',
  'yes',
  'proceed',
  'approved',
  'go ahead',
  'do it',
  'ok',
  'تأكيد',
  'نعم',
  'تابع',
  'موافق',
]);

function parseQuota(value: unknown): ChatQuota | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const quota = value as Record<string, unknown>;
  if (
    quota.limit !== 100 ||
    typeof quota.remaining !== 'number' ||
    !Number.isInteger(quota.remaining) ||
    quota.remaining < 0 ||
    quota.remaining > 100 ||
    !(quota.resetAt === null || typeof quota.resetAt === 'string')
  ) {
    return null;
  }
  return { limit: 100, remaining: quota.remaining, resetAt: quota.resetAt };
}

function isConfirmation(value: string) {
  return CONFIRMATIONS.has(value.trim().toLowerCase());
}

function contextualizeMessage(message: string, context: BrainPageContext) {
  const safeContext = [
    `Current module: ${context.module}`,
    `Current view: ${context.view}`,
    `Location context: ${context.location}`,
    context.entity ? `Selected entity: ${context.entity}` : null,
  ].filter(Boolean).join('. ');
  return `[Page context: ${safeContext}.] ${message}`;
}

export function BrainAssistant({
  context,
  onConversationActivity,
}: {
  context: BrainPageContext;
  onConversationActivity?: (preview: string) => void;
}) {
  const { language, role, messages: t } = useLocale();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [quota, setQuota] = useState<ChatQuota | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [state, setState] = useState<CommandState>('idle');
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const submitted = useRef(new Set<string>());
  const suggestions = useMemo(() => {
    if (role === 'employee') return t.assistant.suggestions.employee;
    const key = context.moduleKey === 'reservations' || context.moduleKey === 'operations' ||
      context.moduleKey === 'tasks' || context.moduleKey === 'cameras' || context.moduleKey === 'employees'
      ? context.moduleKey
      : 'default';
    return t.assistant.suggestions[key];
  }, [context.moduleKey, role, t]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/brain/quota', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        const nextQuota = payload && typeof payload === 'object' && 'quota' in payload
          ? parseQuota((payload as { quota: unknown }).quota)
          : null;
        if (!response.ok || !nextQuota) throw new Error(t.assistant.unavailable);
        setQuota(nextQuota);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : t.assistant.unavailable);
        }
      });
    return () => controller.abort();
  }, [t]);

  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [messages, pendingAction, state]);

  const send = async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || state === 'thinking' || state === 'executing') return;
    const confirming = Boolean(pendingAction && isConfirmation(message));
    if (!confirming && (!quota || quota.remaining <= 0)) return;
    if (confirming && pendingAction && submitted.current.has(pendingAction.id)) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setError(null);
    setState(confirming ? 'executing' : 'thinking');
    onConversationActivity?.(message);

    try {
      const requestBody: Record<string, unknown> = {};
      if (confirming && pendingAction) {
        submitted.current.add(pendingAction.id);
        requestBody.proposalId = pendingAction.id;
        requestBody.decision = 'approve';
      } else {
        const recentMessages = [...messages, userMessage].slice(-10).map((item, index, all) => ({
          role: item.role,
          content: item.role === 'user' && index === all.length - 1
            ? contextualizeMessage(item.content, context)
            : item.content,
        }));
        requestBody.messages = recentMessages;
      }

      const response = await fetch('/api/brain/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const payload: unknown = await response.json();
      const record = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : {};
      const nextQuota = parseQuota(record.quota);
      if (nextQuota) setQuota(nextQuota);
      if (!response.ok || typeof record.message !== 'string') {
        throw new Error(t.assistant.requestFailed);
      }
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: record.message as string,
        timestamp: new Date(),
      }]);
      const proposal = record.proposal;
      if (proposal && typeof proposal === 'object' && !Array.isArray(proposal)) {
        const candidate = proposal as Record<string, unknown>;
        if (
          typeof candidate.id === 'string' &&
          typeof candidate.label === 'string' &&
          typeof candidate.expiresAt === 'string' &&
          Array.isArray(candidate.rows)
        ) {
          setPendingAction(candidate as PendingAction);
          setState('confirming');
          return;
        }
      }
      setPendingAction(null);
      setState('done');
    } catch (reason) {
      if (confirming && pendingAction) submitted.current.delete(pendingAction.id);
      setError(reason instanceof Error ? reason.message : t.assistant.requestFailed);
      setState('failed');
    }
  };

  const rejectAction = async () => {
    if (!pendingAction || state === 'executing') return;
    setState('executing');
    try {
      const response = await fetch('/api/brain/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: pendingAction.id, decision: 'reject' }),
      });
      if (!response.ok) throw new Error(t.assistant.cancelFailed);
      setPendingAction(null);
      setState('idle');
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: t.assistant.actionCancelled,
        timestamp: new Date(),
      }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.assistant.cancelFailed);
      setState('failed');
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={messagesRef} className="mobile-scroll-region min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col justify-between gap-8">
            <div>
              <div className="brain-assistant-welcome">
                <BrainMark className="h-8 w-8 text-slate-950" />
              </div>
              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                {t.assistant.greeting}
              </h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                {t.assistant.contextHelp}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{t.assistant.suggested}</p>
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="brain-suggestion"
                >
                  <span>{suggestion}</span>
                  <ArrowUp className="h-4 w-4 rotate-45" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((message) => (
              <article key={message.id} className={message.role === 'user' ? 'brain-message-user' : 'brain-message-assistant'}>
                {message.role === 'assistant' ? <BrainMark className="mt-0.5 h-6 w-6 shrink-0 text-slate-950" /> : null}
                <div>
                  <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                  <time className="ui-muted mt-1 block text-[11px]">
                    {message.timestamp.toLocaleTimeString(language === 'ar' ? 'ar-LB' : 'en', { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </div>
              </article>
            ))}
            {(state === 'thinking' || state === 'executing') ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                {state === 'executing' ? t.assistant.executing : t.assistant.thinking}
              </div>
            ) : null}
            {error ? (
              <div className="ui-alert ui-alert-error flex gap-2 rounded-2xl p-3 text-sm" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {pendingAction ? (
        <section className="border-t border-slate-200 bg-amber-50/70 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Clock3 className="h-4 w-4 text-amber-600" />
            {interpolateMessage(t.assistant.confirmAction, { action: pendingAction.label })}
          </div>
          <dl className="mt-3 space-y-2">
            {pendingAction.rows.map((row) => (
              <div key={row.key} className="grid grid-cols-[7rem_1fr] gap-3 text-sm">
                <dt className="text-slate-500">{row.key}</dt>
                <dd className="font-medium text-slate-900">{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void rejectAction()} className="brain-button-secondary">
              <X className="h-4 w-4" /> {t.assistant.cancel}
            </button>
            <button type="button" onClick={() => void send('Confirm')} className="brain-button-primary">
              <Check className="h-4 w-4" /> {t.assistant.confirm}
            </button>
          </div>
        </section>
      ) : null}

      <form onSubmit={submit} className="border-t border-slate-200 bg-white p-4 sm:p-5">
        <div className="brain-composer">
          <TaskEvidenceAttachment
            disabled={state === 'thinking' || state === 'executing'}
            onUploaded={(taskTitle) => setMessages((current) => [...current, {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: interpolateMessage(t.brain.evidenceQueued, { task: taskTitle }),
              timestamp: new Date(),
            }])}
          />
          <label className="sr-only" htmlFor="brain-drawer-input">{t.assistant.inputLabel}</label>
          <input
            id="brain-drawer-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={interpolateMessage(t.assistant.placeholder, { module: context.module })}
            disabled={!quota || quota.remaining <= 0 || state === 'thinking' || state === 'executing'}
            className="min-w-0 flex-1 bg-transparent px-1 text-base text-slate-950 outline-none placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={!input.trim() || !quota || quota.remaining <= 0 || state === 'thinking' || state === 'executing'}
            className="brain-send-button"
            aria-label={t.assistant.send}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" /> {t.assistant.evidencePrivate}</span>
          <span>{quota ? interpolateMessage(t.assistant.requestsLeft, { count: quota.remaining }) : t.assistant.connecting}</span>
        </div>
      </form>
    </div>
  );
}
