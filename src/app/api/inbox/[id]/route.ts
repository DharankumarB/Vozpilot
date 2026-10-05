import { jsonError, jsonOk, parseBody, requireUser } from '../../../../lib/api/handler';
import { updateInboxItemSchema } from '../../../../lib/validation/schemas';
import * as repo from '../../../../lib/db/repositories';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const body = await parseBody(request, updateInboxItemSchema);
    const existing = await repo.getInboxItem(db, userId, id);
    if (!existing.data) return jsonError(new Error('That inbox item does not exist.'), 404);
    const result = await repo.updateInboxItem(db, userId, id, body as never);
    if (result.error || !result.data) return jsonError(new Error(result.error?.message ?? 'Could not update the inbox item.'), 500);
    return jsonOk({ item: result.data });
  } catch (error) {
    return jsonError(error as Error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { db, userId } = await requireUser();
    const { id } = await params;
    const existing = await repo.getInboxItem(db, userId, id);
    if (!existing.data) return jsonError(new Error('That inbox item does not exist.'), 404);
    const result = await repo.deleteInboxItem(db, userId, id);
    if (result.error) return jsonError(new Error(result.error.message), 500);
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error as Error);
  }
}
