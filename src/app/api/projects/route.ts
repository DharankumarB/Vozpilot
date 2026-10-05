import { jsonError, jsonOk, parseBody, requireUser } from '../../../lib/api/handler';
import { createProjectSchema } from '../../../lib/validation/schemas';
import * as repo from '../../../lib/db/repositories';
import { computeProjectHealth } from '../../../lib/engine/health';

export async function GET(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const includeArchived = new URL(request.url).searchParams.get('archived') === '1';
    const result = await repo.listProjects(db, userId, includeArchived);
    if (result.error) return jsonError(new Error(result.error.message), 500);

    const [tasks, milestones, goals] = await Promise.all([
      repo.listTasks(db, userId, { limit: 400 }),
      repo.listProjectMilestones(db, userId),
      repo.listGoals(db, userId, true),
    ]);

    const projects = (result.data ?? []).map((project) => {
      const health = computeProjectHealth({
        project,
        tasks: tasks.data ?? [],
        milestones: (milestones.data ?? []).filter((milestone) => milestone.project_id === project.id),
      });
      return {
        ...project,
        metrics: health.metrics,
        healthLabel: health.label,
        reasons: health.reasons,
        goalTitle: (goals.data ?? []).find((goal) => goal.id === project.goal_id)?.title ?? null,
      };
    });

    return jsonOk({ projects });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, createProjectSchema);
    if (body.goal_id) {
      const goal = await repo.getGoal(db, userId, body.goal_id);
      if (!goal.data) return jsonError(new Error('The selected goal does not exist.'), 400);
    }
    const result = await repo.createProject(db, userId, body as never);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not create the project.'), 500);
    return jsonOk({ project: result.data }, { status: 201 });
  } catch (error) {
    return jsonError(error as Error);
  }
}
