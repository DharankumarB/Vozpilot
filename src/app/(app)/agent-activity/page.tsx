'use client';

/**
 * Agent activity audit log.
 */

import { useMemo, useState } from 'react';
import { Activity, ShieldCheck } from 'lucide-react';
import { Button, EmptyState, ErrorState, Pill, SkeletonList } from '@/components/ui';
import { useApi } from '@/components/hooks';
import { timeAgo } from '@/lib/utils/dates';
import type { AgentAction } from '@/lib/types';

const AGENTS = ['all', 'vozcore', 'vozgoal', 'vozproject', 'vozday', 'vozinbox'];
const STATUSES = ['all', 'success', 'failed', 'denied', 'skipped'];

const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  success: 'success',
  failed: 'danger',
  denied: 'warning',
  skipped: 'neutral',
  validated: 'neutral',
};

const PERMISSION_TONE: Record<string, 'neutral' | 'violet' | 'gold'> = {
  read: 'neutral',
  write: 'violet',
  sensitive: 'gold',
};

export default function AgentActivityPage() {
  const [agent, setAgent] = useState('all');
  const [status, setStatus] = useState('all');

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (agent !== 'all') params.set('agent', agent);
    if (status !== 'all') params.set('status', status);
    return `/api/agent-activity?${params.toString()}`;
  }, [agent, status]);

  const { data, error, loading, reload } = useApi<{ actions: AgentAction[]; availableAgents: string[] }>(url);

  const actions = data?.actions ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">Agent activity</h1>
          <p className="mt-1 text-sm text-text-secondary">Every tool call VozCore and its agents made, with permission level and result.</p>
        </div>
        <Button variant="secondary" onClick={reload}>
          Refresh
        </Button>
      </header>

      <div className="vp-card grid gap-3 p-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          Agent
          <select
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
            className="vp-input"
            aria-label="Filter by agent"
          >
            {AGENTS.map((option) => (
              <option key={option} value={option}>
                {option === 'all' ? 'All agents' : option}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          Result
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="vp-input"
            aria-label="Filter by result"
          >
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {option === 'all' ? 'All results' : option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <SkeletonList rows={5} /> : null}
      {error ? <ErrorState description={error} onRetry={reload} /> : null}

      {!loading && !error && actions.length === 0 ? (
        <EmptyState
          title="No agent activity yet"
          description="Ask VozCore something on the AI page and every action it takes will be logged here."
          icon={<Activity aria-hidden className="size-5" />}
        />
      ) : null}

      <ol className="flex flex-col gap-2">
        {actions.map((action) => (
          <li key={action.id} className="vp-card flex min-w-0 flex-col gap-2 p-3.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone="violet">{action.agent}</Pill>
              <Pill tone="neutral">{action.tool}</Pill>
              <Pill tone={PERMISSION_TONE[action.permission] ?? 'neutral'} icon={<ShieldCheck aria-hidden className="size-2.5" />}>
                {action.permission}
              </Pill>
              <Pill tone={STATUS_TONE[action.status] ?? 'neutral'}>{action.status}</Pill>
              <span className="text-[10px] text-text-muted">{timeAgo(action.created_at)}</span>
            </div>

            <p className="text-sm leading-relaxed break-words text-text-primary">{action.action || action.tool}</p>

            {action.reason ? <p className="text-[11px] break-words text-text-muted">{action.reason}</p> : null}
            {action.error ? <p className="text-[11px] break-words text-danger">{action.error}</p> : null}

            {action.entity_type && action.entity_id ? (
              <p className="text-[10px] text-text-muted">
                {action.entity_type} · {action.entity_id}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
