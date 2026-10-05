import { jsonError, jsonOk, parseBody, requireUser } from '../../../lib/api/handler';
import { createInboxItemSchema } from '../../../lib/validation/schemas';
import * as repo from '../../../lib/db/repositories';
import { analyzeInboxItem } from '../../../lib/engine/inbox';

export async function GET(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const status = new URL(request.url).searchParams.get('status')?.split(',').filter(Boolean);
    const [items, actions, projects, goals] = await Promise.all([
      repo.listInboxItems(db, userId, status),
      repo.listInboxActions(db, userId),
      repo.listProjects(db, userId),
      repo.listGoals(db, userId),
    ]);
    if (items.error) return jsonError(new Error(items.error.message), 500);

    return jsonOk({
      items: items.data ?? [],
      actions: actions.data ?? [],
      projects: projects.data ?? [],
      goals: goals.data ?? [],
    });
  } catch (error) {
    return jsonError(error as Error);
  }
}

/**
 * Capture an inbox item and analyse it immediately.
 *
 * The message body is treated as untrusted data: it is parsed for facts, never
 * executed as an instruction.
 */
export async function POST(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, createInboxItemSchema);

    const created = await repo.createInboxItem(db, userId, {
      source: body.source,
      sender: body.sender ?? '',
      subject: body.subject ?? '',
      body: body.body,
      received_at: body.received_at ?? new Date().toISOString(),
      status: 'new',
    });
    if (created.error || !created.data) return jsonError(new Error(created.error?.message ?? 'Could not save the inbox item.'), 500);

    const [projects, goals] = await Promise.all([repo.listProjects(db, userId), repo.listGoals(db, userId)]);
    const analysis = analyzeInboxItem({
      subject: created.data.subject,
      body: created.data.body,
      sender: created.data.sender,
      projects: projects.data ?? [],
      goals: goals.data ?? [],
    });

    const updated = await repo.updateInboxItem(db, userId, created.data.id, {
      status: 'analyzed',
      analysis,
      matched_project_id: analysis.matched_project_id,
      matched_goal_id: analysis.matched_goal_id,
    });
    if (updated.error) return jsonError(new Error(updated.error.message), 500);

    for (const action of analysis.actions) {
      await repo.createInboxAction(db, userId, {
        inbox_item_id: created.data.id,
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

    return jsonOk({ item: updated.data ?? created.data, analysis }, { status: 201 });
  } catch (error) {
    return jsonError(error as Error);
  }
}
