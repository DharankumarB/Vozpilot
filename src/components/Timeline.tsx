'use client';

/**
 * Timeline — today's plan rendered as a vertical schedule.
 */

import { Coffee, Lock, Target } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatTime } from '@/lib/utils/dates';
import type { TimeBlock } from '@/lib/types';

const KIND_STYLES: Record<string, { dot: string; label: string }> = {
  focus: { dot: 'bg-violet-accent', label: 'Focus' },
  commitment: { dot: 'bg-gold-accent', label: 'Commitment' },
  break: { dot: 'bg-success', label: 'Break' },
  buffer: { dot: 'bg-info', label: 'Buffer' },
  review: { dot: 'bg-violet-soft', label: 'Review' },
};

export function Timeline({
  blocks,
  timezone,
  emptyLabel = 'No plan yet.',
  onBlockClick,
}: {
  blocks: TimeBlock[];
  timezone: string;
  emptyLabel?: string;
  onBlockClick?: (block: TimeBlock) => void;
}) {
  if (blocks.length === 0) {
    return <p className="py-6 text-center text-xs text-text-muted">{emptyLabel}</p>;
  }

  return (
    <ol className="relative flex flex-col gap-0">
      {blocks.map((block, index) => {
        const style = KIND_STYLES[block.kind] ?? KIND_STYLES.focus;
        const minutes = Math.max(0, (new Date(block.end_at).getTime() - new Date(block.start_at).getTime()) / 60000);
        const Icon = block.kind === 'break' ? Coffee : block.kind === 'commitment' ? Lock : Target;

        return (
          <li key={block.id} className="relative flex gap-3 pb-3 last:pb-0">
            {/* Connector line */}
            {index < blocks.length - 1 ? (
              <span aria-hidden className="absolute top-5 bottom-0 left-[7px] w-px bg-[var(--vp-border-strong)]" />
            ) : null}

            <span aria-hidden className={cn('mt-1.5 size-3.5 shrink-0 rounded-full ring-4 ring-ink-950', style.dot)} />

            <button
              type="button"
              onClick={() => onBlockClick?.(block)}
              disabled={!onBlockClick}
              className={cn(
                'min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--vp-border)] bg-ink-850/60 px-3 py-2 text-left transition-colors',
                onBlockClick && 'hover:border-violet-accent/40',
                block.status === 'completed' && 'opacity-60',
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-text-primary">{block.title}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-text-muted">{Math.round(minutes)}m</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                <Icon aria-hidden className="size-3 shrink-0" />
                <span className="tabular-nums">
                  {formatTime(block.start_at, timezone)} – {formatTime(block.end_at, timezone)}
                </span>
                <span aria-hidden>·</span>
                <span>{style.label}</span>
                {block.status !== 'planned' ? <span aria-hidden>·</span> : null}
                {block.status !== 'planned' ? <span className="capitalize">{block.status}</span> : null}
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
