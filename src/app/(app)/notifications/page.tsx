'use client';

/**
 * Notification centre with category filters.
 */

import { useMemo, useState } from 'react';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { Button, EmptyState, ErrorState, Pill, SkeletonList, useToast } from '@/components/ui';
import { apiRequest, useApi } from '@/components/hooks';
import { timeAgo } from '@/lib/utils/dates';
import type { Notification } from '@/lib/types';

const FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'projects', label: 'Projects' },
  { value: 'goals', label: 'Goals' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'system', label: 'System' },
];

const PRIORITY_TONE: Record<string, 'danger' | 'warning' | 'violet' | 'neutral'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'violet',
  low: 'neutral',
};

const TYPE_LABEL: Record<string, string> = {
  deadline_approaching: 'Deadline approaching',
  task_overdue: 'Task overdue',
  project_at_risk: 'Project at risk',
  goal_milestone: 'Goal milestone',
  inbox_action: 'Inbox action',
  daily_briefing: 'Daily briefing',
  schedule_conflict: 'Schedule conflict',
  next_task: 'Next task',
  agent_action: 'Agent action',
  system: 'System',
};

export default function NotificationsPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState('all');

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (filter === 'unread') params.set('unread', '1');
    else if (filter !== 'all') params.set('category', filter);
    return `/api/notifications?${params.toString()}`;
  }, [filter]);

  const { data, error, loading, reload } = useApi<{ notifications: Notification[]; unreadCount: number }>(url);

  const markRead = async (id: string) => {
    const result = await apiRequest(`/api/notifications/${id}/read`, 'POST', {});
    if (result.ok) reload();
  };

  const markAll = async () => {
    const result = await apiRequest('/api/notifications/read-all', 'POST', {});
    if (result.ok) {
      toast('All notifications marked as read.');
      reload();
    } else {
      toast(result.error ?? 'Could not update notifications.', 'error');
    }
  };

  const notifications = data?.notifications ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">Notifications</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {data?.unreadCount ?? 0} unread. WhatsApp delivery is paused for this version; web notifications are active.
          </p>
        </div>
        <Button variant="secondary" icon={<CheckCheck aria-hidden className="size-3.5" />} onClick={markAll} disabled={notifications.length === 0}>
          Mark all read
        </Button>
      </header>

      <div className="vp-scroll-area flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filter === option.value
                ? 'border-violet-accent/50 bg-violet-accent/15 text-violet-soft'
                : 'border-[var(--vp-border-strong)] text-text-secondary hover:text-text-primary'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading ? <SkeletonList rows={4} /> : null}
      {error ? <ErrorState description={error} onRetry={reload} /> : null}

      {!loading && !error && notifications.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description="Deadline alerts, project risks, goal milestones and daily briefings will appear in this list."
          icon={<Bell aria-hidden className="size-5" />}
        />
      ) : null}

      <ul className="flex flex-col gap-2">
        {notifications.map((notification) => (
          <li key={notification.id}>
            <article
              className={`vp-card flex min-w-0 flex-col gap-2 p-3.5 sm:flex-row sm:items-start sm:gap-3 ${
                notification.read_at ? 'opacity-70' : 'border-violet-accent/25'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={PRIORITY_TONE[notification.priority] ?? 'neutral'}>{notification.priority}</Pill>
                  <Pill tone="neutral">{TYPE_LABEL[notification.type] ?? notification.type}</Pill>
                  <span className="text-[10px] text-text-muted">{timeAgo(notification.created_at)}</span>
                  {!notification.read_at ? <span aria-label="Unread" className="size-1.5 rounded-full bg-violet-accent" /> : null}
                </div>
                <h2 className="mt-1.5 text-sm font-medium break-words text-text-primary">{notification.title}</h2>
                {notification.body ? <p className="mt-1 text-xs leading-relaxed break-words text-text-muted">{notification.body}</p> : null}
              </div>

              <div className="flex shrink-0 gap-2">
                {notification.action_url ? (
                  <a
                    href={notification.action_url}
                    className="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-[var(--vp-border-strong)] px-3 text-[11px] text-text-secondary transition-colors hover:border-violet-accent/40 hover:text-text-primary"
                  >
                    Open
                  </a>
                ) : null}
                {!notification.read_at ? (
                  <Button size="sm" variant="ghost" icon={<Check aria-hidden className="size-3.5" />} onClick={() => markRead(notification.id)}>
                    Read
                  </Button>
                ) : null}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
