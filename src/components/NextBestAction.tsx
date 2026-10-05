'use client';

/**
 * "What should I do now?" — the core VozPilot action.
 *
 * The recommendation is computed on the server from real goals, projects, tasks,
 * dependencies and the current plan. This component only presents it and offers
 * the follow-up actions.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarClock, CheckCircle2, Play, Timer, Zap } from 'lucide-react';
import { Button, EmptyState, Pill, ProgressBar } from './ui';
import { apiRequest, useApi } from './hooks';
import { formatDuration, relativeDueLabel } from '@/lib/utils/dates';
import type { Priority } from '@/lib/types';

export interface NextBestActionProps {
  taskId: string | null;
  title: string | null;
  priority: Priority | null;
  estimatedMinutes: number | null;
  dueDate: string | null;
  reason: string | null;
  projectId: string | null;
  timezone: string;
}

export function NextBestAction({
  taskId,
  title,
  priority,
  estimatedMinutes,
  dueDate,
  reason,
  projectId,
  timezone,
}: NextBestActionProps) {
  const router = useRouter();
  const [completing, setCompleting] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [done, setDone] = useState(false);

  const complete = async () => {
    if (!taskId) return;
    setCompleting(true);
    const result = await apiRequest(`/api/tasks/${taskId}/complete`, 'POST', {
      actual_minutes: estimatedMinutes ?? undefined,
    });
    setCompleting(false);
    if (result.ok) {
      setDone(true);
      router.refresh();
    }
  };

  const reschedule = async () => {
    if (!taskId) return;
    setRescheduling(true);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const result = await apiRequest(`/api/tasks/${taskId}`, 'PATCH', {
      due_date: tomorrow.toISOString(),
      scheduled_date: tomorrow.toISOString().slice(0, 10),
    });
    setRescheduling(false);
    if (result.ok) router.refresh();
  };

  if (!taskId || !title) {
    return (
      <EmptyState
        title="No next action yet"
        description="Once you have open tasks, VozPilot will rank them by deadline, importance, project risk and dependencies."
        icon={<Zap aria-hidden className="size-5" />}
      />
    );
  }

  return (
    <section className="vp-card relative overflow-hidden p-4 sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-violet-accent/10 blur-3xl" />

      <div className="relative flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-violet-soft uppercase">
            <Zap aria-hidden className="size-3.5" /> Next best action
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {priority ? <Pill tone={priority === 'critical' ? 'danger' : priority === 'high' ? 'warning' : 'violet'}>{priority}</Pill> : null}
            {estimatedMinutes ? (
              <Pill tone="neutral" icon={<Timer aria-hidden className="size-2.5" />}>
                {formatDuration(estimatedMinutes)}
              </Pill>
            ) : null}
            <Pill tone="neutral" icon={<CalendarClock aria-hidden className="size-2.5" />}>
              {relativeDueLabel(dueDate, timezone)}
            </Pill>
          </div>
        </div>

        <div className="min-w-0">
          <h2 className="text-lg leading-snug font-semibold break-words text-text-primary sm:text-xl">{title}</h2>
          {reason ? <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">{reason}</p> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={complete} loading={completing} disabled={done} icon={<CheckCircle2 aria-hidden className="size-3.5" />}>
            {done ? 'Completed' : 'Mark complete'}
          </Button>
          <Button variant="secondary" size="sm" onClick={reschedule} loading={rescheduling}>
            Reschedule
          </Button>
          {projectId ? (
            <Link
              href={`/projects/${projectId}`}
              className="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-[var(--vp-border-strong)] px-3 text-xs text-text-secondary transition-colors hover:border-violet-accent/40 hover:text-text-primary"
            >
              View project
            </Link>
          ) : null}
          <Link
            href="/ai"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-xs text-violet-soft transition-colors hover:bg-ink-800"
          >
            <Play aria-hidden className="size-3" /> Ask VozCore why
          </Link>
        </div>

        {done ? (
          <p className="flex items-center gap-2 text-xs text-success" role="status">
            <CheckCircle2 aria-hidden className="size-3.5" /> Done — project and goal progress have been recalculated.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Full "what should I do now?" panel with alternatives, used on the AI page. */
export function NextBestActionPanel({ timezone }: { timezone: string }) {
  const { data, loading, error, reload } = useApi<{
    recommendation: {
      task_id: string;
      title: string;
      priority: Priority;
      estimated_minutes: number | null;
      due_date: string | null;
      project: string | null;
      project_id: string | null;
      goal: string | null;
      reason: string;
      blocks_count: number;
    } | null;
    alternatives: Array<{ task_id: string; title: string; score: number; estimated_minutes: number | null }>;
    openTaskCount: number;
    overdueCount: number;
    message?: string;
  }>('/api/ai/next-best-action');

  if (loading) {
    return (
      <div className="vp-card p-4">
        <ProgressBar value={45} label="Loading" showValue={false} />
      </div>
    );
  }

  if (error) return <EmptyState title="Could not compute your next action" description={error} action={<Button size="sm" onClick={reload}>Retry</Button>} />;

  if (!data?.recommendation) {
    return (
      <EmptyState
        title="Nothing is waiting on you"
        description={data?.message ?? 'Capture a goal or project and VozPilot will build your first plan.'}
        icon={<Zap aria-hidden className="size-5" />}
      />
    );
  }

  const recommendation = data.recommendation;

  return (
    <div className="flex flex-col gap-3">
      <NextBestAction
        taskId={recommendation.task_id}
        title={recommendation.title}
        priority={recommendation.priority}
        estimatedMinutes={recommendation.estimated_minutes}
        dueDate={recommendation.due_date}
        reason={recommendation.reason}
        projectId={recommendation.project_id}
        timezone={timezone}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {[
          ['Open tasks', data.openTaskCount],
          ['Overdue', data.overdueCount],
          ['Blocking others', recommendation.blocks_count],
        ].map(([label, value]) => (
          <div key={String(label)} className="vp-card px-3 py-2.5">
            <p className="text-[10px] tracking-wide text-text-muted uppercase">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">{value}</p>
          </div>
        ))}
      </div>

      {data.alternatives.length > 0 ? (
        <div className="vp-card p-4">
          <p className="text-[11px] tracking-wide text-text-muted uppercase">Runner-ups</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {data.alternatives.map((alternative) => (
              <li key={alternative.task_id} className="flex min-w-0 items-center justify-between gap-3 text-xs">
                <span className="min-w-0 flex-1 truncate text-text-secondary">{alternative.title}</span>
                <span className="shrink-0 tabular-nums text-text-muted">score {alternative.score}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
