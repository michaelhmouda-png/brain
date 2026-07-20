'use client';

import { useState, useRef, useEffect } from 'react';
import { CheckCircle2, XCircle, Edit2, RefreshCw, AlertCircle } from 'lucide-react';

type CommandState = 'idle' | 'thinking' | 'confirming' | 'executing' | 'done' | 'failed';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  commandState?: CommandState;
}

interface PendingAction {
  id: string;
  label: string;
  rows: Array<{ key: string; value: string }>;
  expiresAt: string;
}

// Phrases that count as explicit confirmation when a pendingAction is active.
const CONFIRMATION_PHRASES = [
  'confirm',
  'yes',
  'yes, create them',
  'yes create them',
  'proceed',
  'yes please',
  'ok',
  'do it',
  'create',
  'approved',
  'go ahead',
];

function isConfirmationText(text: string): boolean {
  const t = text.trim().toLowerCase();
  return CONFIRMATION_PHRASES.some((p) => t === p || t.startsWith(p + ' ') || t.startsWith(p + ','));
}

const SUGGESTED_QUESTIONS = [
  'Assign Maroun to restock the bar tomorrow. It is urgent.',
  'Show me everything overdue.',
  'Which VIP customers have not visited in 30 days?',
  'Prepare for Saturday.',
];

/** Parse a pendingAction into a human-readable summary for the confirmation card */
function describePendingAction(pa: PendingAction): { label: string; rows: Array<{ key: string; value: string }> } {
  return { label: pa.label, rows: pa.rows };
}

