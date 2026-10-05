'use client';

/**
 * AIChat — the VozCore command centre.
 *
 * Desktop: conversation + live context rail. Tablet/mobile: conversation only,
 * with the composer docked above the mobile bottom nav so nothing is ever hidden
 * behind it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Bot, CheckCircle2, Loader2, Send, ShieldCheck, Sparkles, User } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Button, EmptyState, Pill, Skeleton } from './ui';
import { apiRequest, useApi } from './hooks';

interface ChatAction {
  tool: string;
  agent: string;
  permission: 'read' | 'write' | 'sensitive';
  status: string;
  summary: string;
  entityType?: string;
  entityId?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatAction[];
  pendingConfirmation?: { tool: string; args: Record<string, unknown>; preview: string } | null;
  clarification?: { question: string; options: Array<{ id: string; label: string }> } | null;
  provider?: { id: string; model: string; kind: 'llm' | 'deterministic'; reason: string };
  failed?: boolean;
}

const SUGGESTIONS = [
  'What should I do now?',
  'Plan my day',
  'Show my overdue tasks',
  'Which project is at risk?',
  'Create a goal to become job-ready',
  'Create a project called VozPilot',
  'Break my goal into milestones',
  'Move my ML task to tomorrow',
  'Mark API integration complete',
  'What are my priorities today?',
];

export function AIChat({ conversationId }: { conversationId?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<string | undefined>(conversationId);
  const [provider, setProvider] = useState<ChatMessage['provider'] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const context = useApi<{
    briefing: { headline: string; greeting: string };
    nextBestAction: { title: string; estimated_minutes: number | null; priority: string } | null;
    goals: Array<{ title: string; progress: number }>;
    projects: Array<{ title: string; health: { score: number } }>;
    unreadCount: number;
  }>('/api/dashboard');

  // Keep the newest message in view without hijacking the whole page.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, sending]);

  // Auto-grow the composer up to a sensible maximum.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }, [draft]);

  const send = async (text: string, confirmed = false) => {
    const message = text.trim();
    if (!message || sending) return;

    setError(null);
    setSending(true);
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: message };
    setMessages((current) => [...current, userMessage]);
    setDraft('');

    const result = await apiRequest<{
      reply: string;
      actions: ChatAction[];
      conversationId: string | null;
      clarification: ChatMessage['clarification'];
      pendingConfirmation: ChatMessage['pendingConfirmation'];
      provider: ChatMessage['provider'];
      stopped: string | null;
    }>('/api/ai/chat', 'POST', { message, conversation_id: conversation, confirmed });

    setSending(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? 'VozPilot AI could not be reached.');
      setMessages((current) => [
        ...current,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: result.error ?? 'VozPilot AI is temporarily unavailable. Your existing data is safe.',
          failed: true,
        },
      ]);
      return;
    }

    const payload = result.data;
    if (payload.conversationId) setConversation(payload.conversationId);
    if (payload.provider) setProvider(payload.provider);

    setMessages((current) => [
      ...current,
      {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: payload.reply,
        actions: payload.actions ?? [],
        pendingConfirmation: payload.pendingConfirmation ?? null,
        clarification: payload.clarification ?? null,
        provider: payload.provider,
      },
    ]);
  };

  const contextSummary = useMemo(() => {
    const briefing = context.data?.briefing;
    return {
      greeting: briefing?.greeting ?? 'Hello',
      headline: briefing?.headline ?? 'Loading your context…',
      next: context.data?.nextBestAction?.title ?? null,
      goals: context.data?.goals?.length ?? 0,
      projects: context.data?.projects?.length ?? 0,
      unread: context.data?.unreadCount ?? 0,
    };
  }, [context.data]);

  return (
    <div className="flex min-h-0 flex-col gap-4 xl:flex-row">
      {/* Conversation */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col vp-card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--vp-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-violet-soft" />
            <h2 className="text-sm font-semibold text-text-primary">VozCore</h2>
          </div>
          {provider ? (
            <Pill tone={provider.kind === 'llm' ? 'success' : 'violet'}>
              {provider.kind === 'llm' ? provider.id : 'Deterministic engine'}
            </Pill>
          ) : null}
        </header>

        <div ref={scrollRef} className="vp-scroll-area flex-1 space-y-4 p-4" style={{ minHeight: '16rem' }}>
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-6 text-center">
              <span aria-hidden className="grid size-10 place-items-center rounded-full bg-violet-accent/15 text-violet-soft">
                <Bot className="size-5" />
              </span>
              <h3 className="text-sm font-semibold text-text-primary">Ask VozPilot anything</h3>
              <p className="max-w-sm text-xs leading-relaxed text-text-muted">
                VozCore reads your real goals, projects, tasks and schedule, then acts through validated tools. Try one of
                the suggestions below.
              </p>
            </div>
          ) : null}

          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} onAnswer={(text) => send(text)} />
          ))}

          {sending ? (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Loader2 aria-hidden className="size-3.5 animate-spin" /> VozCore is working…
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-danger/30 bg-danger/10 p-3">
              <p className="flex items-center gap-2 text-xs text-danger">
                <AlertTriangle aria-hidden className="size-3.5" /> {error}
              </p>
              <Button size="sm" variant="secondary" className="self-start" onClick={() => setError(null)}>
                Dismiss
              </Button>
            </div>
          ) : null}
        </div>

        {/* Suggestions */}
        <div className="border-t border-[var(--vp-border)] px-4 pt-3">
          <div className="vp-scroll-area flex gap-2 overflow-x-auto pb-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                disabled={sending}
                className="shrink-0 rounded-full border border-[var(--vp-border-strong)] bg-ink-800/60 px-3 py-1.5 text-[11px] whitespace-nowrap text-text-secondary transition-colors hover:border-violet-accent/40 hover:text-text-primary disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        {/* Composer */}
        <form
          className="border-t border-[var(--vp-border)] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <div className="flex items-end gap-2">
            <label htmlFor="vp-chat-input" className="sr-only">
              Message VozCore
            </label>
            <textarea
              id="vp-chat-input"
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
              rows={1}
              placeholder="Ask VozPilot anything…"
              className="vp-input max-h-42 min-h-11 flex-1 resize-none py-2.5 leading-relaxed"
            />
            <Button
              type="submit"
              variant="primary"
              loading={sending}
              disabled={draft.trim().length === 0}
              aria-label="Send message"
              className="h-11 w-11 shrink-0 px-0"
            >
              {!sending ? <Send aria-hidden className="size-4" /> : null}
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-text-muted">
            VozCore only acts within the permissions you granted in Settings &gt; AI permissions.
          </p>
        </form>
      </section>

      {/* Context rail — desktop only */}
      <aside className="hidden w-72 shrink-0 flex-col gap-3 xl:flex">
        <div className="vp-card p-4">
          <p className="text-[11px] tracking-wide text-text-muted uppercase">Live context</p>
          {context.loading ? (
            <div className="mt-3 flex flex-col gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm leading-relaxed text-text-primary">{contextSummary.greeting}.</p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{contextSummary.headline}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                {[
                  ['Goals', contextSummary.goals],
                  ['Projects', contextSummary.projects],
                  ['Unread alerts', contextSummary.unread],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-[var(--radius-control)] bg-ink-800/60 px-2.5 py-2">
                    <dt className="text-[10px] tracking-wide text-text-muted uppercase">{label}</dt>
                    <dd className="mt-0.5 text-sm font-medium tabular-nums text-text-primary">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>

        {context.data?.nextBestAction ? (
          <div className="vp-card p-4">
            <p className="text-[11px] tracking-wide text-text-muted uppercase">Next best action</p>
            <p className="mt-2 text-sm leading-snug font-medium break-words text-text-primary">{context.data.nextBestAction.title}</p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => {
                void send('What should I do now?');
              }}
            >
              Explain why
            </Button>
          </div>
        ) : null}

        <div className="vp-card p-4">
          <p className="flex items-center gap-1.5 text-[11px] tracking-wide text-text-muted uppercase">
            <ShieldCheck aria-hidden className="size-3.5" /> Safety
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            Every action is validated, permission-checked and logged. VozCore never writes to the database directly and
            never runs more than its execution budget.
          </p>
        </div>
      </aside>
    </div>
  );
}

function MessageBubble({
  message,
  onAnswer,
}: {
  message: ChatMessage;
  onAnswer: (text: string) => void;
}) {
  const router = useRouter();
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}>
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full',
          isUser ? 'bg-ink-700 text-text-secondary' : 'bg-violet-accent/15 text-violet-soft',
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </span>

      <div className={cn('flex min-w-0 max-w-[92%] flex-col gap-2 sm:max-w-[80%]', isUser && 'items-end')}>
        <div
          className={cn(
            'rounded-[var(--radius-control)] px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap',
            isUser ? 'bg-violet-accent/16 text-text-primary' : 'bg-ink-800/70 text-text-secondary',
            message.failed && 'border border-danger/30 bg-danger/10 text-danger',
          )}
        >
          {message.content}
        </div>

        {message.actions && message.actions.length > 0 ? (
          <ul className="flex w-full flex-col gap-1.5">
            {message.actions.map((action, index) => (
              <li
                key={`${action.tool}-${index}`}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--vp-border)] bg-ink-850/60 px-3 py-2"
              >
                {action.status === 'success' ? (
                  <CheckCircle2 aria-hidden className="size-3.5 shrink-0 text-success" />
                ) : action.status === 'denied' ? (
                  <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-warning" />
                ) : (
                  <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-warning" />
                )}
                <span className="min-w-0 flex-1 text-[11px] leading-relaxed break-words text-text-secondary">
                  <span className="text-text-muted">{action.agent}</span> · {action.summary}
                </span>
                <Pill tone={action.permission === 'read' ? 'neutral' : action.permission === 'write' ? 'violet' : 'gold'}>
                  {action.permission}
                </Pill>
                {action.entityId && action.entityType === 'task' ? (
                  <button
                    type="button"
                    onClick={() => router.push('/tasks')}
                    className="shrink-0 text-[11px] text-violet-soft hover:underline"
                  >
                    View
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {message.clarification ? (
          <div className="flex w-full flex-col gap-2 rounded-[var(--radius-control)] border border-[var(--vp-border)] bg-ink-850/60 p-3">
            <p className="text-[11px] text-text-muted">Pick one:</p>
            <div className="flex flex-wrap gap-2">
              {message.clarification.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onAnswer(option.label)}
                  className="rounded-full border border-[var(--vp-border-strong)] bg-ink-800/60 px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:border-violet-accent/40 hover:text-text-primary"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {message.pendingConfirmation ? (
          <div className="flex w-full flex-col gap-2 rounded-[var(--radius-control)] border border-gold-accent/30 bg-gold-accent/8 p-3">
            <p className="text-[11px] leading-relaxed text-gold-soft">{message.pendingConfirmation.preview}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => onAnswer('Confirm')}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onAnswer('Cancel')}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AIEmptyState() {
  return <EmptyState title="VozCore is ready" description="Ask a question to get started." icon={<Sparkles className="size-5" />} />;
}
