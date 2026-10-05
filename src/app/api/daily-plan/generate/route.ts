import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '../../../../lib/api/handler';
import * as repo from '../../../../lib/db/repositories';
import { blockedTaskIds } from '../../../../lib/db/repositories';
import { buildDailyPlan } from '../../../../lib/engine/planner';

/** Agent-facing plan generation (VozDay). */
export async function POST(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { date?: string };
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    const [preferences, tasks, blocks, existing] = await Promise.all([
      repo.getPreferences(db, userId),
      repo.listTasks(db, userId, { limit: 300 }),
      repo.listTimeBlocks(db, userId, dayStart, dayEnd),
      repo.getDailyPlan(db, userId, date),
    ]);

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
    if (saved.error || !saved.data) return jsonError(new Error('Could not save the plan.'), 500);

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

    return NextResponse.json({ ok: true, data: { plan: saved.data, blocks: built.blocks, skipped: built.skipped, summary: built.summary } });
  } catch (error) {
    return jsonError(error as Error);
  }
}
