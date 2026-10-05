import { jsonError, jsonOk, parseBody, requireUser } from '../../../../lib/api/handler';
import { updateTimeBlockSchema } from '../../../../lib/validation/schemas';
import * as repo from '../../../../lib/db/repositories';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const body = await parseBody(request, updateTimeBlockSchema);
    const result = await repo.updateTimeBlock(db, userId, id, body as never);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not update the time block.'), 500);
    return jsonOk({ block: result.data });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const result = await repo.deleteTimeBlock(db, userId, id);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error as Error);
  }
}
