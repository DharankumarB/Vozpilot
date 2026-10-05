import { jsonError, jsonOk, parseBody, requireUser } from '../../../../lib/api/handler';
import { createDependencySchema } from '../../../../lib/validation/schemas';
import * as repo from '../../../../lib/db/repositories';
import { blockedTaskIds } from '../../../../lib/db/repositories';

export async function GET() {
  try {
    const { db, userId } = await requireUser();
    const result = await repo.listDependencies(db, userId);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ dependencies: result.data ?? [] });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, createDependencySchema);
    if (body.task_id === body.depends_on_task_id) {
      return jsonError(new Error('A task cannot depend on itself.'), 422);
    }
    const [task, dependency] = await Promise.all([
      repo.getTask(db, userId, body.task_id),
      repo.getTask(db, userId, body.depends_on_task_id),
    ]);
    if (!task.data || !dependency.data) return jsonError(new Error('Both tasks must belong to you.'), 404);

    // Cycle guard: reject a dependency that would create a loop.
    const all = (await repo.listDependencies(db, userId)).data ?? [];
    const graph = new Map<string, string[]>();
    for (const entry of all) graph.set(entry.task_id, [...(graph.get(entry.task_id) ?? []), entry.depends_on_task_id]);
    if (createsCycle(graph, body.task_id, body.depends_on_task_id)) {
      return jsonError(new Error('That dependency would create a circular chain, so it was rejected.'), 422);
    }

    const result = await repo.createDependency(db, userId, body);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not create the dependency.'), 500);

    const tasks = await repo.listTasks(db, userId, { limit: 400 });
    return jsonOk({ dependency: result.data, blockedTaskIds: [...blockedTaskIds(tasks.data ?? [], [...all, result.data])] }, { status: 201 });
  } catch (error) {
    return jsonError(error as Error);
  }
}

function createsCycle(graph: Map<string, string[]>, taskId: string, dependsOn: string): boolean {
  const stack = [dependsOn];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of graph.get(current) ?? []) stack.push(next);
  }
  return false;
}
