'use client';

/**
 * Entity cards shared across the dashboard, list pages and detail pages.
 */

import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Flag,
  FolderKanban,
  Inbox as InboxIcon,
  Paperclip,
  Target,
  Timer,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatDuration, relativeDueLabel } from '@/lib/utils/dates';
import { PRIORITY_TONE, Pill, ProgressBar, STATUS_LABEL, STATUS_TONE } from './ui';
import type { Goal, InboxItem, Priority, Project, Task } from '@/lib/types';

export function PriorityPill({ priority }: { priority: Priority }) {
  return (
    <Pill tone={PRIORITY_TONE[priority] ?? 'neutral'} icon={<Flag aria-hidden className="size-2.5" />}>
      {priority}
    </Pill>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? status}</Pill>;
}

export function TaskCard({
  task,
  timezone,
  onComplete,
  onSelect,
  selected,
  showProject = true,
  projectTitle,
  goalTitle,
  isBlocked,
}: {
  task: Task;
  timezone: string;
  onComplete?: (task: Task) => void;
  onSelect?: (task: Task) => void;
  selected?: boolean;
  showProject?: boolean;
  projectTitle?: string | null;
  goalTitle?: string | null;
  isBlocked?: boolean;
}) {
  const done = task.status === 'completed';
  const overdue = !done && task.due_date ? new Date(task.due_date) < new Date() : false;

  return (
    <article
      className={cn(
        'vp-card flex flex-col gap-3 p-3.5 transition-colors duration-150 sm:p-4',
        selected && 'border-violet-accent/50 bg-violet-accent/5',
        done && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        {onComplete ? (
          <button
            type="button"
            onClick={() => onComplete(task)}
            aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
            aria-pressed={done}
            className="mt-0.5 shrink-0 rounded-full text-text-muted transition-colors hover:text-success"
          >
            {done ? <CheckCircle2 aria-hidden className="size-5 text-success" /> : <CircleDot aria-hidden className="size-5" />}
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          <h3 className={cn('text-sm leading-snug font-medium break-words text-text-primary', done && 'line-through')}>
            {task.title}
          </h3>
          {task.description ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed break-words text-text-muted">{task.description}</p>
          ) : null}
        </div>

        {onSelect ? (
          <button
            type="button"
            onClick={() => onSelect(task)}
            className="shrink-0 rounded-[var(--radius-control)] border border-[var(--vp-border-strong)] px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-violet-accent/40 hover:text-text-primary"
          >
            Edit
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityPill priority={task.priority} />
        <StatusPill status={task.status} />
        {isBlocked ? (
          <Pill tone="danger" icon={<AlertTriangle aria-hidden className="size-2.5" />}>
            Blocked
          </Pill>
        ) : null}
        {task.estimated_minutes ? (
          <Pill tone="neutral" icon={<Timer aria-hidden className="size-2.5" />}>
            {formatDuration(task.estimated_minutes)}
          </Pill>
        ) : null}
        <Pill tone={overdue ? 'danger' : 'neutral'} icon={<CalendarClock aria-hidden className="size-2.5" />}>
          {relativeDueLabel(task.due_date, timezone)}
        </Pill>
        {task.tags?.slice(0, 2).map((tag) => (
          <Pill key={tag} tone="neutral">
            {tag}
          </Pill>
        ))}
      </div>

      {showProject && (projectTitle || goalTitle) ? (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
          {projectTitle ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <FolderKanban aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{projectTitle}</span>
            </span>
          ) : null}
          {goalTitle ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Target aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{goalTitle}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function GoalCard({
  goal,
  projectCount = 0,
  milestoneCount = 0,
  health,
}: {
  goal: Goal;
  projectCount?: number;
  milestoneCount?: number;
  health?: { score: number; label: string; reasons: string[]; metrics: { progress: number; overdueTasks: number } };
}) {
  return (
    <article className="vp-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/goals/${goal.id}`} className="text-sm font-semibold break-words text-text-primary hover:text-violet-soft">
            {goal.title}
          </Link>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {goal.category} · target {goal.target_date ? new Date(goal.target_date).toLocaleDateString() : 'not set'}
          </p>
        </div>
        <StatusPill status={goal.status} />
      </div>

      <ProgressBar value={health?.metrics.progress ?? goal.progress} label={`${goal.title} progress`} />

      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone="neutral" icon={<FolderKanban aria-hidden className="size-2.5" />}>
          {projectCount} project{projectCount === 1 ? '' : 's'}
        </Pill>
        <Pill tone="neutral" icon={<Target aria-hidden className="size-2.5" />}>
          {milestoneCount} milestone{milestoneCount === 1 ? '' : 's'}
        </Pill>
        {health ? (
          <Pill tone={health.score >= 70 ? 'success' : health.score >= 50 ? 'warning' : 'danger'}>Health {health.score}%</Pill>
        ) : null}
      </div>

      {health?.reasons?.[0] ? <p className="text-[11px] leading-relaxed text-text-muted">{health.reasons[0]}</p> : null}
    </article>
  );
}

export function ProjectCard({
  project,
  goalTitle,
  health,
}: {
  project: Project;
  goalTitle?: string | null;
  health?: {
    score: number;
    label: string;
    reasons: string[];
    metrics: { progress: number; openTasks: number; completedTasks: number; overdueTasks: number; dueSoonTasks: number };
  };
}) {
  return (
    <article className="vp-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/projects/${project.id}`} className="text-sm font-semibold break-words text-text-primary hover:text-violet-soft">
            {project.title}
          </Link>
          <p className="mt-0.5 truncate text-[11px] text-text-muted">{goalTitle ? `Goal: ${goalTitle}` : 'No goal linked'}</p>
        </div>
        <StatusPill status={project.status} />
      </div>

      <ProgressBar value={health?.metrics.progress ?? project.progress} label={`${project.title} progress`} />

      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone="neutral">{health?.metrics.openTasks ?? 0} open</Pill>
        <Pill tone="success">{health?.metrics.completedTasks ?? 0} done</Pill>
        {(health?.metrics.overdueTasks ?? 0) > 0 ? <Pill tone="danger">{health?.metrics.overdueTasks} overdue</Pill> : null}
        {(health?.metrics.dueSoonTasks ?? 0) > 0 ? <Pill tone="warning">{health?.metrics.dueSoonTasks} due soon</Pill> : null}
        {health ? (
          <Pill tone={health.score >= 70 ? 'success' : health.score >= 50 ? 'warning' : 'danger'}>
            {health.score}% health
          </Pill>
        ) : null}
      </div>

      {health?.reasons?.[0] ? <p className="text-[11px] leading-relaxed text-text-muted">{health.reasons[0]}</p> : null}
    </article>
  );
}

export function ProjectHealthPanel({
  score,
  label,
  reasons,
  metrics,
}: {
  score: number;
  label: string;
  reasons: string[];
  metrics: { progress: number; openTasks: number; completedTasks: number; overdueTasks: number; dueSoonTasks: number; blockedTasks: number };
}) {
  return (
    <div className="vp-card flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] tracking-wide text-text-muted uppercase">Project health</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-text-primary">{score}%</p>
        </div>
        <Pill tone={score >= 70 ? 'success' : score >= 50 ? 'warning' : 'danger'}>{label.replace('_', ' ')}</Pill>
      </div>

      <ProgressBar value={score} tone={score >= 70 ? 'success' : score >= 50 ? 'warning' : 'danger'} label="Health score" />

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        {[
          ['Open', metrics.openTasks],
          ['Completed', metrics.completedTasks],
          ['Overdue', metrics.overdueTasks],
          ['Due soon', metrics.dueSoonTasks],
          ['Blocked', metrics.blockedTasks],
          ['Progress', `${metrics.progress}%`],
        ].map(([labelText, value]) => (
          <div key={String(labelText)} className="rounded-[var(--radius-control)] bg-ink-800/60 px-2.5 py-2">
            <dt className="text-[10px] tracking-wide text-text-muted uppercase">{labelText}</dt>
            <dd className="mt-0.5 text-sm font-medium tabular-nums text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>

      <ul className="flex flex-col gap-1.5">
        {reasons.map((reason) => (
          <li key={reason} className="flex gap-2 text-[11px] leading-relaxed text-text-secondary">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-violet-accent" />
            <span className="min-w-0 break-words">{reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function InboxCard({
  item,
  onAnalyse,
  onDismiss,
  analysing,
}: {
  item: InboxItem;
  onAnalyse?: (item: InboxItem) => void;
  onDismiss?: (item: InboxItem) => void;
  analysing?: boolean;
}) {
  const analysis = item.analysis;

  return (
    <article className="vp-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium break-words text-text-primary">{item.subject || 'Untitled message'}</h3>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {item.sender ? `${item.sender} · ` : ''}
            {new Date(item.received_at).toLocaleString()}
          </p>
        </div>
        <Pill tone={item.status === 'actioned' ? 'success' : item.status === 'analyzed' ? 'violet' : 'neutral'}>{item.status}</Pill>
      </div>

      <p className="line-clamp-3 text-xs leading-relaxed break-words text-text-secondary">{item.body}</p>

      {analysis ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-ink-800/50 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone="violet">{analysis.intent}</Pill>
            <Pill tone={PRIORITY_TONE[analysis.priority] ?? 'neutral'}>{analysis.priority}</Pill>
            <Pill tone={analysis.confidence >= 0.6 ? 'success' : 'warning'}>
              {Math.round(analysis.confidence * 100)}% confidence
            </Pill>
            {analysis.deadline ? (
              <Pill tone="gold" icon={<CalendarClock aria-hidden className="size-2.5" />}>
                {new Date(analysis.deadline).toLocaleDateString()}
              </Pill>
            ) : null}
          </div>
          <p className="text-[11px] leading-relaxed text-text-muted">{analysis.reasoning}</p>
          {analysis.matched_project_title ? (
            <p className="inline-flex items-center gap-1 text-[11px] text-text-secondary">
              <Paperclip aria-hidden className="size-3" /> {analysis.matched_project_title}
            </p>
          ) : null}
          {analysis.actions.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {analysis.actions.map((action) => (
                <li key={action.title} className="flex gap-2 text-[11px] text-text-secondary">
                  <InboxIcon aria-hidden className="mt-0.5 size-3 shrink-0 text-violet-soft" />
                  <span className="min-w-0 break-words">{action.title}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {onAnalyse || onDismiss ? (
        <div className="flex flex-wrap gap-2">
          {onAnalyse ? (
            <button
              type="button"
              onClick={() => onAnalyse(item)}
              disabled={analysing}
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--vp-border-strong)] px-3 text-xs text-text-secondary transition-colors hover:border-violet-accent/40 hover:text-text-primary disabled:opacity-50"
            >
              <InboxIcon aria-hidden className="size-3.5" />
              {analysing ? 'Analysing…' : analysis ? 'Re-analyse' : 'Analyse'}
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={() => onDismiss(item)}
              className="inline-flex h-9 items-center rounded-[var(--radius-control)] px-3 text-xs text-text-muted transition-colors hover:text-text-primary"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
