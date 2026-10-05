import { jsonError, jsonOk, parseBody, requireUser } from '../../../lib/api/handler';
import { createMemorySchema } from '../../../lib/validation/schemas';
import * as repo from '../../../lib/db/repositories';
import { isDuplicateMemory, groupMemories } from '../../../lib/engine/memory';

export async function GET() {
  try {
    const { db, userId } = await requireUser();
    const result = await repo.listMemories(db, userId);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ memories: result.data ?? [], grouped: groupMemories(result.data ?? []) });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, userId } = await requireUser();
    const body = await parseBody(request, createMemorySchema);
    const existing = (await repo.listMemories(db, userId)).data ?? [];
    if (isDuplicateMemory(existing, body.content)) {
      return jsonOk({ duplicate: true, message: 'VozPilot already remembers this.' });
    }
    const result = await repo.createMemory(db, userId, body as never);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not save the memory.'), 500);
    return jsonOk({ memory: result.data }, { status: 201 });
  } catch (error) {
    return jsonError(error as Error);
  }
}
