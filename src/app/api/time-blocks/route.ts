import { jsonError, jsonOk, parseBody, requireUser } from '../../../lib/api/handler';
import { createTimeBlockSchema } from '../../../lib/validation/schemas';
import * as repo from '../../../lib/db/repositories';
import { findConflicts } from '../../../lib/engine/planner';

export async function GET(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    const to = url.searchParams.get('to') ?? `${new Date().toISOString().slice(0, 10)}T23:59:59.999Z`;
    const result = await repo.listTimeBlocks(db, userId, from, to);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ blocks: result.data ?? [] });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, createTimeBlockSchema);

    const dayStart = `${new Date(body.start_at).toISOString().slice(0, 10)}T00:00:00.000Z`;
    const dayEnd = `${new Date(body.start_at).toISOString().slice(0, 10)}T23:59:59.999Z`;
    const existing = await repo.listTimeBlocks(db, userId, dayStart, dayEnd);
    const conflicts = findConflicts({ start_at: body.start_at, end_at: body.end_at }, existing.data ?? []);
    if (conflicts.length > 0) {
      return jsonOk(
        {
          created: false,
          conflicts: conflicts.map((block) => ({ id: block.id, title: block.title, start_at: block.start_at, end_at: block.end_at })),
          message: `That time overlaps "${conflicts[0].title}". Pick another slot.`,
        },
        { status: 409 },
      );
    }

    const result = await repo.createTimeBlock(db, userId, body as never);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not create the time block.'), 500);
    return jsonOk({ block: result.data }, { status: 201 });
  } catch (error) {
    return jsonError(error as Error);
  }
}
