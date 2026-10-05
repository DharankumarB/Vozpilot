import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabase/client';
import { buildDailyBriefing } from '../../../../lib/engine/briefing';
import { emitNotification, notify } from '../../../../lib/notifications/service';
import { todayInZone } from '../../../../lib/utils/dates';
import type { DbClient } from '../../../../lib/db/client';
import type { Goal, GoalMilestone, Notification, Project, ProjectMilestone, Task, TimeBlock, UserPreferences } from '../../../../lib/types';

export const dynamic = 'force-dynamic';

/**
 * Daily briefing fan-out.
 *
 * Protected by CRON_SECRET so it cannot be triggered from the public internet.
 * Uses the service-role client because it must iterate over every user; every
 * write it performs is still scoped to that user's own rows.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (!secret || provided !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const admin = createAdminClient() as unknown as DbClient;

  const usersResult = await admin
    .from<{ user_id: string; timezone: string; briefing_enabled: boolean }>('user_preferences')
    .select('user_id, timezone, briefing_enabled');
  const users = usersResult.data ?? [];

  let sent = 0;

  for (const user of users) {
    if (user.briefing_enabled === false) continue;
    const timezone = user.timezone ?? 'UTC';
    const today = todayInZone(timezone);

    const [goals, projects, tasks, notifications, inboxItems, goalMilestones, projectMilestones, blocks] = await Promise.all([
      admin.from<Goal>('goals').select('*').eq('user_id', user.user_id),
      admin.from<Project>('projects').select('*').eq('user_id', user.user_id),
      admin.from<Task>('tasks').select('*').eq('user_id', user.user_id).limit(300),
      admin.from<Notification>('notifications').select('*').eq('user_id', user.user_id).order('created_at', { ascending: false }).limit(20),
      admin.from('inbox_items').select('*').eq('user_id', user.user_id),
      admin.from<GoalMilestone>('goal_milestones').select('*').eq('user_id', user.user_id),
      admin.from<ProjectMilestone>('project_milestones').select('*').eq('user_id', user.user_id),
      admin.from<TimeBlock>('time_blocks').select('*').eq('user_id', user.user_id).gte('start_at', `${today}T00:00:00.000Z`).lte('start_at', `${today}T23:59:59.999Z`),
    ]);

    const briefing = buildDailyBriefing({
      now: new Date(),
      timezone,
      displayName: '',
      goals: goals.data ?? [],
      projects: projects.data ?? [],
      tasks: tasks.data ?? [],
      blocks: blocks.data ?? [],
      notifications: notifications.data ?? [],
      goalMilestones: goalMilestones.data ?? [],
      projectMilestones: projectMilestones.data ?? [],
      inboxPending: (inboxItems.data ?? []).length,
    });

    const preferences: UserPreferences = {
      user_id: user.user_id,
      timezone,
      workday_start: '09:00',
      workday_end: '21:00',
      break_minutes: 10,
      max_daily_blocks: 6,
      briefing_enabled: true,
      deadline_alerts: true,
      project_alerts: true,
      goal_alerts: true,
      inbox_alerts: true,
      agent_alerts: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = await emitNotification(
      admin,
      user.user_id,
      notify.dailyBriefing(briefing.headline, briefing.sections.map((section) => `${section.label}: ${section.title}`).join(' • ')),
      preferences,
    );

    if (result.created) sent += 1;
  }

  return NextResponse.json({ ok: true, data: { usersProcessed: users.length, briefingsSent: sent } });
}
