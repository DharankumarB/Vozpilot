import { jsonError, jsonOk, parseBody, requireUser } from '../../../../../lib/api/handler';
import { createActionFromInboxSchema } from '../../../../../lib/validation/schemas';
import * as repo from '../../../../../lib/db/repositories';
import { refreshDerivedMetrics } from '../../../../../lib/agent/tools';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const body = await parseBody(request, createActionFromInboxSchema);
    const item = await repo.getInboxItem(db, userId, id);
    if (!item.data) return jsonError(new Error('That inbox item does not exist.'), 404);

    const task = await repo.createTask(db, userId, {
      title: body.title,
      status: 'todo',
      priority: body.priority,
      due_date: body.due_date ?? null,
      estimated_minutes: body.estimated_minutes ?? null,
      project_id: body.project_id ?? item.data.matched_project_id,
      goal_id: body.goal_id ?? item.data.matched_goal_id,
      source: 'inbox',
    });
    if (task.error || !task.data) return jsonError(new Error(task.error?.message ?? 'Could not create the task.'), 500);

    await repo.updateInboxItem(db, userId, id, { status: 'actioned' });

    // Mark every pending suggestion for this item as accepted.
    const actions = await repo.listInboxActions(db, userId, id);
    for (const action of actions.data ?? []) {
      if (action.status === 'suggested') {
        await repo.updateInboxAction(db, userId, action.id, { status: 'accepted', created_task_id: task.data!.id });
      }
    }

    await refreshDerivedMetrics(db, userId, { projectId: task.data.project_id, goalId: task.data.goal_id });
    return jsonOk({ task: task.data }, { status: 201 });
  } catch (error) {
    return jsonError(error as Error);
  }
}
