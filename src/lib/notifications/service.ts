/**
 * Central notification engine.
 *
 * Every notification in the product is produced here so that preference
 * filtering, priority rules, quiet hours, de-duplication and channel routing are
 * applied consistently. Channels are pluggable: the web channel ships today;
 * WhatsApp is deliberately NOT implemented in this version but the registry is
 * ready for it, so VozCore never needs to change to add a new channel.
 */

import type {
  Notification,
  NotificationPriority,
  NotificationType,
  UserPreferences,
} from '../types';
import type { DbClient } from '../db/client';
import { createNotification, listNotifications } from '../db/repositories';

export interface EmitNotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  priority?: NotificationPriority;
  entityType?: string | null;
  entityId?: string | null;
  actionUrl?: string | null;
  /** Skip the de-duplication window (used by tests and one-off system messages). */
  force?: boolean;
}

export interface EmitResult {
  created: Notification | null;
  skipped: null | 'preference_off' | 'duplicate' | 'quiet_hours' | 'error';
  reason?: string;
}

const TYPE_PREFERENCE: Partial<Record<NotificationType, keyof UserPreferences>> = {
  deadline_approaching: 'deadline_alerts',
  task_overdue: 'deadline_alerts',
  schedule_conflict: 'deadline_alerts',
  next_task: 'deadline_alerts',
  project_at_risk: 'project_alerts',
  goal_milestone: 'goal_alerts',
  inbox_action: 'inbox_alerts',
  daily_briefing: 'briefing_enabled',
  agent_action: 'agent_alerts',
};

const TYPE_CATEGORY: Record<NotificationType, Notification['category']> = {
  deadline_approaching: 'tasks',
  task_overdue: 'tasks',
  project_at_risk: 'projects',
  goal_milestone: 'goals',
  inbox_action: 'inbox',
  daily_briefing: 'system',
  schedule_conflict: 'tasks',
  next_task: 'tasks',
  agent_action: 'system',
  system: 'system',
};

const PRIORITY_RANK: Record<NotificationPriority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

function withinQuietHours(preferences: UserPreferences, now: Date, timezone: string): boolean {
  if (!preferences.quiet_hours_start || !preferences.quiet_hours_end) return false;
  const current = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const { quiet_hours_start: start, quiet_hours_end: end } = preferences;
  // Windows that do not wrap midnight.
  if (start <= end) return current >= start && current <= end;
  // Windows that wrap midnight (e.g. 22:00 → 07:00).
  return current >= start || current <= end;
}

export interface NotificationEngineOptions {
  dedupeWindowHours?: number;
  now?: Date;
}

