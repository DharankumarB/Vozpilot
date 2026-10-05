import { jsonError, jsonOk, parseBody, requireUser, idempotencyFrom } from '../../../lib/api/handler';
import { createTaskSchema } from '../../../lib/validation/schemas';
import * as repo from '../../../lib/db/repositories';
import { rankTasks, explainScore } from '../../../lib/engine/priority';
import { blockedTaskIds, blockedByMap } from '../../../lib/db/repositories';

export async function GET(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const url = new URL(request.url);
    const filter = {
      status: url.searchParams.get('status')?.split(',').filter(Boolean),
      projectId: url.searchParams.get('project_id') ?? undefined,
      goalId: url.searchParams.get('goal_id') ?? undefined,
      dueBefore: url.searchParams.get('due_before') ?? undefined,
      dueAfter: url.searchParams.get('due_after') ?? undefined,
      limit: Number.parseInt(url.searchParams.get('limit') ?? '200', 10),
    };

    const [tasks, dependencies, goals, projects] = await Promise.all([
      repo.listTasks(db, userId, filter),
      repo.listDependencies(db, userId),
      repo.listGoals(db, userId, true),
      repo.listProjects(db, userId, true),
    ]);
    if (tasks.error) return jsonError(new Error(tasks.error.message), 500);

    const goalMap = new Map((goals.data ?? []).map((goal) => [goal.id, goal]));
    const projectMap = new Map((projects.data ?? []).map((project) => [project.id, project]));
    const blocks = blockedByMap(dependencies.data ?? []);
    const blocked = blockedTaskIds(tasks.data ?? [], dependencies.data ?? []);

    const enriched = (tasks.data ?? []).map((task) => {
      const score = rankTasks([task], {
        goals: goalMap,
        projects: projectMap,
        blocksCount: blocks,
        blockedTaskIds: blocked,
      })[0];
      return {
        ...task,
        projectTitle: task.project_id ? projectMap.get(task.project_id)?.title ?? null : null,
        goalTitle: task.goal_id ? goalMap.get(task.goal_id)?.title ?? null : null,
        score: score?.score.total ?? 0,
        scoreReason: score ? explainScore(score.score) : '',
        isBlocked: blocked.has(task.id),
        blockedByCount: blocks.get(task.id) ?? 0,
      };
    });

    return jsonOk({ tasks: enriched, blockedTaskIds: [...blocked] });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, createTaskSchema);
    const key = idempotencyFrom(request);

    if (body.project_id) {
      const project = await repo.getProject(db, userId, body.project_id);
      if (!project.data) return jsonError(new Error('The selected project does not exist.'), 400);
    }
    if (body.goal_id) {
      const goal = await repo.getGoal(db, userId, body.goal_id);
      if (!goal.data) return jsonError(new Error('The selected goal does not exist.'), 400);
    }

    // Idempotency: a repeated submit with the same key returns the original row.
    if (key) {
      const existing = await repo.listTasks(db, userId, { limit: 500 });
      const duplicate = (existing.data ?? []).find((task) => task.idempotency_key === key);
      if (duplicate) return jsonOk({ task: duplicate, duplicate: true });
    }

    const result = await repo.createTask(db, userId, {
      ...(body as Record<string, unknown>),
      source: 'manual',
      idempotency_key: key,
    });
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not create the task.'), 500);

    if (result.data.project_id || result.data.goal_id) {
      const { refreshDerivedMetrics } = await import('../../../lib/agent/tools');
      await refreshDerivedMetrics(db, userId, { projectId: result.data.project_id, goalId: result.data.goal_id });
    }

    return jsonOk({ task: result.data }, { status: 201 });
  } catch (error) {
    return jsonError(error as Error);
  }
}
