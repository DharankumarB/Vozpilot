import { jsonError, jsonOk, parseBody, requireUser } from '../../../lib/api/handler';
import { createGoalSchema, updateGoalSchema } from '../../../lib/validation/schemas';
import * as repo from '../../../lib/db/repositories';
import { computeGoalHealth } from '../../../lib/engine/health';

export async function GET(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const includeArchived = new URL(request.url).searchParams.get('archived') === '1';
    const result = await repo.listGoals(db, userId, includeArchived);
    if (result.error) return jsonError(new Error(result.error.message), 500);

    const [projects, tasks, milestones] = await Promise.all([
      repo.listProjects(db, userId, true),
      repo.listTasks(db, userId, { limit: 300 }),
      repo.listGoalMilestones(db, userId),
    ]);

    const goals = (result.data ?? []).map((goal) => {
      const health = computeGoalHealth({
        goal,
        projects: projects.data ?? [],
        tasks: tasks.data ?? [],
        milestones: milestones.data ?? [],
      });
      return {
        ...goal,
        metrics: health.metrics,
        healthLabel: health.label,
        reasons: health.reasons,
        milestoneCount: (milestones.data ?? []).filter((milestone) => milestone.goal_id === goal.id).length,
        projectCount: (projects.data ?? []).filter((project) => project.goal_id === goal.id).length,
      };
    });

    return jsonOk({ goals });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, createGoalSchema);
    const result = await repo.createGoal(db, userId, body as never);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not create the goal.'), 500);
    return jsonOk({ goal: result.data }, { status: 201 });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export { updateGoalSchema };
