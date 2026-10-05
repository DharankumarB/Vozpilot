import { jsonError, jsonOk, parseBody, requireUser } from '../../../../lib/api/handler';
import { updateTaskSchema, completeTaskSchema } from '../../../../lib/validation/schemas';
import * as repo from '../../../../lib/db/repositories';
import { refreshDerivedMetrics } from '../../../../lib/agent/tools';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const task = await repo.getTask(db, userId, id);
    if (task.error) return jsonError(new Error(task.error.message), 500);
    if (!task.data) return jsonError(new Error('That task does not exist.'), 404);
    return jsonOk({ task: task.data });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const body = await parseBody(request, updateTaskSchema);
    const existing = await repo.getTask(db, userId, id);
    if (!existing.data) return jsonError(new Error('That task does not exist.'), 404);

    const result = await repo.updateTask(db, userId, id, body as never);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not update the task.'), 500);
    await refreshDerivedMetrics(db, userId, { projectId: result.data.project_id, goalId: result.data.goal_id });
    return jsonOk({ task: result.data });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const existing = await repo.getTask(db, userId, id);
    if (!existing.data) return jsonError(new Error('That task does not exist.'), 404);
    const result = await repo.deleteTask(db, userId, id);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    await refreshDerivedMetrics(db, userId, { projectId: existing.data.project_id, goalId: existing.data.goal_id });
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export { completeTaskSchema };