export async function emitNotification(
  db: DbClient,
  userId: string,
  input: EmitNotificationInput,
  preferences: UserPreferences | null,
  options: NotificationEngineOptions = {},
): Promise<EmitResult> {
  const now = options.now ?? new Date();
  const priority = input.priority ?? 'medium';

  if (preferences) {
    const flag = TYPE_PREFERENCE[input.type];
    if (flag && preferences[flag] === false) {
      return { created: null, skipped: 'preference_off', reason: `${String(flag)} is disabled` };
    }
    // Only low/medium noise is suppressed during quiet hours — critical alerts always land.
    if (PRIORITY_RANK[priority] <= PRIORITY_RANK.medium && withinQuietHours(preferences, now, preferences.timezone)) {
      return { created: null, skipped: 'quiet_hours', reason: 'inside quiet hours' };
    }
  }

  // Duplicate protection: same entity + type inside the window is collapsed.
  if (!input.force && input.entityId) {
    const windowHours = options.dedupeWindowHours ?? 12;
    const cutoff = new Date(now.getTime() - windowHours * 3_600_000).toISOString();
    const existing = await listNotifications(db, userId, { limit: 30 });
    if (existing.data) {
      const duplicate = existing.data.find(
        (notification) =>
          notification.type === input.type &&
          notification.entity_id === input.entityId &&
          notification.created_at >= cutoff,
      );
      if (duplicate) return { created: null, skipped: 'duplicate', reason: `already notified at ${duplicate.created_at}` };
    }
  }

  const result = await createNotification(db, userId, {
    type: input.type,
    category: TYPE_CATEGORY[input.type],
    priority,
    title: input.title,
    body: input.body ?? '',
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    action_url: input.actionUrl ?? null,
  });

  if (result.error || !result.data) {
    return { created: null, skipped: 'error', reason: result.error?.message };
  }

  await dispatchToChannels(result.data);
  return { created: result.data, skipped: null };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
export interface NotificationChannel {
  readonly id: 'web' | 'whatsapp' | 'email' | 'push';
  readonly label: string;
  readonly enabled: boolean;
  readonly configured: boolean;
  send(notification: Notification): Promise<{ delivered: boolean; reason?: string }>;
}

class WebChannel implements NotificationChannel {
  readonly id = 'web' as const;
  readonly label = 'Web notifications';
  readonly enabled = true;
  readonly configured = true;
  async send(): Promise<{ delivered: boolean }> {
    // The row is already persisted; the notification centre and the toast system
    // read from the database, so delivery is a database write.
    return { delivered: true };
  }
}

/**
 * WhatsApp is intentionally unimplemented in this version. The channel exists so
 * the registry shape is proven and VozCore needs no changes to enable it later.
 */
class WhatsAppChannel implements NotificationChannel {
  readonly id = 'whatsapp' as const;
  readonly label = 'WhatsApp';
  readonly enabled = false;
  readonly configured = false;
  async send(): Promise<{ delivered: boolean; reason: string }> {
    return { delivered: false, reason: 'WhatsApp delivery is paused for this version.' };
  }
}

export const channels: NotificationChannel[] = [new WebChannel(), new WhatsAppChannel()];

export function getChannel(id: NotificationChannel['id']): NotificationChannel | undefined {
  return channels.find((channel) => channel.id === id);
}

export async function dispatchToChannels(notification: Notification): Promise<void> {
  for (const channel of channels) {
    if (!channel.enabled) continue;
    try {
      await channel.send(notification);
    } catch {
      // A channel failure must never break the request that produced the event.
    }
  }
}

/** Event-driven helpers used across the app so call sites stay one-liners. */
export const notify = {
  deadlineApproaching: (title: string, body: string, entityId: string) => ({
    type: 'deadline_approaching' as const,
    title,
    body,
    priority: 'high' as const,
    entityType: 'task',
    entityId,
    actionUrl: '/tasks',
  }),
  taskOverdue: (title: string, entityId: string) => ({
    type: 'task_overdue' as const,
    title: `Overdue: ${title}`,
    body: 'This task is past its due date.',
    priority: 'high' as const,
    entityType: 'task',
    entityId,
    actionUrl: '/tasks',
  }),
  projectAtRisk: (title: string, reason: string, entityId: string) => ({
    type: 'project_at_risk' as const,
    title: `Project at risk: ${title}`,
    body: reason,
    priority: 'high' as const,
    entityType: 'project',
    entityId,
    actionUrl: `/projects/${entityId}`,
  }),
  goalMilestone: (title: string, entityId: string) => ({
    type: 'goal_milestone' as const,
    title: `Milestone reached: ${title}`,
    body: 'A goal milestone has been completed.',
    priority: 'medium' as const,
    entityType: 'goal',
    entityId,
    actionUrl: `/goals/${entityId}`,
  }),
  inboxAction: (title: string, entityId: string) => ({
    type: 'inbox_action' as const,
    title: `Action needed: ${title}`,
    body: 'VozInbox detected an action in a new inbox item.',
    priority: 'medium' as const,
    entityType: 'inbox_item',
    entityId,
    actionUrl: '/inbox',
  }),
  dailyBriefing: (title: string, body: string) => ({
    type: 'daily_briefing' as const,
    title,
    body,
    priority: 'medium' as const,
    entityType: null,
    entityId: null,
    actionUrl: '/dashboard',
  }),
  scheduleConflict: (title: string, body: string) => ({
    type: 'schedule_conflict' as const,
    title,
    body,
    priority: 'high' as const,
    entityType: null,
    entityId: null,
    actionUrl: '/calendar',
  }),
  nextTask: (title: string, entityId: string) => ({
    type: 'next_task' as const,
    title: `Next: ${title}`,
    body: 'This is your next best action.',
    priority: 'medium' as const,
    entityType: 'task',
    entityId,
    actionUrl: '/tasks',
  }),
  agentAction: (title: string, body: string) => ({
    type: 'agent_action' as const,
    title,
    body,
    priority: 'low' as const,
    entityType: null,
    entityId: null,
    actionUrl: '/agent-activity',
  }),
};
