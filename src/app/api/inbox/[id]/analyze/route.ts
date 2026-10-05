import { jsonError, jsonOk, requireUser } from '../../../../../lib/api/handler';
import * as repo from '../../../../../lib/db/repositories';
import { analyzeInboxItem } from '../../../../../lib/engine/inbox';
import { emitNotification, notify } from '../../../../../lib/notifications/service';

type Params = { params: Promise<{ id: string }> };

/** Re-run VozInbox analysis on an item. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const item = await repo.getInboxItem(db, userId, id);
    if (!item.data) return jsonError(new Error('That inbox item does not exist.'), 404);

    const [projects, goals] = await Promise.all([repo.listProjects(db, userId), repo.listGoals(db, userId)]);
    const analysis = analyzeInboxItem({
      subject: item.data.subject,
      body: item.data.body,
      sender: item.data.sender,
      projects: projects.data ?? [],
      goals: goals.data ?? [],
    });

    const updated = await repo.updateInboxItem(db, userId, id, {
      status: 'analyzed',
      analysis,
      matched_project_id: analysis.matched_project_id,
      matched_goal_id: analysis.matched_goal_id,
    });
    if (updated.error) return jsonError(new Error(updated.error.message), 500);

    // Replace previous suggestions so stale actions never linger.
    const existing = await repo.listInboxActions(db, userId, id);
    for (const action of existing.data ?? []) {
      if (action.status === 'suggested') await repo.updateInboxAction(db, userId, action.id, { status: 'dismissed' });
    }
    for (const action of analysis.actions) {
      await repo.createInboxAction(db, userId, {
        inbox_item_id: id,
        kind: action.kind,
        title: action.title,
        due_date: action.due_date,
        priority: action.priority,
        project_id: analysis.matched_project_id,
        goal_id: analysis.matched_goal_id,
        confidence: action.confidence,
        status: 'suggested',
      });
    }

    const preferences = await repo.getPreferences(db, userId);
    await emitNotification(db, userId, notify.inboxAction(analysis.summary, id), preferences.data);

    return jsonOk({ item: updated.data, analysis });
  } catch (error) {
    return jsonError(error as Error);
  }
}
