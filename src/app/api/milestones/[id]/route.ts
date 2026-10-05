import { jsonError, jsonOk, parseBody, requireUser } from '../../../../lib/api/handler';
import { updateMilestoneSchema } from '../../../../lib/validation/schemas';
import * as repo from '../../../../lib/db/repositories';
import { computeGoalHealth } from '../../../../lib/engine/health';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const body = await parseBody(request, updateMilestoneSchema);

    const [goalMilestones, projectMilestones] = await Promise.all([
      repo.listGoalMilestones(db, userId),
      repo.listProjectMilestones(db, userId),
    ]);

    const goalMilestone = (goalMilestones.data ?? []).find((milestone) => milestone.id === id);
    const projectMilestone = (projectMilestones.data ?? []).find((milestone) => milestone.id === id);

    if (goalMilestone) {
      const result = await repo.updateGoalMilestone(db, userId, id, {
        ...(body as Record<string, unknown>),
        ...(body.status ? { completed_at: body.status === 'completed' ? new Date().toISOString() : null } : {}),
      });
      if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not update the milestone.'), 500);

      const goal = await repo.getGoal(db, userId, goalMilestone.goal_id);
      if (goal.data) {
        const [projects, tasks] = await Promise.all([
          repo.listProjects(db, userId, true),
          repo.listTasks(db, userId, { limit: 300 }),
        ]);
        const health = computeGoalHealth({ goal: goal.data, projects: projects.data ?? [], tasks: tasks.data ?? [], milestones: goalMilestones.data ?? [] });
        await repo.updateGoal(db, userId, goal.data.id, { progress: health.metrics.progress, health: health.score, health_note: health.reasons[0] ?? '' });
      }
      return jsonOk({ milestone: result.data });
    }

    if (projectMilestone) {
      const result = await repo.updateProjectMilestone(db, userId, id, {
        ...(body as Record<string, unknown>),
        ...(body.status ? { completed_at: body.status === 'completed' ? new Date().toISOString() : null } : {}),
      });
      if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not update the milestone.'), 500);
      return jsonOk({ milestone: result.data });
    }

    return jsonError(new Error('That milestone does not exist.'), 404);
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  void request;
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const goalMilestones = await repo.listGoalMilestones(db, userId);
    if ((goalMilestones.data ?? []).some((milestone) => milestone.id === id)) {
      const result = await repo.deleteGoalMilestone(db, userId, id);
      if (result.error) return jsonError(new Error(result.error.message), 500);
      return jsonOk({ deleted: true });
    }
    const projectMilestones = await repo.listProjectMilestones(db, userId);
    if ((projectMilestones.data ?? []).some((milestone) => milestone.id === id)) {
      const { error } = await db.from('project_milestones').delete().eq('user_id', userId).eq('id', id);
      if (error) return jsonError(new Error('Could not delete the milestone.'), 500);
      return jsonOk({ deleted: true });
    }
    return jsonError(new Error('That milestone does not exist.'), 404);
  } catch (error) {
    return jsonError(error as Error);
  }
}
