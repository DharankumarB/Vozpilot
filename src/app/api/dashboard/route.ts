import { jsonError, jsonOk, requireUser } from '../../../lib/api/handler';
import * as repo from '../../../lib/db/repositories';
import { blockedByMap, blockedTaskIds } from '../../../lib/db/repositories';
import { rankTasks } from '../../../lib/engine/priority';
import { computeGoalHealth, computeProjectHealth } from '../../../lib/engine/health';
import { buildDailyBriefing } from '../../../lib/engine/briefing';
import { todayInZone } from '../../../lib/utils/dates';

/** Single payload for the dashboard - one round trip, no hardcoded numbers. */
export async function GET() {
  try {
    const { db, userId } = await requireUser();
    const profile = await repo.getProfile(db, userId);
    const timezone = profile.data?.timezone ?? 'UTC';
    const today = todayInZone(timezone);

    const [preferences, goals, projects, tasks, dependencies, notifications, inboxItems, goalMilestones, projectMilestones, plan, blocks] =
      await Promise.all([
        repo.getPreferences(db, userId),
        repo.listGoals(db, userId),
        repo.listProjects(db, userId),
        repo.listTasks(db, userId, { limit: 300 }),
        repo.listDependencies(db, userId),
        repo.listNotifications(db, userId, { limit: 20 }),
        repo.listInboxItems(db, userId),
        repo.listGoalMilestones(db, userId),
        repo.listProjectMilestones(db, userId),
        repo.getDailyPlan(db, userId, today),
        repo.listTimeBlocks(db, userId, `${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`),
      ]);

    const goalMap = new Map((goals.data ?? []).map((goal) => [goal.id, goal]));
    const projectMap = new Map((projects.data ?? []).map((project) => [project.id, project]));
    const blocksCount = blockedByMap(dependencies.data ?? []);
    const blocked = blockedTaskIds(tasks.data ?? [], dependencies.data ?? []);
    const openTasks = (tasks.data ?? []).filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
    const ranked = rankTasks(openTasks, {
      goals: goalMap,
      projects: projectMap,
      blocksCount,
      blockedTaskIds: blocked,
    });

    const briefing = buildDailyBriefing({
      now: new Date(),
      timezone,
      displayName: profile.data?.full_name ?? '',
      goals: goals.data ?? [],
      projects: projects.data ?? [],
      tasks: tasks.data ?? [],
      blocks: blocks.data ?? [],
      notifications: notifications.data ?? [],
      goalMilestones: goalMilestones.data ?? [],
      projectMilestones: projectMilestones.data ?? [],
      inboxPending: (inboxItems.data ?? []).filter((item) => item.status !== 'dismissed' && item.status !== 'archived').length,
    });

    return jsonOk({
      profile: profile.data,
      preferences: preferences.data,
      timezone,
      briefing,
      nextBestAction: ranked[0]
        ? {
            task_id: ranked[0].task.id,
            title: ranked[0].task.title,
            priority: ranked[0].task.priority,
            estimated_minutes: ranked[0].task.estimated_minutes,
            due_date: ranked[0].task.due_date,
            score: ranked[0].score.total,
          }
        : null,
      goals: (goals.data ?? []).slice(0, 4).map((goal) => ({
        ...goal,
        health: computeGoalHealth({
          goal,
          projects: projects.data ?? [],
          tasks: tasks.data ?? [],
          milestones: goalMilestones.data ?? [],
        }),
      })),
      projects: (projects.data ?? []).slice(0, 4).map((project) => ({
        ...project,
        health: computeProjectHealth({
          project,
          tasks: tasks.data ?? [],
          milestones: (projectMilestones.data ?? []).filter((milestone) => milestone.project_id === project.id),
        }),
      })),
      todayTasks: ranked.slice(0, 6).map((entry) => entry.task),
      plan: plan.data ?? null,
      blocks: blocks.data ?? [],
      notifications: (notifications.data ?? []).slice(0, 8),
      unreadCount: (notifications.data ?? []).filter((notification) => !notification.read_at).length,
      inboxItems: (inboxItems.data ?? []).slice(0, 5),
      blockedTaskIds: [...blocked],
    });
  } catch (error) {
    return jsonError(error as Error);
  }
}
