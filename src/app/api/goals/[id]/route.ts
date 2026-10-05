import { jsonError, jsonOk, parseBody, requireUser } from '../../../../lib/api/handler';
import { updateGoalSchema } from '../../../../lib/validation/schemas';
import * as repo from '../../../../lib/db/repositories';
import { computeGoalHealth } from '../../../../lib/engine/health';
import { emitNotification, notify } from '../../../../lib/notifications/service';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const goal = await repo.getGoal(db, userId, id);
    if (goal.error) return jsonError(new Error(goal.error.message), 500);
    if (!goal.data) return jsonError(new Error('That goal does not exist.'), 404);

    const [milestones, projects, tasks] = await Promise.all([
      repo.listGoalMilestones(db, userId, id),
      repo.listProjects(db, userId, true),
      repo.listTasks(db, userId, { limit: 300 }),
    ]);

    const health = computeGoalHealth({
      goal: goal.data,
      projects: projects.data ?? [],
      tasks: tasks.data ?? [],
      milestones: milestones.data ?? [],
    });

    return jsonOk({
      goal: goal.data,
      milestones: milestones.data ?? [],
      projects: (projects.data ?? []).filter((project) => project.goal_id === id),
      tasks: (tasks.data ?? []).filter((task) => task.goal_id === id),
      health,
    });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const body = await parseBody(request, updateGoalSchema);
    const existing = await repo.getGoal(db, userId, id);
    if (!existing.data) return jsonError(new Error('That goal does not exist.'), 404);

    const result = await repo.updateGoal(db, userId, id, body as never);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not update the goal.'), 500);

    if (body.status === 'completed' && existing.data.status !== 'completed') {
      const preferences = await repo.getPreferences(db, userId);
      await emitNotification(db, userId, notify.goalMilestone(result.data.title, result.data.id), preferences.data);
    }

    return jsonOk({ goal: result.data });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const existing = await repo.getGoal(db, userId, id);
    if (!existing.data) return jsonError(new Error('That goal does not exist.'), 404);
    const result = await repo.deleteGoal(db, userId, id);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error as Error);
  }
}