export default function BrainChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [commandState, setCommandState] = useState<CommandState>('idle');
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [rateLimitRemaining, setRateLimitRemaining] = useState(10);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  // Track IDs that have been submitted to prevent double-execution on fast taps
  const submittedActionIds = useRef<Set<string>>(new Set());

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Check for preloaded message on mount
  useEffect(() => {
    const preloadedMessage = sessionStorage.getItem('aiPreloadMessage');
    if (preloadedMessage) {
      setInputValue(preloadedMessage);
      sessionStorage.removeItem('aiPreloadMessage'); // Clean up
    }
  }, []);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading || rateLimitRemaining <= 0) {
      return;
    }

    // If a pending action is active, detect whether this message is a confirmation.
    const confirming = pendingAction !== null && isConfirmationText(text);

    // Prevent double-execution: if this pending action was already submitted, skip.
    if (confirming && pendingAction && submittedActionIds.current.has(pendingAction.id)) {
      return;
    }

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setError(null);
    setIsLoading(true);
    setCommandState(confirming ? 'executing' : 'thinking');

    try {
      // Prepare messages for API (keep last 10 messages for context)
      const recentMessages = [...messages, userMessage].slice(-10);
      const apiMessages = recentMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Build request body: include pendingAction + confirmed when the user is confirming.
      const requestBody: Record<string, unknown> = { messages: apiMessages };
      if (confirming && pendingAction) {
        delete requestBody.messages;
        requestBody.proposalId = pendingAction.id;
        requestBody.decision = 'approve';
        // Mark as submitted before the request so rapid taps can’t duplicate it
        submittedActionIds.current.add(pendingAction.id);
      }

      const response = await fetch('/api/brain/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to get response');
      }

      const data = (await response.json()) as {
        message: string;
        role: string;
        proposal?: PendingAction;
      };

      // Add assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.message,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setRateLimitRemaining((prev) => Math.max(prev - 1, 0));

      if (data.proposal) {
        setPendingAction(data.proposal);
        setCommandState('confirming');
      } else {
        setPendingAction(null);
        setCommandState('done');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMessage);
      setCommandState('failed');
      // If the confirmation request failed, un-mark the action so the user can retry
      if (confirming && pendingAction) {
        submittedActionIds.current.delete(pendingAction.id);
      }
      console.error('Chat error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const cancelPendingAction = async () => {
    if (!pendingAction || isLoading) return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/brain/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: pendingAction.id, decision: 'reject' }),
      });
      if (!response.ok) throw new Error('Unable to cancel this action.');
      setPendingAction(null);
      setCommandState('idle');
      setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'assistant', content: 'Action cancelled.', timestamp: new Date() }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel this action.');
    } finally {
      setIsLoading(false);
    }
  };

  const editPendingAction = () => {
    // Pre-fill input with an edit suggestion
    const actionDesc = pendingAction ? describePendingAction(pendingAction) : null;
    const hint = actionDesc ? `Edit "${actionDesc.label}": ` : 'Edit: ';
    setInputValue(hint);
    // Keep pendingAction active so the AI knows what to update
  };

  const handleSuggestedQuestion = (question: string) => {
    sendMessage(question);
  };

  return (
    <div className="flex h-[calc(100dvh-5.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[30rem] max-w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0a0e27] via-[#1a1f3a] to-[#0d1117] sm:rounded-3xl lg:h-[calc(100dvh-3rem)]">
      {/* Header */}
      <div className="shrink-0 border-b border-cyan-500/10 bg-black/40 px-3 py-3 backdrop-blur-sm sm:px-6 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-400/10 ring-1 ring-cyan-400/30">
              <span className="text-lg font-black text-cyan-400">B</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Brain</h1>
              <p className="text-xs text-slate-400">Operational Intelligence</p>
            </div>
          </div>
          {/* Command state indicator */}
          {commandState !== 'idle' && (
            <div className="flex max-w-[45%] items-center gap-2 text-right">
              {commandState === 'thinking' && (
                <span className="flex items-center gap-1.5 text-xs text-cyan-400">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Thinking...
                </span>
              )}
              {commandState === 'confirming' && (
                <span className="flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertCircle className="w-3 h-3" />
                  Awaiting confirmation
                </span>
              )}
              {commandState === 'executing' && (
                <span className="flex items-center gap-1.5 text-xs text-blue-400">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Executing...
                </span>
              )}
              {commandState === 'done' && (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <CheckCircle2 className="w-3 h-3" />
                  Done
                </span>
              )}
              {commandState === 'failed' && (
                <span className="flex items-center gap-1.5 text-xs text-red-400">
                  <XCircle className="w-3 h-3" />
                  Failed
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages Container */}
      <div ref={messagesContainerRef} className="mobile-scroll-region min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center space-y-5 py-4 sm:space-y-8">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-400/10 ring-1 ring-cyan-400/20">
                <span className="text-4xl font-black text-cyan-400">B</span>
              </div>
              <h2 className="text-2xl font-bold text-white">Welcome to Brain</h2>
              <p className="mt-2 text-slate-400">
                Ask questions about your company data
              </p>
            </div>

            <div className="w-full max-w-md space-y-2">
              <p className="text-center text-sm font-medium text-slate-300">
                Suggested questions
              </p>
              <div className="grid gap-2">
                {SUGGESTED_QUESTIONS.map((question, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestedQuestion(question)}
                    className="min-h-11 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-2 text-left text-sm text-cyan-300 transition hover:border-cyan-500/40 hover:bg-cyan-500/10"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {message.role === 'assistant' && (
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 ring-1 ring-cyan-400/20">
                    <span className="text-xs font-black text-cyan-400">B</span>
                  </div>
                )}
                <div
                  className={`min-w-0 max-w-[min(85%,32rem)] rounded-lg px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-cyan-600/20 text-cyan-100'
                      : 'bg-slate-800/50 text-slate-100'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
                  <p className="mt-1 text-xs opacity-50">
                    {message.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 ring-1 ring-cyan-400/20">
                  <span className="text-xs font-black text-cyan-400">B</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-4 py-3">
                  <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                  <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse animation-delay-100" />
                  <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse animation-delay-200" />
                </div>
              </div>
            )}
            {error && (
              <div className="flex gap-3">
                <div className="flex-1 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Rate limit indicator */}
      {messages.length > 0 && (
        <div className="shrink-0 border-t border-slate-700/50 bg-black/40 px-3 py-2 text-xs text-slate-400 backdrop-blur-sm sm:px-6">
          Requests remaining: {rateLimitRemaining}
        </div>
      )}

      {/* Confirmation Card */}
      {pendingAction && (
        <div className="mobile-scroll-region max-h-[38dvh] shrink-0 overflow-y-auto border-t border-amber-500/30 bg-amber-950/20 px-3 py-3 backdrop-blur-sm sm:px-6 sm:py-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-amber-300">
                {describePendingAction(pendingAction).label} — Confirm before proceeding
              </p>
              <button
                onClick={cancelPendingAction}
                className="flex min-h-11 shrink-0 items-center gap-1 rounded px-3 py-1 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white"
              >
                <XCircle className="w-3 h-3" />
                Cancel
              </button>
            </div>
            {describePendingAction(pendingAction).rows.map((row) => (
              <div key={row.key} className="grid grid-cols-[minmax(5rem,0.35fr)_minmax(0,1fr)] items-start gap-3 text-sm">
                <span className="text-xs text-slate-500">{row.key}</span>
                <span className="break-words font-medium text-slate-200">{row.value}</span>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-1 sm:flex">
              <button
                onClick={() => sendMessage('Confirm')}
                disabled={isLoading}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-500 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                Confirm
              </button>
              <button
                onClick={editPendingAction}
                disabled={isLoading}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-700 disabled:opacity-50"
              >
                <Edit2 className="w-4 h-4" />
                Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="safe-area-bottom shrink-0 border-t border-cyan-500/10 bg-black/70 p-3 backdrop-blur-sm sm:p-6">
        <div className="flex gap-2 sm:gap-3">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(inputValue);
              }
            }}
            placeholder="Ask Brain anything about your company..."
            disabled={isLoading || rateLimitRemaining <= 0}
            aria-label="Message Brain"
            className="min-w-0 flex-1 rounded-lg border border-cyan-500/20 bg-slate-900/50 px-3 py-3 text-base text-white placeholder-slate-500 transition focus:border-cyan-500/50 focus:bg-slate-900 focus:outline-none disabled:opacity-50 sm:px-4"
          />
          <button
            onClick={() => sendMessage(inputValue)}
            disabled={isLoading || !inputValue.trim() || rateLimitRemaining <= 0}
            className="flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-cyan-600 to-cyan-500 px-4 py-3 font-medium text-white transition hover:from-cyan-500 hover:to-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 sm:px-6"
          >
            {isLoading ? (
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <span>Send</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
