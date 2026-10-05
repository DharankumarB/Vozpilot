import { jsonError, jsonOk, requireUser } from '../../../../lib/api/handler';
import * as repo from '../../../../lib/db/repositories';
import { blockedByMap, blockedTaskIds } from '../../../../lib/db/repositories';
import { rankTasks, explainScore } from '../../../../lib/engine/priority';
import { emitNotification, notify } from '../../../../lib/notifications/service';

/**
 * "What should I do now?" - computed entirely from real records.
 * No model call is needed, which keeps this instant and free.
 */
export async function GET() {
  try {
    const { db, userId } = await requireUser();
    const [goals, projects, tasks, dependencies, preferences] = await Promise.all([
      repo.listGoals(db, userId),
      repo.listProjects(db, userId),
      repo.listTasks(db, userId, { limit: 300 }),
      repo.listDependencies(db, userId),
      repo.getPreferences(db, userId),
    ]);

    const goalMap = new Map((goals.data ?? []).map((goal) => [goal.id, goal]));
    const projectMap = new Map((projects.data ?? []).map((project) => [project.id, project]));
    const blocks = blockedByMap(dependencies.data ?? []);
    const blocked = blockedTaskIds(tasks.data ?? [], dependencies.data ?? []);
    const open = (tasks.data ?? []).filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
    const ranked = rankTasks(open, { goals: goalMap, projects: projectMap, blocksCount: blocks, blockedTaskIds: blocked });

    if (ranked.length === 0) {
      return jsonOk({
        recommendation: null,
        message: 'Nothing is waiting on you right now. Capture a goal or project and VozPilot will build your first plan.',
        openTaskCount: 0,
      });
    }

    const best = ranked[0];
    const recommendation = {
      task_id: best.task.id,
      title: best.task.title,
      priority: best.task.priority,
      estimated_minutes: best.task.estimated_minutes,
      due_date: best.task.due_date,
      project: best.task.project_id ? projectMap.get(best.task.project_id)?.title ?? null : null,
      project_id: best.task.project_id,
      goal: best.task.goal_id ? goalMap.get(best.task.goal_id)?.title ?? null : null,
      goal_id: best.task.goal_id,
      score: best.score,
      reason: explainScore(best.score),
      blocks_count: blocks.get(best.task.id) ?? 0,
    };

    if (preferences.data) {
      await emitNotification(db, userId, notify.nextTask(best.task.title, best.task.id), preferences.data);
    }

    return jsonOk({
      recommendation,
      alternatives: ranked.slice(1, 4).map((entry) => ({
        task_id: entry.task.id,
        title: entry.task.title,
        score: entry.score.total,
        estimated_minutes: entry.task.estimated_minutes,
      })),
      openTaskCount: open.length,
      overdueCount: open.filter((task) => task.due_date && new Date(task.due_date) < new Date()).length,
    });
  } catch (error) {
    return jsonError(error as Error);
  }
}
