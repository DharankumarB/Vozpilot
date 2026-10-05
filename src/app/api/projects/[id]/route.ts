import { jsonError, jsonOk, parseBody, requireUser } from '../../../../lib/api/handler';
import { updateProjectSchema } from '../../../../lib/validation/schemas';
import * as repo from '../../../../lib/db/repositories';
import { computeProjectHealth } from '../../../../lib/engine/health';
import { emitNotification, notify } from '../../../../lib/notifications/service';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const project = await repo.getProject(db, userId, id);
    if (project.error) return jsonError(new Error(project.error.message), 500);
    if (!project.data) return jsonError(new Error('That project does not exist.'), 404);

    const [milestones, tasks, dependencies, goals] = await Promise.all([
      repo.listProjectMilestones(db, userId, id),
      repo.listTasks(db, userId, { limit: 400 }),
      repo.listDependencies(db, userId),
      repo.listGoals(db, userId, true),
    ]);

    const projectTasks = (tasks.data ?? []).filter((task) => task.project_id === id);
    const health = computeProjectHealth({ project: project.data, tasks: tasks.data ?? [], milestones: milestones.data ?? [] });

    return jsonOk({
      project: project.data,
      milestones: milestones.data ?? [],
      tasks: projectTasks,
      dependencies: (dependencies.data ?? []).filter(
        (dependency) => projectTasks.some((task) => task.id === dependency.task_id),
      ),
      health,
      goal: (goals.data ?? []).find((goal) => goal.id === project.data?.goal_id) ?? null,
    });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const body = await parseBody(request, updateProjectSchema);
    const existing = await repo.getProject(db, userId, id);
    if (!existing.data) return jsonError(new Error('That project does not exist.'), 404);

    const result = await repo.updateProject(db, userId, id, body as never);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not update the project.'), 500);

    const [tasks, milestones] = await Promise.all([
      repo.listTasks(db, userId, { limit: 400 }),
      repo.listProjectMilestones(db, userId, id),
    ]);
    const health = computeProjectHealth({ project: result.data, tasks: tasks.data ?? [], milestones: milestones.data ?? [] });
    const updated = await repo.updateProject(db, userId, id, {
      progress: health.metrics.progress,
      health: health.score,
      risk: Math.max(0, 100 - health.score),
      health_note: health.reasons[0] ?? '',
    });

    if (health.score < 55 && result.data.status !== 'at_risk' && result.data.status !== 'completed') {
      const preferences = await repo.getPreferences(db, userId);
      await emitNotification(db, userId, notify.projectAtRisk(result.data.title, health.reasons[0] ?? 'Project health dropped.', id), preferences.data);
    }

    return jsonOk({ project: updated.data ?? result.data, health });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const existing = await repo.getProject(db, userId, id);
    if (!existing.data) return jsonError(new Error('That project does not exist.'), 404);
    const result = await repo.deleteProject(db, userId, id);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error as Error);
  }
}
