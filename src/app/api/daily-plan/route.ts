import { jsonError, jsonOk, requireUser } from '../../../lib/api/handler';
import * as repo from '../../../lib/db/repositories';
import { blockedTaskIds } from '../../../lib/db/repositories';
import { buildDailyPlan } from '../../../lib/engine/planner';

export async function GET(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const date = new URL(request.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    const [plan, blocks, preferences] = await Promise.all([
      repo.getDailyPlan(db, userId, date),
      repo.listTimeBlocks(db, userId, dayStart, dayEnd),
      repo.getPreferences(db, userId),
    ]);

    return jsonOk({
      date,
      plan: plan.data ?? null,
      blocks: blocks.data ?? [],
      workday: { start: preferences.data?.workday_start ?? '09:00', end: preferences.data?.workday_end ?? '21:00' },
      timezone: preferences.data?.timezone ?? 'UTC',
    });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { date?: string; force?: boolean };
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    const [preferences, tasks, blocks, existing] = await Promise.all([
      repo.getPreferences(db, userId),
      repo.listTasks(db, userId, { limit: 300 }),
      repo.listTimeBlocks(db, userId, dayStart, dayEnd),
      repo.getDailyPlan(db, userId, date),
    ]);

    if (existing.data && body.force !== true) {
      return jsonOk({
        plan: existing.data,
        blocks: blocks.data ?? [],
        regenerated: false,
        message: 'A plan already exists for this date. Send force=true to rebuild it.',
      });
    }

    const timezone = preferences.data?.timezone ?? 'UTC';
    const dependencies = (await repo.listDependencies(db, userId)).data ?? [];
    const blocked = blockedTaskIds(tasks.data ?? [], dependencies);
    const openTasks = (tasks.data ?? []).filter(
      (task) => task.status !== 'completed' && task.status !== 'cancelled' && !blocked.has(task.id),
    );

    const built = buildDailyPlan({
      date,
      timezone,
      workdayStart: preferences.data?.workday_start ?? '09:00',
      workdayEnd: preferences.data?.workday_end ?? '21:00',
      breakMinutes: preferences.data?.break_minutes ?? 10,
      maxDailyBlocks: preferences.data?.max_daily_blocks ?? 6,
      tasks: openTasks,
      commitments: (blocks.data ?? []).filter((block) => block.kind === 'commitment'),
      blockedTaskIds: blocked,
    });

    const saved = await repo.upsertDailyPlan(db, userId, {
      id: existing.data?.id,
      plan_date: date,
      summary: built.summary,
      status: 'active',
      generated_by: 'agent',
    });
    if (saved.error || !saved.data) return jsonError(new Error(saved.error?.message ?? 'Could not save the plan.'), 500);

    if (existing.data) await repo.deleteTimeBlocksForPlan(db, userId, saved.data.id);
    for (const block of built.blocks) {
      await repo.createTimeBlock(db, userId, {
        daily_plan_id: saved.data.id,
        task_id: block.task_id,
        title: block.title,
        start_at: block.start_at,
        end_at: block.end_at,
        kind: block.kind,
        status: 'planned',
        position: block.position,
      });
    }

    return jsonOk({ plan: saved.data, blocks: built.blocks, skipped: built.skipped, regenerated: true, summary: built.summary });
  } catch (error) {
    return jsonError(error as Error);
  }
}
