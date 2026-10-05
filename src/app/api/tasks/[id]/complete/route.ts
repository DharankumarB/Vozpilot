import { jsonError, jsonOk, parseBody, requireUser } from '../../../../../lib/api/handler';
import { completeTaskSchema } from '../../../../../lib/validation/schemas';
import * as repo from '../../../../../lib/db/repositories';
import { refreshDerivedMetrics } from '../../../../../lib/agent/tools';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const body = await parseBody(request, completeTaskSchema);
    const existing = await repo.getTask(db, userId, id);
    if (!existing.data) return jsonError(new Error('That task does not exist.'), 404);
    if (existing.data.status === 'completed') {
      // Idempotent: completing twice must not create a second event.
      return jsonOk({ task: existing.data, alreadyCompleted: true });
    }

    const result = await repo.updateTask(db, userId, id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      actual_minutes: body.actual_minutes ?? existing.data.actual_minutes,
    });
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not complete the task.'), 500);
    await refreshDerivedMetrics(db, userId, { projectId: result.data.project_id, goalId: result.data.goal_id });
    return jsonOk({ task: result.data });
  } catch (error) {
    return jsonError(error as Error);
  }
}
